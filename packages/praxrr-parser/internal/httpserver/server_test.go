package httpserver

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDefaultServerConfigHasFiniteBudgets(t *testing.T) {
	config := DefaultServerConfig("127.0.0.1:5000", http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	if config.ReadHeaderTimeout != 5*time.Second || config.ReadTimeout != 15*time.Second {
		t.Fatalf("read budgets = %s/%s", config.ReadHeaderTimeout, config.ReadTimeout)
	}
	if config.WriteTimeout >= 30*time.Second || config.RequestTimeout >= 30*time.Second {
		t.Fatalf("write/request budgets must precede client deadline: %s/%s", config.WriteTimeout, config.RequestTimeout)
	}
	if config.IdleTimeout != 60*time.Second || config.ShutdownTimeout != 10*time.Second {
		t.Fatalf("idle/shutdown budgets = %s/%s", config.IdleTimeout, config.ShutdownTimeout)
	}
	if config.MaxHeaderBytes != 32<<10 || config.MaxActiveRequests <= 0 {
		t.Fatalf("header/admission limits = %d/%d", config.MaxHeaderBytes, config.MaxActiveRequests)
	}
}

func TestNewServerRejectsUnlimitedConfiguration(t *testing.T) {
	base := DefaultServerConfig("127.0.0.1:5000", http.NotFoundHandler())
	tests := []struct {
		name   string
		mutate func(*ServerConfig)
	}{
		{name: "address", mutate: func(config *ServerConfig) { config.Addr = "" }},
		{name: "handler", mutate: func(config *ServerConfig) { config.Handler = nil }},
		{name: "read header", mutate: func(config *ServerConfig) { config.ReadHeaderTimeout = 0 }},
		{name: "read", mutate: func(config *ServerConfig) { config.ReadTimeout = 0 }},
		{name: "write", mutate: func(config *ServerConfig) { config.WriteTimeout = 0 }},
		{name: "idle", mutate: func(config *ServerConfig) { config.IdleTimeout = 0 }},
		{name: "request", mutate: func(config *ServerConfig) { config.RequestTimeout = 0 }},
		{name: "shutdown", mutate: func(config *ServerConfig) { config.ShutdownTimeout = 0 }},
		{name: "header bytes", mutate: func(config *ServerConfig) { config.MaxHeaderBytes = 0 }},
		{name: "admission", mutate: func(config *ServerConfig) { config.MaxActiveRequests = 0 }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config := base
			test.mutate(&config)
			if _, err := NewServer(config, nil); err == nil {
				t.Fatal("NewServer accepted unbounded configuration")
			}
		})
	}
}

func TestServerAdmissionKeepsHealthResponsive(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	handler := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/health" {
			writer.WriteHeader(http.StatusOK)
			return
		}
		close(entered)
		<-release
		writer.WriteHeader(http.StatusNoContent)
	})
	config := fastServerConfig(handler)
	config.MaxActiveRequests = 1
	baseURL, stop := startTestServer(t, config)

	firstDone := make(chan error, 1)
	go func() {
		response, err := http.Get(baseURL + "/work")
		if err == nil {
			_ = response.Body.Close()
		}
		firstDone <- err
	}()
	<-entered

	response, err := http.Get(baseURL + "/work")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable || response.Header.Get("Retry-After") != retryAfterBusy {
		t.Fatalf("overload response = %d Retry-After=%q", response.StatusCode, response.Header.Get("Retry-After"))
	}

	response, err = http.Get(baseURL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("health under load = %d, want 200", response.StatusCode)
	}
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
	stop()
}

func TestServerPropagatesClientCancellation(t *testing.T) {
	entered := make(chan struct{})
	cancelled := make(chan struct{})
	handler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	handler = http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(entered)
		<-request.Context().Done()
		close(cancelled)
	})
	baseURL, stop := startTestServer(t, fastServerConfig(handler))
	defer stop()

	requestContext, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, baseURL+"/work", nil)
	if err != nil {
		t.Fatal(err)
	}
	requestDone := make(chan error, 1)
	go func() {
		response, requestErr := http.DefaultClient.Do(request)
		if requestErr == nil {
			_ = response.Body.Close()
		}
		requestDone <- requestErr
	}()
	<-entered
	cancel()
	<-cancelled
	if err := <-requestDone; err == nil {
		t.Fatal("cancelled client request unexpectedly succeeded")
	}
}

func TestServerRecoversWithoutLoggingRequestContent(t *testing.T) {
	const secret = "PRIVATE_RELEASE_TITLE"
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	guard := newRequestGuard(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(secret)
	}), 1, time.Second, logger)
	request := httptest.NewRequest(http.MethodPost, "/parse?title="+secret, strings.NewReader(secret))
	request.Header.Set("X-Secret", secret)
	response := httptest.NewRecorder()

	guard.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError || response.Body.Len() != 0 {
		t.Fatalf("panic response = %d %q", response.Code, response.Body.String())
	}
	if strings.Contains(logs.String(), secret) {
		t.Fatalf("panic log leaked request content: %s", logs.String())
	}
	for _, field := range []string{`"error_class":"panic"`, `"request_id":1`} {
		if !strings.Contains(logs.String(), field) {
			t.Fatalf("panic log missing %s: %s", field, logs.String())
		}
	}
}

func TestServerReadHeaderTimeoutClosesSlowClient(t *testing.T) {
	config := fastServerConfig(http.NotFoundHandler())
	config.ReadHeaderTimeout = 25 * time.Millisecond
	config.ReadTimeout = 50 * time.Millisecond
	listener := newLocalListener(t)
	server, err := NewServer(config, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- server.Serve(ctx, listener) }()

	connection, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if _, err := io.WriteString(connection, "GET /health HTTP/1.1\r\nHost: local"); err != nil {
		t.Fatal(err)
	}
	if err := connection.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	_, readErr := bufio.NewReader(connection).ReadByte()
	if readErr == nil {
		t.Fatal("slow header connection remained readable")
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestServerGracefulShutdownDrainsActiveRequest(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	handler := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		close(entered)
		<-release
		writer.WriteHeader(http.StatusNoContent)
	})
	config := fastServerConfig(handler)
	listener := newLocalListener(t)
	server, err := NewServer(config, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	serverDone := make(chan error, 1)
	go func() { serverDone <- server.Serve(ctx, listener) }()

	clientDone := make(chan error, 1)
	go func() {
		response, requestErr := http.Get("http://" + listener.Addr().String() + "/work")
		if requestErr == nil {
			_ = response.Body.Close()
		}
		clientDone <- requestErr
	}()
	<-entered
	cancel()
	select {
	case err := <-serverDone:
		t.Fatalf("server stopped before active request drained: %v", err)
	default:
	}
	close(release)
	if err := <-clientDone; err != nil {
		t.Fatal(err)
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}

func fastServerConfig(handler http.Handler) ServerConfig {
	config := DefaultServerConfig("127.0.0.1:0", handler)
	config.ReadHeaderTimeout = time.Second
	config.ReadTimeout = time.Second
	config.WriteTimeout = time.Second
	config.IdleTimeout = time.Second
	config.RequestTimeout = time.Second
	config.ShutdownTimeout = time.Second
	return config
}

func startTestServer(t *testing.T, config ServerConfig) (string, func()) {
	t.Helper()
	listener := newLocalListener(t)
	server, err := NewServer(config, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- server.Serve(ctx, listener) }()
	var once sync.Once
	stop := func() {
		once.Do(func() {
			cancel()
			if err := <-done; err != nil {
				t.Errorf("stop test server: %v", err)
			}
		})
	}
	t.Cleanup(stop)
	return "http://" + listener.Addr().String(), stop
}

func newLocalListener(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	return listener
}
