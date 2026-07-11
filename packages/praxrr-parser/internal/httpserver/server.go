package httpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"
	"time"
)

const (
	DefaultReadHeaderTimeout = 5 * time.Second
	DefaultReadTimeout       = 15 * time.Second
	DefaultWriteTimeout      = 25 * time.Second
	DefaultIdleTimeout       = 60 * time.Second
	DefaultRequestTimeout    = 25 * time.Second
	DefaultShutdownTimeout   = 10 * time.Second
	DefaultMaxHeaderBytes    = 32 << 10
	DefaultMaxActiveRequests = 8
)

// ServerConfig contains every listener and request lifecycle budget. Callers
// should start with DefaultServerConfig so a newly added field cannot silently
// become an unlimited net/http default.
type ServerConfig struct {
	Addr              string
	Handler           http.Handler
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	RequestTimeout    time.Duration
	ShutdownTimeout   time.Duration
	MaxHeaderBytes    int
	MaxActiveRequests int
}

// DefaultServerConfig returns the bounded production policy. The write and
// request budgets intentionally complete before the app client's 30-second
// deadline, while graceful shutdown retains the approved ten-second ceiling.
func DefaultServerConfig(addr string, handler http.Handler) ServerConfig {
	return ServerConfig{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: DefaultReadHeaderTimeout,
		ReadTimeout:       DefaultReadTimeout,
		WriteTimeout:      DefaultWriteTimeout,
		IdleTimeout:       DefaultIdleTimeout,
		RequestTimeout:    DefaultRequestTimeout,
		ShutdownTimeout:   DefaultShutdownTimeout,
		MaxHeaderBytes:    DefaultMaxHeaderBytes,
		MaxActiveRequests: DefaultMaxActiveRequests,
	}
}

// Server owns listener policy and graceful lifecycle around the wire handler.
type Server struct {
	httpServer      *http.Server
	shutdownTimeout time.Duration
	logger          Logger
}

// NewServer validates and constructs a bounded HTTP server without opening a
// listener. Passing a nil logger disables lifecycle logging.
func NewServer(config ServerConfig, logger Logger) (*Server, error) {
	if err := validateServerConfig(config); err != nil {
		return nil, err
	}

	guard := newRequestGuard(config.Handler, config.MaxActiveRequests, config.RequestTimeout, logger)
	httpServer := &http.Server{
		Addr:              config.Addr,
		Handler:           guard,
		ReadHeaderTimeout: config.ReadHeaderTimeout,
		ReadTimeout:       config.ReadTimeout,
		WriteTimeout:      config.WriteTimeout,
		IdleTimeout:       config.IdleTimeout,
		MaxHeaderBytes:    config.MaxHeaderBytes,
	}
	return &Server{
		httpServer:      httpServer,
		shutdownTimeout: config.ShutdownTimeout,
		logger:          logger,
	}, nil
}

func validateServerConfig(config ServerConfig) error {
	if config.Addr == "" {
		return errors.New("parser server address is required")
	}
	if config.Handler == nil {
		return errors.New("parser server handler is required")
	}
	for name, value := range map[string]time.Duration{
		"read-header": config.ReadHeaderTimeout,
		"read":        config.ReadTimeout,
		"write":       config.WriteTimeout,
		"idle":        config.IdleTimeout,
		"request":     config.RequestTimeout,
		"shutdown":    config.ShutdownTimeout,
	} {
		if value <= 0 {
			return fmt.Errorf("parser server %s timeout must be positive", name)
		}
	}
	if config.MaxHeaderBytes <= 0 {
		return errors.New("parser server maximum header bytes must be positive")
	}
	if config.MaxActiveRequests <= 0 {
		return errors.New("parser server active request limit must be positive")
	}
	return nil
}

// ListenAndServe opens the configured address and serves until ctx is
// cancelled or the listener fails.
func (server *Server) ListenAndServe(ctx context.Context) error {
	listener, err := net.Listen("tcp", server.httpServer.Addr)
	if err != nil {
		return fmt.Errorf("listen for parser requests: %w", err)
	}
	return server.Serve(ctx, listener)
}

// Serve runs on an existing listener. Cancellation stops accepting new
// connections and drains active handlers within the configured shutdown
// budget. If the budget expires, Close cancels remaining request contexts.
func (server *Server) Serve(ctx context.Context, listener net.Listener) error {
	if ctx == nil {
		return errors.New("parser server context is required")
	}
	if listener == nil {
		return errors.New("parser server listener is required")
	}
	if server.logger != nil {
		server.logger.Log(ctx, slog.LevelInfo, "parser server listening", slog.String("addr", listener.Addr().String()))
	}

	serveResult := make(chan error, 1)
	go func() {
		serveResult <- server.httpServer.Serve(listener)
	}()

	select {
	case err := <-serveResult:
		return normalizeServeError(err)
	case <-ctx.Done():
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), server.shutdownTimeout)
	defer cancel()
	shutdownErr := server.httpServer.Shutdown(shutdownContext)
	if shutdownErr != nil {
		closeErr := server.httpServer.Close()
		if closeErr != nil && !errors.Is(closeErr, http.ErrServerClosed) {
			shutdownErr = errors.Join(shutdownErr, closeErr)
		}
	}
	serveErr := normalizeServeError(<-serveResult)
	if server.logger != nil {
		level := slog.LevelInfo
		outcome := "drained"
		if shutdownErr != nil || serveErr != nil {
			level = slog.LevelError
			outcome = "forced"
		}
		server.logger.Log(context.Background(), level, "parser server stopped", slog.String("outcome", outcome))
	}
	return errors.Join(shutdownErr, serveErr)
}

func normalizeServeError(err error) error {
	if err == nil || errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return fmt.Errorf("serve parser requests: %w", err)
}

type requestGuard struct {
	next           http.Handler
	admission      chan struct{}
	requestTimeout time.Duration
	logger         Logger
	requestID      atomic.Uint64
}

func newRequestGuard(next http.Handler, limit int, timeout time.Duration, logger Logger) *requestGuard {
	return &requestGuard{
		next:           next,
		admission:      make(chan struct{}, limit),
		requestTimeout: timeout,
		logger:         logger,
	}
}

func (guard *requestGuard) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	id := guard.requestID.Add(1)
	tracked := &trackingResponseWriter{ResponseWriter: writer}
	defer func() {
		if recovered := recover(); recovered != nil {
			if !tracked.wroteHeader {
				tracked.WriteHeader(http.StatusInternalServerError)
			}
			if guard.logger != nil {
				guard.logger.Log(
					context.Background(),
					slog.LevelError,
					"parser request recovered",
					slog.Uint64("request_id", id),
					slog.String("error_class", "panic"),
				)
			}
		}
	}()

	requestContext, cancel := context.WithTimeout(request.Context(), guard.requestTimeout)
	defer cancel()
	request = request.WithContext(requestContext)

	// Health remains responsive when all expensive request slots are occupied.
	if request.URL.Path == "/health" {
		guard.next.ServeHTTP(tracked, request)
		return
	}

	select {
	case guard.admission <- struct{}{}:
		defer func() { <-guard.admission }()
	case <-requestContext.Done():
		writeEmpty(tracked, http.StatusServiceUnavailable)
		return
	default:
		tracked.Header().Set("Retry-After", retryAfterBusy)
		writeEmpty(tracked, http.StatusServiceUnavailable)
		if guard.logger != nil {
			guard.logger.Log(
				requestContext,
				slog.LevelWarn,
				"parser request rejected",
				slog.Uint64("request_id", id),
				slog.String("error_class", "server_capacity"),
			)
		}
		return
	}
	guard.next.ServeHTTP(tracked, request)
}

type trackingResponseWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (writer *trackingResponseWriter) WriteHeader(status int) {
	if writer.wroteHeader {
		return
	}
	writer.wroteHeader = true
	writer.ResponseWriter.WriteHeader(status)
}

func (writer *trackingResponseWriter) Write(body []byte) (int, error) {
	if !writer.wroteHeader {
		writer.WriteHeader(http.StatusOK)
	}
	return writer.ResponseWriter.Write(body)
}
