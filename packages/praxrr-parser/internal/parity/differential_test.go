package parity

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/httpserver"
)

const (
	legacyParserURLEnv = "PRAXRR_LEGACY_PARSER_URL"
	parityVersion      = "1.0.0"
)

var parityInstant = time.Date(2026, time.July, 11, 18, 0, 0, 0, time.UTC)

// TestDifferentialListenerFullCorpus always gates the real Go listener against
// all immutable oracle observations. Setting PRAXRR_LEGACY_PARSER_URL adds a
// live, pinned C# listener to the same pass; CI without that deliberately
// external dependency still executes the complete captured differential gate.
func TestDifferentialListenerFullCorpus(t *testing.T) {
	corpus := mustLoadGolden(t)
	goURL := startParityServer(t)
	legacyURL := strings.TrimRight(strings.TrimSpace(os.Getenv(legacyParserURLEnv)), "/")
	client := &http.Client{Timeout: 5 * time.Second}

	for _, record := range corpus.Records {
		record := record
		t.Run(record.ID, func(t *testing.T) {
			goResponse := performRecordedRequest(t, client, goURL, record)
			if err := corpus.Compare(record.Response, goResponse); err != nil {
				t.Fatalf("Go listener differs from captured C# oracle: %v", err)
			}

			if legacyURL == "" {
				return
			}
			legacyResponse := performRecordedRequest(t, client, legacyURL, record)
			if err := corpus.Compare(record.Response, legacyResponse); err != nil {
				t.Fatalf("live C# listener differs from its pinned capture: %v", err)
			}
		})
	}

	if len(corpus.Records) != 114 {
		t.Fatalf("differential records = %d, want 114", len(corpus.Records))
	}
}

func startParityServer(t testing.TB) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("open Go parity listener: %v", err)
	}
	handler := httpserver.NewHandlerWithClock(parityVersion, func() time.Time { return parityInstant }, nil)
	config := httpserver.DefaultServerConfig(listener.Addr().String(), handler)
	server, err := httpserver.NewServer(config, nil)
	if err != nil {
		_ = listener.Close()
		t.Fatalf("construct Go parity listener: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- server.Serve(ctx, listener) }()
	t.Cleanup(func() {
		cancel()
		if err := <-done; err != nil {
			t.Errorf("stop Go parity listener: %v", err)
		}
	})
	return "http://" + listener.Addr().String()
}

func performRecordedRequest(t *testing.T, client *http.Client, baseURL string, record Record) Response {
	t.Helper()
	request, err := http.NewRequest(record.Request.Method, baseURL+record.Request.Path, strings.NewReader(record.Request.Body))
	if err != nil {
		t.Fatalf("create %s request: %v", record.ID, err)
	}
	for name, value := range record.Request.Headers {
		request.Header.Set(name, value)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("perform %s request against %s: %v", record.ID, baseURL, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read %s response: %v", record.ID, err)
	}
	headers := make(map[string]string, len(response.Header))
	for name := range response.Header {
		headers[strings.ToLower(name)] = response.Header.Get(name)
	}
	return Response{Status: response.StatusCode, Headers: headers, Body: string(body)}
}
