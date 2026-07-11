package parser

import (
	"errors"
	"math"
	"runtime"
	"strings"
	"testing"
)

func TestLimitMeasuredBoundaries(t *testing.T) {
	t.Parallel()

	if err := validateRequestBodySize(maxRequestBodyBytes); err != nil {
		t.Fatalf("maximum body rejected: %v", err)
	}
	assertLimitClass(t, validateRequestBodySize(maxRequestBodyBytes+1), limitRequestBody)

	if err := validateRegexWork(
		[]string{strings.Repeat("x", maxTextCharacters)},
		[]string{strings.Repeat("p", maxPatternCharacters)},
	); err != nil {
		t.Fatalf("maximum element sizes rejected: %v", err)
	}
	assertLimitClass(t, validateRegexWork(
		[]string{strings.Repeat("x", maxTextCharacters+1)}, []string{"p"},
	), limitTextSize)
	assertLimitClass(t, validateRegexWork(
		[]string{"x"}, []string{strings.Repeat("p", maxPatternCharacters+1)},
	), limitPatternSize)
}

func TestLimitUnicodeCountsCharactersNotBytes(t *testing.T) {
	t.Parallel()

	text := strings.Repeat("😀", maxTextCharacters)
	if err := validateRegexWork([]string{text}, []string{"safe"}); err != nil {
		t.Fatalf("maximum rune count rejected: %v", err)
	}
	assertLimitClass(t, validateRegexWork([]string{text + "😀"}, []string{"safe"}), limitTextSize)
}

func TestLimitCountsUniqueKeysAndWork(t *testing.T) {
	t.Parallel()

	texts := numberedStrings("text", maxTextCount)
	patterns := numberedStrings("pattern", maxPatternCount)
	assertLimitClass(t, validateRegexWork(texts, patterns), limitWorkProduct)

	// The exact approved work ceiling remains admissible.
	if err := validateRegexWork(numberedStrings("text", 50), patterns); err != nil {
		t.Fatalf("maximum work product rejected: %v", err)
	}

	// Duplicates consume submitted count but collapse before key/work checks.
	duplicateTexts := make([]string, maxTextCount)
	duplicatePatterns := make([]string, maxPatternCount)
	for index := range duplicateTexts {
		duplicateTexts[index] = "same-text"
	}
	for index := range duplicatePatterns {
		duplicatePatterns[index] = "same-pattern"
	}
	if err := validateRegexWork(duplicateTexts, duplicatePatterns); err != nil {
		t.Fatalf("duplicate request rejected: %v", err)
	}

	assertLimitClass(t, validateRegexWork(make([]string, maxTextCount+1), []string{"p"}), limitTextCount)
	assertLimitClass(t, validateRegexWork([]string{"t"}, make([]string, maxPatternCount+1)), limitPatternCount)
}

func TestLimitOverflowSafeArithmetic(t *testing.T) {
	t.Parallel()

	if !sumExceedsLimit(math.MaxInt, 1, math.MaxInt) {
		t.Fatal("overflowing sum was accepted")
	}
	if !productExceedsLimit(math.MaxInt, 2, math.MaxInt) {
		t.Fatal("overflowing product was accepted")
	}
	if productExceedsLimit(0, math.MaxInt, maxMatchWorkProduct) {
		t.Fatal("zero product was rejected")
	}
}

func TestLimitBoundedWorkers(t *testing.T) {
	workers := regexWorkerCount()
	if workers < 1 || workers > maxRegexWorkers || workers > runtime.GOMAXPROCS(0) {
		t.Fatalf("regexWorkerCount = %d", workers)
	}
	requests := activeRegexRequestLimit()
	if requests < 1 || requests > maxActiveRegexRequests || requests > workers {
		t.Fatalf("activeRegexRequestLimit = %d", requests)
	}
}

func TestLimitDiagnosticsDoNotContainInput(t *testing.T) {
	t.Parallel()

	secret := "private-release-title"
	err := validateRegexWork([]string{secret + strings.Repeat("x", maxTextCharacters)}, []string{"p"})
	if err == nil {
		t.Fatal("expected limit error")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatal("limit error leaked request content")
	}
}

func assertLimitClass(t *testing.T, err error, want limitClass) {
	t.Helper()
	var violation *limitError
	if !errors.As(err, &violation) {
		t.Fatalf("error = %v; want limitError", err)
	}
	if violation.Class() != want {
		t.Fatalf("limit class = %q; want %q", violation.Class(), want)
	}
}

func numberedStrings(prefix string, count int) []string {
	values := make([]string, count)
	for index := range values {
		values[index] = prefix + string(rune(index+1))
	}
	return values
}
