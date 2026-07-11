package parser

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

func TestMatcherDotNETCaseInsensitiveSemantics(t *testing.T) {
	t.Parallel()

	matcher := NewMatcher()
	response, err := matcher.MatchPatterns("AbC-abc", []string{
		`^abc-ABC$`,
		`^(?<word>abc)-\k<word>$`,
		`^(?>a|ab)c-abc$`,
		`(?<=abc-)abc$`,
	})
	if err != nil {
		t.Fatalf("MatchPatterns: %v", err)
	}
	want := map[string]bool{
		`^abc-ABC$`:               true,
		`^(?<word>abc)-\k<word>$`: true,
		`^(?>a|ab)c-abc$`:         false,
		`(?<=abc-)abc$`:           true,
	}
	if !reflect.DeepEqual(response.Results, want) {
		t.Fatalf("results = %#v; want %#v", response.Results, want)
	}
}

func TestMatcherCompilesDistinctPatternsOnceAndCollapsesDuplicates(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	compiled := make(map[string]int)
	matcher := newMatcher(2, 1, func(pattern string) (dynamicRegex, regexFailure) {
		mu.Lock()
		compiled[pattern]++
		mu.Unlock()
		return fakeDynamicRegex{match: pattern == "alpha"}, regexFailureNone
	})

	response, err := matcher.MatchPatternsBatch(
		[]string{"first", "second", "first"},
		[]string{"alpha", "beta", "alpha"},
	)
	if err != nil {
		t.Fatalf("MatchPatternsBatch: %v", err)
	}
	if !reflect.DeepEqual(compiled, map[string]int{"alpha": 1, "beta": 1}) {
		t.Fatalf("compile counts = %#v", compiled)
	}
	if len(response.Results) != 2 {
		t.Fatalf("text result count = %d; want 2", len(response.Results))
	}
	wantPatterns := map[string]bool{"alpha": true, "beta": false}
	for text, patterns := range response.Results {
		if !reflect.DeepEqual(patterns, wantPatterns) {
			t.Fatalf("results[%q] = %#v; want %#v", text, patterns, wantPatterns)
		}
	}
}

func TestMatcherValidatesMaximumAndOneOverBeforeCompile(t *testing.T) {
	t.Parallel()

	var compileCount atomic.Int64
	matcher := newMatcher(1, 1, func(string) (dynamicRegex, regexFailure) {
		compileCount.Add(1)
		return fakeDynamicRegex{}, regexFailureNone
	})

	texts := make([]string, maxTextCount)
	patterns := make([]string, maxPatternCount)
	for index := range texts {
		texts[index] = "same-text"
	}
	for index := range patterns {
		patterns[index] = "same-pattern"
	}
	if _, err := matcher.MatchPatternsBatch(texts, patterns); err != nil {
		t.Fatalf("maximum submitted counts rejected: %v", err)
	}
	if got := compileCount.Load(); got != 1 {
		t.Fatalf("compile count at maximum = %d; want 1 distinct pattern", got)
	}

	patterns = append(patterns, "one-over")
	_, err := matcher.MatchPatternsBatch(texts, patterns)
	assertLimitClass(t, err, limitPatternCount)
	if got := compileCount.Load(); got != 1 {
		t.Fatalf("one-over request compiled patterns; count = %d", got)
	}
}

func TestMatcherMaximumWorkProductAndOneOver(t *testing.T) {
	t.Parallel()

	var matches atomic.Int64
	matcher := newMatcher(maxRegexWorkers, 1, func(string) (dynamicRegex, regexFailure) {
		return fakeDynamicRegex{onMatch: func() { matches.Add(1) }}, regexFailureNone
	})
	patterns := numberedStrings("pattern", maxPatternCount)
	texts := numberedStrings("text", maxMatchWorkProduct/maxPatternCount)

	if _, err := matcher.MatchPatternsBatch(texts, patterns); err != nil {
		t.Fatalf("maximum work product rejected: %v", err)
	}
	if got := matches.Load(); got != int64(maxMatchWorkProduct) {
		t.Fatalf("match operations = %d; want %d", got, maxMatchWorkProduct)
	}

	_, err := matcher.MatchPatternsBatch(append(texts, "one-over"), patterns)
	assertLimitClass(t, err, limitWorkProduct)
	if got := matches.Load(); got != int64(maxMatchWorkProduct) {
		t.Fatalf("one-over request performed work; operations = %d", got)
	}
}

func TestMatcherIsolatesInvalidTimeoutStackAndEngineFailures(t *testing.T) {
	t.Parallel()

	matcher := newMatcher(2, 1, func(pattern string) (dynamicRegex, regexFailure) {
		switch pattern {
		case "invalid":
			return nil, regexFailureInvalid
		case "timeout":
			return fakeDynamicRegex{failure: regexFailureTimeout}, regexFailureNone
		case "stack":
			return fakeDynamicRegex{failure: regexFailureStack}, regexFailureNone
		case "engine":
			return fakeDynamicRegex{match: true, failure: regexFailureEngine}, regexFailureNone
		default:
			return fakeDynamicRegex{match: true}, regexFailureNone
		}
	})

	response, err := matcher.MatchPatterns("private-release-title", []string{
		"invalid", "timeout", "stack", "engine", "safe",
	})
	if err != nil {
		t.Fatalf("MatchPatterns: %v", err)
	}
	want := map[string]bool{
		"invalid": false,
		"timeout": false,
		"stack":   false,
		"engine":  false,
		"safe":    true,
	}
	if !reflect.DeepEqual(response.Results, want) {
		t.Fatalf("results = %#v; want %#v", response.Results, want)
	}
}

func TestMatcherRealInvalidTimeoutAndStackFailures(t *testing.T) {
	// regexp2's timeout clock is process-global, so keep the catastrophic case
	// out of the parallel test group.
	matcher := NewMatcher()

	response, err := matcher.MatchPatterns("safe", []string{"(", "^safe$"})
	if err != nil {
		t.Fatalf("invalid-pattern match: %v", err)
	}
	if response.Results["("] || !response.Results["^safe$"] {
		t.Fatalf("invalid-pattern isolation = %#v", response.Results)
	}

	response, err = matcher.MatchPatterns("", []string{`(?:^){60000}`})
	if err != nil {
		t.Fatalf("stack-limited match: %v", err)
	}
	if response.Results[`(?:^){60000}`] {
		t.Fatalf("stack-limited result = %#v; want false", response.Results)
	}

	catastrophic := `^(a|aa)+$`
	response, err = matcher.MatchPatterns(strings.Repeat("a", 42)+"b", []string{
		catastrophic,
		`^a+b$`,
	})
	if err != nil {
		t.Fatalf("timeout match: %v", err)
	}
	if response.Results[catastrophic] || !response.Results[`^a+b$`] {
		t.Fatalf("timeout isolation = %#v", response.Results)
	}
}

func TestMatcherGoldenCorpus(t *testing.T) {
	// The corpus contains catastrophic expressions that use regexp2's shared
	// timeout clock, so execute these cases serially.
	matcher := NewMatcher()
	for _, filename := range []string{"match.jsonl", "match-batch.jsonl"} {
		for _, record := range readMatcherGoldens(t, filename) {
			if record.Response.Status != 200 {
				continue // Endpoint validation belongs to the HTTP adapter.
			}
			t.Run(record.ID, func(t *testing.T) {
				switch record.Request.Path {
				case "/match":
					var request contract.MatchRequest
					var want contract.MatchResponse
					unmarshalMatcherGolden(t, []byte(record.Request.Body), &request)
					unmarshalMatcherGolden(t, record.Response.DecodedBody, &want)
					got, err := matcher.MatchPatterns(request.Text, request.Patterns)
					if err != nil {
						t.Fatalf("MatchPatterns: %v", err)
					}
					if !reflect.DeepEqual(got, want) {
						t.Fatalf("response = %#v; want %#v", got, want)
					}
				case "/match/batch":
					var request contract.BatchMatchRequest
					var want contract.BatchMatchResponse
					unmarshalMatcherGolden(t, []byte(record.Request.Body), &request)
					unmarshalMatcherGolden(t, record.Response.DecodedBody, &want)
					got, err := matcher.MatchPatternsBatch(request.Texts, request.Patterns)
					if err != nil {
						t.Fatalf("MatchPatternsBatch: %v", err)
					}
					if !reflect.DeepEqual(got, want) {
						t.Fatalf("response = %#v; want %#v", got, want)
					}
				default:
					t.Fatalf("unexpected golden path %q", record.Request.Path)
				}
			})
		}
	}
}

func TestMatcherBoundsWorkersAndDoesNotLeak(t *testing.T) {
	const workerLimit = 3
	var active atomic.Int64
	var maximum atomic.Int64
	matcher := newMatcher(workerLimit, 1, func(string) (dynamicRegex, regexFailure) {
		return fakeDynamicRegex{onMatch: func() {
			current := active.Add(1)
			for {
				observed := maximum.Load()
				if current <= observed || maximum.CompareAndSwap(observed, current) {
					break
				}
			}
			time.Sleep(time.Millisecond)
			active.Add(-1)
		}}, regexFailureNone
	})

	before := runtime.NumGoroutine()
	for range 5 {
		if _, err := matcher.MatchPatternsBatch(numberedStrings("text", 30), []string{"pattern"}); err != nil {
			t.Fatalf("MatchPatternsBatch: %v", err)
		}
	}
	if got := maximum.Load(); got < 2 || got > workerLimit {
		t.Fatalf("maximum concurrent workers = %d; want 2..%d", got, workerLimit)
	}

	deadline := time.Now().Add(time.Second)
	for runtime.NumGoroutine() > before+2 && time.Now().Before(deadline) {
		runtime.Gosched()
	}
	if after := runtime.NumGoroutine(); after > before+2 {
		t.Fatalf("goroutines grew from %d to %d", before, after)
	}
}

func TestMatcherBoundsActiveRequestsAndLeavesHealthIndependent(t *testing.T) {
	const requestLimit = 2
	entered := make(chan struct{}, requestLimit)
	release := make(chan struct{})
	matcher := newMatcher(1, requestLimit, func(string) (dynamicRegex, regexFailure) {
		return fakeDynamicRegex{onMatch: func() {
			entered <- struct{}{}
			<-release
		}}, regexFailureNone
	})

	done := make(chan error, requestLimit)
	for range requestLimit {
		go func() {
			_, err := matcher.MatchPatterns("text", []string{"pattern"})
			done <- err
		}()
	}
	for range requestLimit {
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("request did not occupy matcher capacity")
		}
	}

	_, err := matcher.MatchPatterns(strings.Repeat("x", maxTextCharacters+1), []string{"pattern"})
	assertLimitClass(t, err, limitTextSize)

	_, err = matcher.MatchPatterns("private-title", []string{"private-pattern"})
	if !errors.Is(err, ErrMatcherAtCapacity) {
		t.Fatalf("capacity error = %v; want ErrMatcherAtCapacity", err)
	}
	if strings.Contains(err.Error(), "private") {
		t.Fatal("capacity error leaked request content")
	}

	// Health is a constant-time transport operation and deliberately does not
	// use matcher admission. Saturated regex capacity therefore leaves it free.
	health := make(chan struct{}, 1)
	go func() { health <- struct{}{} }()
	select {
	case <-health:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("independent health work was blocked by matcher capacity")
	}

	close(release)
	for range requestLimit {
		if err := <-done; err != nil {
			t.Fatalf("admitted request failed: %v", err)
		}
	}
}

func TestMatcherLimitAndCapacityErrorsContainNoRequestContent(t *testing.T) {
	t.Parallel()

	secret := "private-release-title"
	matcher := NewMatcher()
	_, err := matcher.MatchPatterns(secret+strings.Repeat("x", maxTextCharacters), []string{"safe"})
	if err == nil {
		t.Fatal("expected text limit error")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatal("limit error leaked request content")
	}
}

type fakeDynamicRegex struct {
	match   bool
	failure regexFailure
	onMatch func()
}

func (re fakeDynamicRegex) isMatch(string) (bool, regexFailure) {
	if re.onMatch != nil {
		re.onMatch()
	}
	return re.match, re.failure
}

type matcherGoldenRecord struct {
	ID      string `json:"id"`
	Request struct {
		Body string `json:"body"`
		Path string `json:"path"`
	} `json:"request"`
	Response struct {
		Status      int             `json:"status"`
		DecodedBody json.RawMessage `json:"decodedBody"`
	} `json:"response"`
}

func readMatcherGoldens(t *testing.T, filename string) []matcherGoldenRecord {
	t.Helper()
	path := filepath.Join("..", "..", "testdata", "golden", filename)
	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	t.Cleanup(func() { _ = file.Close() })

	records := make([]matcherGoldenRecord, 0)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var record matcherGoldenRecord
		unmarshalMatcherGolden(t, scanner.Bytes(), &record)
		records = append(records, record)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan %s: %v", path, err)
	}
	return records
}

func unmarshalMatcherGolden(t *testing.T, data []byte, target any) {
	t.Helper()
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatalf("decode matcher golden: %v", err)
	}
}
