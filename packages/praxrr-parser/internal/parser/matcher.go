package parser

import (
	"errors"
	"sync"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

// ErrMatcherAtCapacity is returned before pattern compilation when every
// expensive-request slot is occupied. It intentionally contains no request
// content and lets the HTTP boundary apply a stable overload policy.
var ErrMatcherAtCapacity = errors.New("parser matcher at capacity")

type dynamicRegex interface {
	isMatch(string) (bool, regexFailure)
}

type dynamicRegexCompiler func(string) (dynamicRegex, regexFailure)

// Matcher owns admission and scheduling for caller-supplied regular
// expressions. Health checks do not acquire its semaphore, so filling regex
// capacity cannot make health wait behind queued match requests.
type Matcher struct {
	workers  int
	requests chan struct{}
	compile  dynamicRegexCompiler
}

// NewMatcher constructs the process-wide matcher service. Callers should share
// one instance so the active-request limit applies across HTTP requests.
func NewMatcher() *Matcher {
	return newMatcher(regexWorkerCount(), activeRegexRequestLimit(), func(pattern string) (dynamicRegex, regexFailure) {
		return compileDynamicRegex(pattern)
	})
}

func newMatcher(workers, requestLimit int, compile dynamicRegexCompiler) *Matcher {
	if workers < 1 {
		workers = 1
	}
	if requestLimit < 1 {
		requestLimit = 1
	}
	return &Matcher{
		workers:  workers,
		requests: make(chan struct{}, requestLimit),
		compile:  compile,
	}
}

// MatchPatterns evaluates patterns with .NET-compatible, case-insensitive
// semantics. Invalid patterns and engine failures are isolated as false.
func (m *Matcher) MatchPatterns(text string, patterns []string) (contract.MatchResponse, error) {
	batch, err := m.match([]string{text}, patterns)
	if err != nil {
		return contract.NewMatchResponse(), err
	}
	return contract.MatchResponse{Results: batch.Results[text]}, nil
}

// MatchPatternsBatch evaluates the unique text-pattern matrix. Duplicate input
// values collapse to the same map keys as the legacy dictionaries.
func (m *Matcher) MatchPatternsBatch(
	texts []string,
	patterns []string,
) (contract.BatchMatchResponse, error) {
	return m.match(texts, patterns)
}

func (m *Matcher) match(texts, patterns []string) (contract.BatchMatchResponse, error) {
	// Limit validation must precede admission and compilation. Besides avoiding
	// expensive rejected work, this gives one-over requests deterministic errors
	// even when the service is busy.
	if err := validateRegexWork(texts, patterns); err != nil {
		return contract.NewBatchMatchResponse(), err
	}
	if !m.acquire() {
		return contract.NewBatchMatchResponse(), ErrMatcherAtCapacity
	}
	defer m.release()

	uniquePatterns := uniqueStrings(patterns)
	compiled := make([]compiledDynamicPattern, len(uniquePatterns))
	for index, pattern := range uniquePatterns {
		regex, failure := m.compile(pattern)
		compiled[index] = compiledDynamicPattern{
			pattern: pattern,
			regex:   regex,
			valid:   failure == regexFailureNone && regex != nil,
		}
	}

	uniqueTexts := uniqueStrings(texts)
	response := contract.NewBatchMatchResponse()
	if len(uniqueTexts) == 0 {
		return response, nil
	}

	workerCount := m.workers
	if workerCount > len(uniqueTexts) {
		workerCount = len(uniqueTexts)
	}
	jobs := make(chan string, len(uniqueTexts))
	results := make(chan textMatchResult, workerCount)
	for _, text := range uniqueTexts {
		jobs <- text
	}
	close(jobs)

	var workerGroup sync.WaitGroup
	workerGroup.Add(workerCount)
	for range workerCount {
		go func() {
			defer workerGroup.Done()
			matchTextWorker(jobs, results, compiled)
		}()
	}

	// This collector loop is the sole owner of the outer result map. Exactly one
	// result arrives for every unique text, so no closer goroutine is required.
	for range uniqueTexts {
		result := <-results
		response.Results[result.text] = result.patterns
	}
	workerGroup.Wait()
	return response, nil
}

func (m *Matcher) acquire() bool {
	select {
	case m.requests <- struct{}{}:
		return true
	default:
		return false
	}
}

func (m *Matcher) release() {
	<-m.requests
}

type compiledDynamicPattern struct {
	pattern string
	regex   dynamicRegex
	valid   bool
}

type textMatchResult struct {
	text     string
	patterns map[string]bool
}

func matchTextWorker(
	jobs <-chan string,
	results chan<- textMatchResult,
	patterns []compiledDynamicPattern,
) {
	for text := range jobs {
		matches := make(map[string]bool, len(patterns))
		for _, pattern := range patterns {
			matched := false
			if pattern.valid {
				var failure regexFailure
				matched, failure = pattern.regex.isMatch(text)
				if failure != regexFailureNone {
					matched = false
				}
			}
			matches[pattern.pattern] = matched
		}
		results <- textMatchResult{text: text, patterns: matches}
	}
}

func uniqueStrings(values []string) []string {
	unique := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}
