package main

import (
	"context"
	"log/slog"
	"net"
	"os"
	"testing"
)

func TestResolveAddress(t *testing.T) {
	tests := []struct {
		name       string
		values     map[string]string
		wantAddr   string
		wantSource string
		wantErr    bool
	}{
		{name: "loopback default", wantAddr: "127.0.0.1:5000", wantSource: "default"},
		{
			name:       "PARSER_ADDR",
			values:     map[string]string{"PARSER_ADDR": "127.0.0.1:6000"},
			wantAddr:   "127.0.0.1:6000",
			wantSource: "PARSER_ADDR",
		},
		{name: "IPv6 PARSER_ADDR", values: map[string]string{"PARSER_ADDR": "[::1]:6000"}, wantAddr: "[::1]:6000", wantSource: "PARSER_ADDR"},
		{name: "reject missing port", values: map[string]string{"PARSER_ADDR": "localhost"}, wantErr: true},
		{name: "reject parser URL", values: map[string]string{"PARSER_ADDR": "http://localhost:5000"}, wantErr: true},
		{name: "reject oversized port", values: map[string]string{"PARSER_ADDR": "127.0.0.1:65536"}, wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			getenv := func(key string) string { return test.values[key] }
			addr, source, err := resolveAddress(getenv)
			if test.wantErr {
				if err == nil {
					t.Fatalf("resolveAddress = %q/%q, want error", addr, source)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if addr != test.wantAddr || source != test.wantSource {
				t.Fatalf("resolveAddress = %q/%q, want %q/%q", addr, source, test.wantAddr, test.wantSource)
			}
		})
	}
}

func TestEffectiveVersionIsDeterministic(t *testing.T) {
	if got := effectiveVersion(""); got != "2.0.0-go.1" {
		t.Fatalf("empty version = %q, want deterministic fallback", got)
	}
	if got := effectiveVersion("  build-123  "); got != "build-123" {
		t.Fatalf("injected version = %q", got)
	}
}

func TestRunExitCodes(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	badConfig := func(key string) string {
		if key == "PARSER_ADDR" {
			return "not-an-address"
		}
		return ""
	}
	if got := run(context.Background(), badConfig, logger); got != exitConfigFailure {
		t.Fatalf("bad config exit = %d, want %d", got, exitConfigFailure)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	occupied := listener.Addr().String()
	if got := run(context.Background(), func(key string) string {
		if key == "PARSER_ADDR" {
			return occupied
		}
		return ""
	}, logger); got != exitRuntimeFailure {
		t.Fatalf("listener failure exit = %d, want %d", got, exitRuntimeFailure)
	}
}
