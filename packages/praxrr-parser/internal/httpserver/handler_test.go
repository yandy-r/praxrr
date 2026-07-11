package httpserver

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/parity"
	parserdomain "github.com/yandy-r/praxrr/packages/praxrr-parser/internal/parser"
)

func TestHandlerCompleteHTTPOracle(t *testing.T) {
	corpus, err := parity.Load("../../testdata/golden")
	if err != nil {
		t.Fatal(err)
	}
	wantedFiles := map[string]bool{
		"http.jsonl":        true,
		"parse.jsonl":       true,
		"match.jsonl":       true,
		"match-batch.jsonl": true,
	}
	handler := NewHandler("1.0.0", nil)
	seen := 0

	for _, record := range corpus.Records {
		if !wantedFiles[record.SourceFile] {
			continue
		}
		seen++
		record := record
		t.Run(record.ID, func(t *testing.T) {
			request := httptest.NewRequest(
				record.Request.Method,
				record.Request.Path,
				strings.NewReader(record.Request.Body),
			)
			for name, value := range record.Request.Headers {
				request.Header.Set(name, value)
			}
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != record.Response.Status {
				t.Fatalf("status = %d, want %d; body=%q", response.Code, record.Response.Status, response.Body.String())
			}
			for name, want := range record.Response.Headers {
				if got := response.Header().Get(name); got != want {
					t.Fatalf("header %q = %q, want %q", name, got, want)
				}
			}
			assertGoldenBody(t, record, response.Body.Bytes())
		})
	}

	if seen != 55 {
		t.Fatalf("HTTP-relevant oracle records = %d, want 55", seen)
	}
}

func TestHandlerValidationOrder(t *testing.T) {
	handler := NewHandler("test", nil)
	tests := []struct {
		name string
		path string
		body string
		want string
	}{
		{
			name: "parse title before type",
			path: "/parse",
			body: `{"title":" ","type":"invalid"}`,
			want: `{"error":"Title is required"}`,
		},
		{
			name: "match text before patterns",
			path: "/match",
			body: `{"text":" ","patterns":[]}`,
			want: `{"error":"Text is required"}`,
		},
		{
			name: "batch texts before patterns",
			path: "/match/batch",
			body: `{"texts":[],"patterns":[]}`,
			want: `{"error":"At least one text is required"}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest || response.Body.String() != test.want {
				t.Fatalf("response = %d %q, want 400 %q", response.Code, response.Body.String(), test.want)
			}
		})
	}
}

func TestHandlerRejectsBodyAndWorkLimitsBeforeServiceWork(t *testing.T) {
	parser := &recordingParser{}
	matcher := &recordingMatcher{}
	handler := newHandler("test", parser, matcher, nil)

	oversized := strings.Repeat("x", int(parserdomain.RequestBodyLimit()+1))
	response := performJSONRequest(handler, "/match", oversized)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body status = %d, want 413", response.Code)
	}
	if matcher.calls != 0 {
		t.Fatal("oversized body reached matcher")
	}

	longTitle := strings.Repeat("x", 1001)
	response = performJSONRequest(handler, "/parse", `{"title":"`+longTitle+`","type":"movie"}`)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized title status = %d, want 413", response.Code)
	}
	if parser.calls != 0 {
		t.Fatal("oversized title reached parser service")
	}

	patterns := make([]string, 911)
	for index := range patterns {
		patterns[index] = "a"
	}
	body, err := json.Marshal(contract.MatchRequest{Text: "a", Patterns: patterns})
	if err != nil {
		t.Fatal(err)
	}
	realHandler := NewHandler("test", nil)
	response = performJSONRequest(realHandler, "/match", string(body))
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized pattern count status = %d, want 413", response.Code)
	}
}

func TestHandlerMatcherCapacityPolicy(t *testing.T) {
	matcher := &recordingMatcher{err: parserdomain.ErrMatcherAtCapacity}
	handler := newHandler("test", &recordingParser{}, matcher, nil)
	response := performJSONRequest(handler, "/match", `{"text":"a","patterns":["a"]}`)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("capacity status = %d, want 503", response.Code)
	}
	if got := response.Header().Get("Retry-After"); got != retryAfterBusy {
		t.Fatalf("Retry-After = %q, want %q", got, retryAfterBusy)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("capacity body = %q, want empty", response.Body.String())
	}
}

func TestHandlerLogsMetadataWithoutRequestContent(t *testing.T) {
	const (
		secretText    = "PRIVATE_RELEASE_NAME"
		secretPattern = "PRIVATE_PATTERN"
		secretHeader  = "PRIVATE_HEADER"
		secretQuery   = "PRIVATE_QUERY"
	)
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	matcher := &recordingMatcher{response: contract.MatchResponse{
		Results: map[string]bool{secretPattern: true},
	}}
	handler := newHandler("test", &recordingParser{}, matcher, logger)
	request := httptest.NewRequest(
		http.MethodPost,
		"/match?value="+secretQuery,
		strings.NewReader(`{"text":"`+secretText+`","patterns":["`+secretPattern+`"]}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Secret", secretHeader)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}

	output := logs.String()
	for _, secret := range []string{secretText, secretPattern, secretHeader, secretQuery} {
		if strings.Contains(output, secret) {
			t.Fatalf("log leaked request content %q: %s", secret, output)
		}
	}
	for _, metadata := range []string{`"route":"/match"`, `"status":200`, `"text_count":1`, `"pattern_count":1`} {
		if !strings.Contains(output, metadata) {
			t.Fatalf("log missing %s: %s", metadata, output)
		}
	}
}

func TestAcceptsJSONMediaTypes(t *testing.T) {
	tests := []struct {
		value string
		want  bool
	}{
		{value: "application/json", want: true},
		{value: "application/json; charset=utf-8", want: true},
		{value: "application/vnd.praxrr+json", want: true},
		{value: "text/json", want: false},
		{value: "text/plain", want: false},
		{value: "", want: false},
		{value: "broken;", want: false},
	}
	for _, test := range tests {
		if got := acceptsJSON(test.value); got != test.want {
			t.Errorf("acceptsJSON(%q) = %v, want %v", test.value, got, test.want)
		}
	}
}

func assertGoldenBody(t *testing.T, record parity.Record, got []byte) {
	t.Helper()
	want := []byte(record.Response.Body)
	if len(want) == 0 {
		if len(got) != 0 {
			t.Fatalf("body = %q, want empty", got)
		}
		return
	}

	var gotJSON any
	var wantJSON any
	if err := json.Unmarshal(got, &gotJSON); err != nil {
		t.Fatalf("decode response body %q: %v", got, err)
	}
	if err := json.Unmarshal(want, &wantJSON); err != nil {
		t.Fatalf("decode golden body: %v", err)
	}
	if !reflect.DeepEqual(gotJSON, wantJSON) {
		t.Fatalf("body differs\ngot:  %s\nwant: %s", got, want)
	}

	// Struct-backed bodies have an intentional stable field order. Map member
	// order is excluded by the approved contract boundary.
	if record.Request.Path == "/parse" || record.Request.Path == "/health" || record.Response.Status >= 400 {
		if string(got) != string(want) {
			t.Fatalf("ordered body differs\ngot:  %s\nwant: %s", got, want)
		}
	}
}

func performJSONRequest(handler http.Handler, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

type recordingParser struct {
	calls    int
	response contract.ParseResponse
}

func (service *recordingParser) Parse(string, contract.MediaType) contract.ParseResponse {
	service.calls++
	return service.response
}

type recordingMatcher struct {
	calls    int
	response contract.MatchResponse
	batch    contract.BatchMatchResponse
	err      error
}

func (matcher *recordingMatcher) MatchPatterns(string, []string) (contract.MatchResponse, error) {
	matcher.calls++
	return matcher.response, matcher.err
}

func (matcher *recordingMatcher) MatchPatternsBatch([]string, []string) (contract.BatchMatchResponse, error) {
	matcher.calls++
	return matcher.batch, matcher.err
}
