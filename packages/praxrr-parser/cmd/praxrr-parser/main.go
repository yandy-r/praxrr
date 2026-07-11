package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/httpserver"
)

const (
	defaultParserAddr = "127.0.0.1:5000"
	fallbackVersion   = "2.0.0-go.1"

	exitSuccess        = 0
	exitRuntimeFailure = 1
	exitConfigFailure  = 2
)

// version is deterministic for local builds and can be replaced by release
// builds with: -ldflags "-X main.version=<behavior-version>".
var version = fallbackVersion

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	ctx, stop := signalContext(context.Background())
	defer stop()
	os.Exit(run(ctx, os.Getenv, logger))
}

func signalContext(parent context.Context) (context.Context, context.CancelFunc) {
	return signal.NotifyContext(parent, os.Interrupt, syscall.SIGTERM)
}

func run(ctx context.Context, getenv func(string) string, logger *slog.Logger) int {
	if ctx == nil || getenv == nil || logger == nil {
		return exitConfigFailure
	}
	addr, source, err := resolveAddress(getenv)
	if err != nil {
		logger.Error("parser configuration rejected", "error_class", "listener_address")
		return exitConfigFailure
	}

	behaviorVersion := effectiveVersion(version)
	handler := httpserver.NewHandler(behaviorVersion, logger)
	server, err := httpserver.NewServer(httpserver.DefaultServerConfig(addr, handler), logger)
	if err != nil {
		logger.Error("parser configuration rejected", "error_class", "server_policy")
		return exitConfigFailure
	}
	logger.Info("parser starting", "version", behaviorVersion, "address_source", source)
	if err := server.ListenAndServe(ctx); err != nil {
		logger.Error("parser stopped unexpectedly", "error_class", "server_runtime")
		return exitRuntimeFailure
	}
	return exitSuccess
}

func effectiveVersion(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallbackVersion
	}
	return value
}

func resolveAddress(getenv func(string) string) (string, string, error) {
	if value := strings.TrimSpace(getenv("PARSER_ADDR")); value != "" {
		addr, err := validateAddress(value)
		if err != nil {
			return "", "", err
		}
		return addr, "PARSER_ADDR", nil
	}

	return defaultParserAddr, "default", nil
}

func validateAddress(value string) (string, error) {
	if strings.ContainsAny(value, "\r\n\t/?#@") {
		return "", errors.New("invalid parser address")
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil || !validPort(port) {
		return "", errors.New("invalid parser address")
	}
	if strings.TrimSpace(host) != host || strings.Contains(host, " ") {
		return "", errors.New("invalid parser address")
	}
	return net.JoinHostPort(host, port), nil
}

func validPort(value string) bool {
	port, err := strconv.Atoi(value)
	return err == nil && port >= 0 && port <= 65535
}
