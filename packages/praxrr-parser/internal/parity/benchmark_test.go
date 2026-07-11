package parity

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

const performanceGateEnv = "PRAXRR_PERF_GATE"

type baselineArtifact struct {
	Metrics []baselineMetric `json:"metrics"`
}

type baselineMetric struct {
	ID      string `json:"id"`
	Samples struct {
		P50 float64 `json:"p50"`
		P95 float64 `json:"p95"`
		P99 float64 `json:"p99"`
	} `json:"samples"`
	Acceptance struct {
		Threshold *float64 `json:"threshold"`
	} `json:"acceptance"`
}

func TestPerformanceListenerLatencyAndLifecycle(t *testing.T) {
	baseline := loadBaseline(t)
	started := time.Now()
	baseURL := startParityServer(t)
	client := &http.Client{Timeout: 3 * time.Second}
	assertHealth(t, client, baseURL)
	startup := time.Since(started)
	if startup > metricDuration(t, baseline, "startup_health_ms", "p95") {
		t.Fatalf("Go startup-to-health = %s, exceeds legacy p95", startup)
	}

	body := mustJSON(t, contract.ParseRequest{
		Title: "The Matrix 1999 1080p BluRay DTS-GROUP",
		Type:  mediaTypePointer(contract.MediaTypeMovie),
	})
	latencies := make([]time.Duration, 50)
	for index := range latencies {
		requestStarted := time.Now()
		response := postJSON(t, client, baseURL+"/parse", body)
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("warm parse status = %d", response.StatusCode)
		}
		latencies[index] = time.Since(requestStarted)
	}
	sort.Slice(latencies, func(left, right int) bool { return latencies[left] < latencies[right] })
	p95 := percentile(latencies, 95)
	p99 := percentile(latencies, 99)
	warm := metric(t, baseline, "warm_parse_50_ms")
	if p95 > durationMS(warm.Samples.P95*1.1) || p99 > durationMS(warm.Samples.P99*1.1) {
		t.Fatalf("Go warm-50 p95/p99 = %s/%s, legacy budget = %.3f/%.3fms",
			p95, p99, warm.Samples.P95*1.1, warm.Samples.P99*1.1)
	}
	t.Logf("performance evidence: startup=%s warm50_p95=%s warm50_p99=%s", startup, p95, p99)
}

func TestPerformanceCandidateProcessRSSAndShutdown(t *testing.T) {
	if os.Getenv(performanceGateEnv) != "1" {
		t.Logf("set %s=1 to run the isolated Linux RSS/process lifecycle gate", performanceGateEnv)
		return
	}
	baseline := loadBaseline(t)
	binary := filepath.Join(t.TempDir(), "praxrr-parser")
	build := exec.Command("go", "build", "-trimpath", "-o", binary, "./cmd/praxrr-parser")
	build.Dir = filepath.Join("..", "..")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build candidate parser: %v\n%s", err, output)
	}

	address := reserveAddress(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	command := exec.CommandContext(ctx, binary)
	command.Env = append(os.Environ(), "PARSER_ADDR="+address)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	started := time.Now()
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	processDone := make(chan error, 1)
	go func() { processDone <- command.Wait() }()
	t.Cleanup(func() {
		if command.Process != nil {
			_ = command.Process.Kill()
		}
		select {
		case <-processDone:
		default:
		}
	})

	client := &http.Client{Timeout: 250 * time.Millisecond}
	baseURL := "http://" + address
	deadline := time.Now().Add(3 * time.Second)
	for {
		response, err := client.Get(baseURL + "/health")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("candidate did not become healthy: %s", stderr.String())
		}
		runtime.Gosched()
	}
	startup := time.Since(started)
	if startup > metricDuration(t, baseline, "startup_health_ms", "p95") {
		t.Fatalf("candidate startup = %s, exceeds legacy p95", startup)
	}

	if runtime.GOOS == "linux" {
		rss := linuxRSSBytes(t, command.Process.Pid)
		legacyRSS := int64(metric(t, baseline, "idle_rss_bytes").Samples.P50)
		if rss >= legacyRSS {
			t.Fatalf("candidate RSS = %d, want below legacy p50 %d", rss, legacyRSS)
		}
		t.Logf("process evidence: startup=%s rss=%d", startup, rss)
	}

	shutdownStarted := time.Now()
	if err := command.Process.Signal(os.Interrupt); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-processDone:
		if err != nil {
			t.Fatalf("candidate shutdown: %v; stderr=%s", err, stderr.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("candidate shutdown exceeded 10 seconds")
	}
	shutdown := time.Since(shutdownStarted)
	if shutdown > 10*time.Second {
		t.Fatalf("candidate shutdown = %s, want <= 10s", shutdown)
	}
	t.Logf("process evidence: shutdown=%s", shutdown)
}

func BenchmarkParserListener(b *testing.B) {
	baseURL := startParityServer(b)
	client := &http.Client{Timeout: 3 * time.Second}
	body := mustJSON(b, contract.ParseRequest{
		Title: "The Matrix 1999 1080p BluRay DTS-GROUP",
		Type:  mediaTypePointer(contract.MediaTypeMovie),
	})
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		response, err := client.Post(baseURL+"/parse", "application/json", strings.NewReader(body))
		if err != nil {
			b.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			b.Fatalf("status = %d", response.StatusCode)
		}
	}
}

func loadBaseline(t testing.TB) baselineArtifact {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(goldenDir, "baseline.json"))
	if err != nil {
		t.Fatal(err)
	}
	var baseline baselineArtifact
	if err := json.Unmarshal(data, &baseline); err != nil {
		t.Fatal(err)
	}
	return baseline
}

func metric(t testing.TB, baseline baselineArtifact, id string) baselineMetric {
	t.Helper()
	for _, candidate := range baseline.Metrics {
		if candidate.ID == id {
			return candidate
		}
	}
	t.Fatalf("baseline metric %q not found", id)
	return baselineMetric{}
}

func metricDuration(t testing.TB, baseline baselineArtifact, id, percentileName string) time.Duration {
	t.Helper()
	value := metric(t, baseline, id)
	switch percentileName {
	case "p95":
		return durationMS(value.Samples.P95)
	case "p99":
		return durationMS(value.Samples.P99)
	default:
		t.Fatalf("unknown percentile %q", percentileName)
		return 0
	}
}

func durationMS(value float64) time.Duration { return time.Duration(value * float64(time.Millisecond)) }

func percentile(values []time.Duration, percent int) time.Duration {
	return values[(len(values)*percent+99)/100-1]
}

func reserveAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return address
}

func linuxRSSBytes(t *testing.T, pid int) int64 {
	t.Helper()
	file, err := os.Open(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 3 && fields[0] == "VmRSS:" && fields[2] == "kB" {
			kilobytes, err := strconv.ParseInt(fields[1], 10, 64)
			if err != nil {
				t.Fatal(err)
			}
			return kilobytes * 1024
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	t.Fatal("VmRSS not found")
	return 0
}
