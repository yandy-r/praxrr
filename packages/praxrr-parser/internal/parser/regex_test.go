package parser

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestRegexDefaultDotNETMode(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		pattern string
		input   string
		want    bool
	}{
		{name: "lookbehind", pattern: `(?<=prefix-)\d+`, input: "prefix-123", want: true},
		{name: "atomic", pattern: `^(?>a|ab)c$`, input: "abc", want: false},
		{name: "named backreference", pattern: `^(?<word>abc)-\k<word>$`, input: "abc-abc", want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			re, failure := compileDynamicRegex(test.pattern)
			if failure != regexFailureNone {
				t.Fatalf("compileDynamicRegex failure = %q", failure)
			}
			got, failure := re.isMatch(test.input)
			if failure != regexFailureNone || got != test.want {
				t.Fatalf("isMatch() = %v, %q; want %v, no failure", got, failure, test.want)
			}
		})
	}
}

func TestRegexNamedAndRepeatedCaptures(t *testing.T) {
	t.Parallel()

	re := mustCompileStaticRegex(`(?<episode>\d+)(?:-(?<episode>\d+))*`, 0)
	match, ok, failure := re.firstMatch("12-13-14")
	if failure != regexFailureNone || !ok {
		t.Fatalf("firstMatch() = _, %v, %q; want match", ok, failure)
	}
	group, ok := match.group("episode")
	if !ok {
		t.Fatal("named group episode missing")
	}
	if group.value != "14" {
		t.Fatalf("last group value = %q; want 14", group.value)
	}
	if got := group.allCaptureValues(); fmt.Sprint(got) != "[12 13 14]" {
		t.Fatalf("all capture values = %v; want [12 13 14]", got)
	}
}

func TestRegexAllMatchesIncludingZeroWidth(t *testing.T) {
	t.Parallel()

	re := mustCompileStaticRegex(`(?<word>\w+)|(?=$)`, 0)
	matches, failure := re.allMatches("one two")
	if failure != regexFailureNone {
		t.Fatalf("allMatches failure = %q", failure)
	}
	values := make([]string, len(matches))
	for index, match := range matches {
		values[index] = match.value
	}
	if fmt.Sprint(values) != "[one two ]" {
		t.Fatalf("all match values = %q; want [one two empty]", values)
	}
}

func TestRegexDotNETReplacement(t *testing.T) {
	t.Parallel()

	re := mustCompileStaticRegex(`(?<first>\w+)\s+(?<last>\w+)`, 0)
	got, failure := re.replace("Ada Lovelace", `${last}, ${first} [$&]`)
	if failure != regexFailureNone {
		t.Fatalf("replace failure = %q", failure)
	}
	if got != "Lovelace, Ada [Ada Lovelace]" {
		t.Fatalf("replace = %q", got)
	}

	got, failure = re.replaceFunc("Ada Lovelace", func(match regexMatch) string {
		return strings.ToUpper(match.value)
	})
	if failure != regexFailureNone || got != "ADA LOVELACE" {
		t.Fatalf("replaceFunc = %q, %q", got, failure)
	}
}

func TestRegexDynamicFailuresAreFalseAndContentFree(t *testing.T) {
	t.Parallel()

	secretPattern := "(?<private-secret>"
	if re, failure := compileDynamicRegex(secretPattern); re != nil || failure != regexFailureInvalid {
		t.Fatalf("compileDynamicRegex = %v, %q; want nil, invalid", re, failure)
	}
	if matched, failure := matchesDynamicRegex(secretPattern, "secret title"); matched || failure != regexFailureInvalid {
		t.Fatalf("matchesDynamicRegex = %v, %q; want false, invalid", matched, failure)
	}

	stackLimited, err := compileRegex(`(?:^){60000}`, 0, dynamicRegexTimeout)
	if err != nil {
		t.Fatalf("compile stack pattern: %v", err)
	}
	matched, failure := stackLimited.isMatch("")
	if matched || failure != regexFailureStack {
		t.Fatalf("stack-limited isMatch = %v, %q", matched, failure)
	}
	if strings.Contains(string(failure), "private-secret") {
		t.Fatal("failure classification leaked request content")
	}
}

func TestRegexDynamicTimeoutIsFalse(t *testing.T) {
	// The shared regexp2 timeout clock is process-global, so keep this test
	// serial and do not alter its check period.
	re, failure := compileDynamicRegex(`^(a|aa)+$`)
	if failure != regexFailureNone {
		t.Fatalf("compileDynamicRegex failure = %q", failure)
	}

	matched, failure := re.isMatch(strings.Repeat("a", 42) + "b")
	if matched || failure != regexFailureTimeout {
		t.Fatalf("isMatch = %v, %q; want false, timeout", matched, failure)
	}
}

func TestRegexEngineFailureIsFalseAndContentFree(t *testing.T) {
	secret := "private-engine-input"
	matched, failure := runRegexBool(func() (bool, error) {
		return true, errors.New(secret)
	})
	if matched || failure != regexFailureEngine {
		t.Fatalf("runRegexBool = %v, %q; want false, engine", matched, failure)
	}
	if strings.Contains(string(failure), secret) {
		t.Fatal("engine failure classification leaked request content")
	}
}

func TestRegexStaticCompilePanicIsContentFree(t *testing.T) {
	secret := "private-static-pattern-("
	defer func() {
		panicValue := recover()
		if panicValue == nil {
			t.Fatal("mustCompileStaticRegex did not panic")
		}
		if strings.Contains(fmt.Sprint(panicValue), secret) {
			t.Fatal("static compile panic leaked pattern")
		}
	}()
	mustCompileStaticRegex(secret, 0)
}
