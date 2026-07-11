package parity

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/httpserver"
)

const (
	requestBodyLimit  = 105999
	textLimit         = 1000
	patternLimit      = 1636
	textCountLimit    = 100
	patternCountLimit = 910
	workProductLimit  = 45500
)

func TestAdversarialMaximumAndOneOverHTTP(t *testing.T) {
	baseURL := startParityServer(t)
	client := &http.Client{Timeout: 15 * time.Second}

	t.Run("request body bytes", func(t *testing.T) {
		base := `{"text":"a","patterns":["a"]}`
		atLimit := base + strings.Repeat(" ", requestBodyLimit-len(base))
		assertHTTPStatus(t, client, baseURL, "/match", atLimit, http.StatusOK)
		assertHTTPStatus(t, client, baseURL, "/match", atLimit+" ", http.StatusRequestEntityTooLarge)
	})

	t.Run("text characters", func(t *testing.T) {
		atLimit := strings.Repeat("x", textLimit)
		assertHTTPStatus(t, client, baseURL, "/parse", mustJSON(t, contract.ParseRequest{
			Title: atLimit,
			Type:  mediaTypePointer(contract.MediaTypeMovie),
		}), http.StatusOK)
		assertHTTPStatus(t, client, baseURL, "/parse", mustJSON(t, contract.ParseRequest{
			Title: atLimit + "x",
			Type:  mediaTypePointer(contract.MediaTypeMovie),
		}), http.StatusRequestEntityTooLarge)
	})

	t.Run("pattern characters", func(t *testing.T) {
		atLimit := strings.Repeat("a", patternLimit)
		assertHTTPStatus(t, client, baseURL, "/match", mustJSON(t, contract.MatchRequest{
			Text: "a", Patterns: []string{atLimit},
		}), http.StatusOK)
		assertHTTPStatus(t, client, baseURL, "/match", mustJSON(t, contract.MatchRequest{
			Text: "a", Patterns: []string{atLimit + "a"},
		}), http.StatusRequestEntityTooLarge)
	})

	t.Run("submitted counts", func(t *testing.T) {
		texts := repeatedStrings("same text", textCountLimit)
		patterns := repeatedStrings("^same text$", patternCountLimit)
		assertHTTPStatus(t, client, baseURL, "/match/batch", mustJSON(t, contract.BatchMatchRequest{
			Texts: texts, Patterns: patterns,
		}), http.StatusOK)
		assertHTTPStatus(t, client, baseURL, "/match/batch", mustJSON(t, contract.BatchMatchRequest{
			Texts: append(texts, "one over"), Patterns: []string{"x"},
		}), http.StatusRequestEntityTooLarge)
		assertHTTPStatus(t, client, baseURL, "/match/batch", mustJSON(t, contract.BatchMatchRequest{
			Texts: []string{"x"}, Patterns: append(patterns, "one over"),
		}), http.StatusRequestEntityTooLarge)
	})

	t.Run("work product", func(t *testing.T) {
		// Invalid patterns compile quickly but still exercise the complete unique
		// response matrix and its pre-work product validation.
		texts := numberedValues("text", workProductLimit/patternCountLimit)
		patterns := numberedValues("(", patternCountLimit)
		assertHTTPStatus(t, client, baseURL, "/match/batch", mustJSON(t, contract.BatchMatchRequest{
			Texts: texts, Patterns: patterns,
		}), http.StatusOK)
		oneOverTexts := numberedValues("text", 51)
		oneOverPatterns := numberedValues("(", 893) // 51 * 893 = 45,543.
		assertHTTPStatus(t, client, baseURL, "/match/batch", mustJSON(t, contract.BatchMatchRequest{
			Texts: oneOverTexts, Patterns: oneOverPatterns,
		}), http.StatusRequestEntityTooLarge)
	})
}

func TestAdversarialRegexesFailClosedWithinBudget(t *testing.T) {
	baseURL := startParityServer(t)
	client := &http.Client{Timeout: 3 * time.Second}
	text := strings.Repeat("a", 42) + "b"
	patterns := []string{
		`^(a|aa)+$`,
		`^(a+)+$`,
		`^(a|a?)+$`,
		`(?<=a{2})(?<word>a+)b\k<word>`,
		`(?:^){60000}`,
		`(?:(?=a))*`,
		`(`,
		`[z-a]`,
		`^a+b$`,
	}
	started := time.Now()
	response := postJSON(t, client, baseURL+"/match", mustJSON(t, contract.MatchRequest{Text: text, Patterns: patterns}))
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		t.Fatalf("adversarial match status = %d, want 200", response.StatusCode)
	}
	var result contract.MatchResponse
	decodeResponseBody(t, response, &result)
	if !result.Results[`^a+b$`] {
		t.Fatalf("safe sibling did not survive adversarial patterns: %#v", result.Results)
	}
	// Zero-width repetition is valid .NET syntax and may match; the failure
	// contract is that it terminates. Catastrophic/invalid siblings fail closed.
	for _, pattern := range []string{patterns[0], patterns[1], patterns[2], patterns[3], patterns[4], patterns[6], patterns[7]} {
		if result.Results[pattern] {
			t.Fatalf("adversarial pattern %q unexpectedly matched", pattern)
		}
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("adversarial request took %s, want <= 2s", elapsed)
	}
}

func TestAdversarialConcurrencyDisconnectAndHealth(t *testing.T) {
	baseURL := startParityServer(t)
	client := &http.Client{Timeout: 3 * time.Second}
	body := mustJSON(t, contract.MatchRequest{
		Text: strings.Repeat("a", 42) + "b", Patterns: []string{`^(a|aa)+$`},
	})

	start := make(chan struct{})
	errors := make(chan error, 10)
	var workers sync.WaitGroup
	for range 10 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			response, err := client.Post(baseURL+"/match", "application/json", strings.NewReader(body))
			if err != nil {
				errors <- err
				return
			}
			defer response.Body.Close()
			_, _ = io.Copy(io.Discard, response.Body)
			if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusServiceUnavailable {
				errors <- fmt.Errorf("load status %d", response.StatusCode)
			}
		}()
	}
	close(start)

	latencies := make([]time.Duration, 20)
	for index := range latencies {
		started := time.Now()
		response, err := client.Get(baseURL + "/health")
		if err != nil {
			t.Fatalf("health under load: %v", err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("health under load status = %d", response.StatusCode)
		}
		latencies[index] = time.Since(started)
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
	if p95Duration(latencies) > 250*time.Millisecond {
		t.Fatalf("health-under-load p95 = %s, want <= 250ms", p95Duration(latencies))
	}

	address := strings.TrimPrefix(baseURL, "http://")
	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	request := "POST /match HTTP/1.1\r\nHost: local\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"
	if _, err := io.WriteString(connection, request); err != nil {
		t.Fatal(err)
	}
	_ = connection.Close()
	assertHealth(t, client, baseURL)
}

func TestAdversarialHTTPFraming(t *testing.T) {
	baseURL := startParityServer(t)
	client := &http.Client{Timeout: 2 * time.Second}
	cases := []struct {
		name   string
		method string
		path   string
		media  string
		body   string
		status int
	}{
		{name: "trailing JSON", method: http.MethodPost, path: "/match", media: "application/json", body: `{"text":"a","patterns":["a"]}{}`, status: http.StatusBadRequest},
		{name: "wrong type", method: http.MethodPost, path: "/match", media: "application/json", body: `{"text":1,"patterns":["a"]}`, status: http.StatusBadRequest},
		{name: "unsupported method", method: http.MethodPut, path: "/match", media: "application/json", body: `{}`, status: http.StatusMethodNotAllowed},
		{name: "unsupported media", method: http.MethodPost, path: "/match", media: "text/plain", body: `{}`, status: http.StatusUnsupportedMediaType},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			request, err := http.NewRequest(test.method, baseURL+test.path, strings.NewReader(test.body))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Content-Type", test.media)
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != test.status {
				t.Fatalf("status = %d, want %d", response.StatusCode, test.status)
			}
		})
	}
}

func FuzzHandlerSeeds(f *testing.F) {
	corpus, err := Load(goldenDir)
	if err != nil {
		f.Fatal(err)
	}
	for _, record := range corpus.Records {
		f.Add(record.Request.Method, record.Request.Path, record.Request.Headers["content-type"], record.Request.Body)
	}
	for _, seed := range []string{"(", "[z-a]", `^(a|aa)+$`, string([]byte{0xff, 0xfe}), "{}{}"} {
		f.Add(http.MethodPost, "/match", "application/json", seed)
	}
	handler := httpserver.NewHandlerWithClock(parityVersion, func() time.Time { return parityInstant }, nil)
	f.Fuzz(func(t *testing.T, method, path, media, body string) {
		if len(method) > 16 || len(path) > 128 || len(media) > 128 || len(body) > requestBodyLimit+1 {
			return
		}
		request, err := http.NewRequest(method, "http://parser.local"+path, bytes.NewReader([]byte(body)))
		if err != nil {
			return
		}
		request.Header.Set("Content-Type", media)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code < 100 || response.Code > 599 {
			t.Fatalf("invalid HTTP status %d", response.Code)
		}
	})
}

func assertHTTPStatus(t *testing.T, client *http.Client, baseURL, path, body string, want int) {
	t.Helper()
	response := postJSON(t, client, baseURL+path, body)
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode != want {
		t.Fatalf("%s status = %d, want %d", path, response.StatusCode, want)
	}
}

func postJSON(t *testing.T, client *http.Client, url, body string) *http.Response {
	t.Helper()
	response, err := client.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	return response
}

func decodeResponseBody(t *testing.T, response *http.Response, destination any) {
	t.Helper()
	defer response.Body.Close()
	decoder := json.NewDecoder(response.Body)
	if err := decoder.Decode(destination); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}

func mustJSON(t testing.TB, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func mediaTypePointer(value contract.MediaType) *contract.MediaType { return &value }

func repeatedStrings(value string, count int) []string {
	values := make([]string, count)
	for index := range values {
		values[index] = value
	}
	return values
}

func numberedValues(prefix string, count int) []string {
	values := make([]string, count)
	for index := range values {
		values[index] = fmt.Sprintf("%s%d", prefix, index)
	}
	return values
}

func assertHealth(t *testing.T, client *http.Client, baseURL string) {
	t.Helper()
	response, err := client.Get(baseURL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("health status = %d, want 200", response.StatusCode)
	}
}

func p95Duration(values []time.Duration) time.Duration {
	copyOfValues := append([]time.Duration(nil), values...)
	for index := 1; index < len(copyOfValues); index++ {
		for position := index; position > 0 && copyOfValues[position] < copyOfValues[position-1]; position-- {
			copyOfValues[position], copyOfValues[position-1] = copyOfValues[position-1], copyOfValues[position]
		}
	}
	return copyOfValues[(len(copyOfValues)*95+99)/100-1]
}
