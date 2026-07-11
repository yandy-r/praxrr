package parser

import (
	"errors"
	"strings"
	"time"

	"github.com/dlclark/regexp2/v2"
)

const (
	dynamicRegexTimeout = 100 * time.Millisecond
	staticRegexTimeout  = 250 * time.Millisecond
	regexStackLimit     = 100000
)

type regexOptions uint8

const (
	regexIgnoreCase regexOptions = 1 << iota
	regexIgnorePatternWhitespace
)

type regexFailure string

const (
	regexFailureNone    regexFailure = ""
	regexFailureInvalid regexFailure = "invalid"
	regexFailureTimeout regexFailure = "timeout"
	regexFailureStack   regexFailure = "stack"
	regexFailureEngine  regexFailure = "engine"
)

// compiledRegex is the sole boundary around regexp2. Callers receive copied
// capture values and safe failure classes, never engine errors containing
// release titles or patterns.
type compiledRegex struct {
	engine *regexp2.Regexp
}

type regexCapture struct {
	value      string
	runeIndex  int
	runeLength int
}

type regexGroup struct {
	name     string
	value    string
	captures []regexCapture
}

type regexMatch struct {
	value      string
	runeIndex  int
	runeLength int
	groups     map[string]regexGroup
}

func mustCompileStaticRegex(pattern string, options regexOptions) *compiledRegex {
	re, err := compileRegex(pattern, options, staticRegexTimeout)
	if err != nil {
		// Static expressions are developer-controlled and serving with one
		// missing would change parser precedence. Do not include the expression.
		panic("parser: invalid static regular expression")
	}
	return re
}

func compileDynamicRegex(pattern string) (*compiledRegex, regexFailure) {
	re, err := compileRegex(pattern, regexIgnoreCase, dynamicRegexTimeout)
	if err != nil {
		return nil, regexFailureInvalid
	}
	return re, regexFailureNone
}

func matchesDynamicRegex(pattern, input string) (bool, regexFailure) {
	re, failure := compileDynamicRegex(pattern)
	if failure != regexFailureNone {
		return false, failure
	}
	return re.isMatch(input)
}

func compileRegex(pattern string, options regexOptions, timeout time.Duration) (*compiledRegex, error) {
	compileOptions := []regexp2.CompileOption{
		regexp2.OptionMaxBacktrackingStackSize(regexStackLimit),
	}
	if options&regexIgnoreCase != 0 {
		compileOptions = append(compileOptions, regexp2.IgnoreCase)
	}
	if options&regexIgnorePatternWhitespace != 0 {
		compileOptions = append(compileOptions, regexp2.IgnorePatternWhitespace)
	}

	re, err := regexp2.Compile(pattern, compileOptions...)
	if err != nil {
		return nil, err
	}
	re.MatchTimeout = timeout
	return &compiledRegex{engine: re}, nil
}

func (re *compiledRegex) isMatch(input string) (bool, regexFailure) {
	return runRegexBool(func() (bool, error) {
		return re.engine.MatchString(input)
	})
}

func (re *compiledRegex) firstMatch(input string) (regexMatch, bool, regexFailure) {
	match, err := re.engine.FindStringMatch(input)
	if err != nil {
		return regexMatch{}, false, classifyRegexError(err)
	}
	if match == nil {
		return regexMatch{}, false, regexFailureNone
	}
	return copyRegexMatch(match), true, regexFailureNone
}

func (re *compiledRegex) allMatches(input string) ([]regexMatch, regexFailure) {
	match, err := re.engine.FindStringMatch(input)
	if err != nil {
		return nil, classifyRegexError(err)
	}

	matches := make([]regexMatch, 0)
	for match != nil {
		matches = append(matches, copyRegexMatch(match))
		match, err = re.engine.FindNextMatch(match)
		if err != nil {
			return nil, classifyRegexError(err)
		}
	}
	return matches, regexFailureNone
}

// replace uses regexp2's native replacement parser so $1, ${name}, $&, $`,
// $', $+ and $_ retain .NET replacement behavior.
func (re *compiledRegex) replace(input, replacement string) (string, regexFailure) {
	result, err := re.engine.Replace(input, replacement, -1, -1)
	if err != nil {
		return input, classifyRegexError(err)
	}
	return result, regexFailureNone
}

func (re *compiledRegex) replaceFunc(
	input string,
	replacer func(regexMatch) string,
) (string, regexFailure) {
	result, err := re.engine.ReplaceFunc(input, func(match regexp2.Match) string {
		return replacer(copyRegexMatch(&match))
	}, -1, -1)
	if err != nil {
		return input, classifyRegexError(err)
	}
	return result, regexFailureNone
}

func (match regexMatch) group(name string) (regexGroup, bool) {
	group, ok := match.groups[name]
	return group, ok
}

func (group regexGroup) allCaptureValues() []string {
	values := make([]string, len(group.captures))
	for index, capture := range group.captures {
		values[index] = capture.value
	}
	return values
}

func copyRegexMatch(match *regexp2.Match) regexMatch {
	groups := match.Groups()
	copiedGroups := make(map[string]regexGroup, len(groups))
	for _, group := range groups {
		captures := make([]regexCapture, len(group.Captures))
		for index := range group.Captures {
			capture := &group.Captures[index]
			captures[index] = regexCapture{
				value:      capture.String(),
				runeIndex:  capture.RuneIndex,
				runeLength: capture.RuneLength,
			}
		}
		copiedGroups[group.Name] = regexGroup{
			name:     group.Name,
			value:    group.String(),
			captures: captures,
		}
	}

	return regexMatch{
		value:      match.String(),
		runeIndex:  match.RuneIndex,
		runeLength: match.RuneLength,
		groups:     copiedGroups,
	}
}

func classifyRegexError(err error) regexFailure {
	if err == nil {
		return regexFailureNone
	}
	if errors.Is(err, regexp2.ErrBacktrackingStackLimit) {
		return regexFailureStack
	}
	// regexp2 v2.3.0 has no exported timeout sentinel. Its timeout error also
	// embeds the input, so compare only its stable prefix and never retain it.
	if strings.HasPrefix(err.Error(), "match timeout after ") {
		return regexFailureTimeout
	}
	return regexFailureEngine
}

func runRegexBool(operation func() (bool, error)) (bool, regexFailure) {
	matched, err := operation()
	if err != nil {
		return false, classifyRegexError(err)
	}
	return matched, regexFailureNone
}
