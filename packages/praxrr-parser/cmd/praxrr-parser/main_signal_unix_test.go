//go:build unix

package main

import (
	"bufio"
	"context"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
)

func TestProcessDrainsOnTerminationSignal(t *testing.T) {
	command := exec.Command(os.Args[0], "-test.run=TestProcessSignalHelper")
	command.Env = append(os.Environ(),
		"GO_WANT_PARSER_SIGNAL_HELPER=1",
		"PARSER_ADDR=127.0.0.1:0",
	)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	command.Stderr = command.Stdout
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}

	ready := false
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if strings.Contains(scanner.Text(), "parser server listening") {
			ready = true
			break
		}
	}
	if !ready {
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatalf("helper exited before listener readiness: %v", scanner.Err())
	}
	if err := command.Process.Signal(syscall.SIGTERM); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatal(err)
	}
	if err := command.Wait(); err != nil {
		t.Fatalf("signal helper did not exit cleanly: %v", err)
	}
}

func TestProcessSignalHelper(t *testing.T) {
	if os.Getenv("GO_WANT_PARSER_SIGNAL_HELPER") != "1" {
		return
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	ctx, stop := signalContext(context.Background())
	defer stop()
	os.Exit(run(ctx, os.Getenv, logger))
}
