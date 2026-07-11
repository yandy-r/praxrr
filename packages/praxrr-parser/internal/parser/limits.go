package parser

import (
	"errors"
	"fmt"
	"runtime"
	"unicode/utf8"
)

// These limits are the approved supported envelope captured in
// testdata/golden/limits.json. Keep changes tied to a new measurement artifact.
const (
	maxRequestBodyBytes  = 105999
	maxTextCharacters    = 1000
	maxPatternCharacters = 1636
	maxTextCount         = 100
	maxPatternCount      = 910
	maxUniqueKeyCount    = 1010
	maxMatchWorkProduct  = 45500

	maxRegexWorkers        = 8
	maxActiveRegexRequests = 8
)

type limitClass string

const (
	limitRequestBody  limitClass = "request_body_bytes"
	limitTextSize     limitClass = "text_characters"
	limitPatternSize  limitClass = "pattern_characters"
	limitTextCount    limitClass = "text_count"
	limitPatternCount limitClass = "pattern_count"
	limitUniqueKeys   limitClass = "unique_key_count"
	limitWorkProduct  limitClass = "text_pattern_work_product"
)

// limitError deliberately carries no request content or measured value. It is
// safe to use as a diagnostic classification without leaking titles or rules.
type limitError struct {
	class limitClass
}

func (e *limitError) Error() string {
	return fmt.Sprintf("parser limit exceeded: %s", e.class)
}

func (e *limitError) Class() limitClass {
	return e.class
}

func validateRequestBodySize(size int64) error {
	if size < 0 || size > maxRequestBodyBytes {
		return &limitError{class: limitRequestBody}
	}
	return nil
}

// RequestBodyLimit returns the measured maximum body size shared by every
// parser HTTP route. The HTTP adapter owns reading the body; keeping the value
// here prevents the transport and regex-work envelopes from drifting apart.
func RequestBodyLimit() int64 {
	return maxRequestBodyBytes
}

// ValidateParseTitle applies the measured per-text envelope before the static
// domain regular expressions run. Empty-title and media-type validation remain
// the HTTP adapter's responsibility because their order and messages are wire
// contract details.
func ValidateParseTitle(title string) error {
	if utf8.RuneCountInString(title) > maxTextCharacters {
		return &limitError{class: limitTextSize}
	}
	return nil
}

// IsLimitError reports whether err is a content-free supported-envelope
// rejection. It intentionally does not expose the submitted value.
func IsLimitError(err error) bool {
	var target *limitError
	return errors.As(err, &target)
}

// validateRegexWork rejects requests before any pattern compilation or match
// operation. Counts are checked both as submitted and as the unique response
// keys used by the legacy wire contract.
func validateRegexWork(texts, patterns []string) error {
	if len(texts) > maxTextCount {
		return &limitError{class: limitTextCount}
	}
	if len(patterns) > maxPatternCount {
		return &limitError{class: limitPatternCount}
	}

	uniqueTexts := make(map[string]struct{}, len(texts))
	for _, text := range texts {
		if utf8.RuneCountInString(text) > maxTextCharacters {
			return &limitError{class: limitTextSize}
		}
		uniqueTexts[text] = struct{}{}
	}

	uniquePatterns := make(map[string]struct{}, len(patterns))
	for _, pattern := range patterns {
		if utf8.RuneCountInString(pattern) > maxPatternCharacters {
			return &limitError{class: limitPatternSize}
		}
		uniquePatterns[pattern] = struct{}{}
	}

	if sumExceedsLimit(len(uniqueTexts), len(uniquePatterns), maxUniqueKeyCount) {
		return &limitError{class: limitUniqueKeys}
	}
	if productExceedsLimit(len(uniqueTexts), len(uniquePatterns), maxMatchWorkProduct) {
		return &limitError{class: limitWorkProduct}
	}
	return nil
}

func sumExceedsLimit(left, right, limit int) bool {
	if left < 0 || right < 0 || limit < 0 {
		return true
	}
	return left > limit || right > limit-left
}

func productExceedsLimit(left, right, limit int) bool {
	if left < 0 || right < 0 || limit < 0 {
		return true
	}
	if left == 0 || right == 0 {
		return false
	}
	return left > limit/right
}

func regexWorkerCount() int {
	workers := runtime.GOMAXPROCS(0)
	if workers < 1 {
		return 1
	}
	if workers > maxRegexWorkers {
		return maxRegexWorkers
	}
	return workers
}

func activeRegexRequestLimit() int {
	workers := regexWorkerCount()
	if workers > maxActiveRegexRequests {
		return maxActiveRegexRequests
	}
	return workers
}
