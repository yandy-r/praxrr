package parser

import (
	"fmt"
	"testing"
)

func TestCommonRemoveFileExtensionAllowlist(t *testing.T) {
	t.Parallel()

	video := []string{
		".mkv", ".mp4", ".avi", ".wmv", ".mov", ".m4v", ".mpg", ".mpeg",
		".m2ts", ".ts", ".flv", ".webm", ".vob", ".ogv", ".divx", ".xvid",
		".3gp", ".asf", ".rm", ".rmvb", ".iso", ".img",
	}
	for _, extension := range append(video, ".par2", ".nzb") {
		t.Run(extension, func(t *testing.T) {
			if got := removeFileExtension("Release" + extension); got != "Release" {
				t.Fatalf("removeFileExtension() = %q; want Release", got)
			}
		})
	}

	// Oracle fixture domain-movie-hash-rejected proves the case-insensitive
	// .mkv removal occurs before hash rejection.
	if got := removeFileExtension("0123456789abcdef0123456789abcdef.MKV"); got != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("oracle extension cleanup = %q", got)
	}

	// Oracle fixture domain-release-group-obfuscation-cleanup relies on this
	// stage removing only the extension; the release-group parser owns the
	// subsequent -Obfuscated cleanup.
	if got := removeFileExtension("Film.2020.WEB-DL-REALGROUP-Obfuscated.mkv"); got != "Film.2020.WEB-DL-REALGROUP-Obfuscated" {
		t.Fatalf("oracle obfuscation input cleanup = %q", got)
	}
}

func TestCommonRemoveFileExtensionPreservesUnknownAndMalformedSuffixes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
	}{
		{name: "empty", input: ""},
		{name: "whitespace", input: " \t\r\n"},
		{name: "unknown subtitle", input: "Release.srt"},
		{name: "unknown jpeg", input: "Release.jpeg"},
		{name: "one character", input: "Release.x"},
		{name: "five characters", input: "Release.abcde"},
		{name: "trailing dot", input: "Release."},
		{name: "trailing whitespace", input: "Release.mkv "},
		{name: "unknown final suffix", input: "Release.mkv.exe"},
		{name: "unicode suffix", input: "作品.mkv界"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := removeFileExtension(test.input); got != test.input {
				t.Fatalf("removeFileExtension(%q) = %q; want unchanged", test.input, got)
			}
		})
	}
}

func TestCommonWebsiteCleanup(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		replacement *regexReplacement
		input       string
		want        string
	}{
		{name: "bare prefix", replacement: websitePrefixRegex, input: "www.example.com - Film", want: "Film"},
		{name: "bracketed prefix", replacement: websitePrefixRegex, input: "[example.co.uk]-- Film", want: "Film"},
		{name: "punycode prefix", replacement: websitePrefixRegex, input: "xn--site-test.com  Film", want: "Film"},
		{name: "Naruto Kun exception", replacement: websitePrefixRegex, input: "Naruto-Kun.com - Film", want: "Naruto-Kun.com - Film"},
		{name: "malformed prefix", replacement: websitePrefixRegex, input: "[example.com Film", want: "[example.com Film"},
		{name: "bracketed postfix", replacement: websitePostfixRegex, input: "Film [www.example.com]", want: "Film "},
		// Despite the optional opening bracket, the legacy expression requires
		// a closing bracket. Preserve that asymmetric malformed-input quirk.
		{name: "bare postfix preserved", replacement: websitePostfixRegex, input: "Film www.example.com", want: "Film www.example.com"},
		{name: "unicode domain preserved", replacement: websitePostfixRegex, input: "Film.例子.测试", want: "Film.例子.测试"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, failure := test.replacement.replace(test.input)
			if failure != regexFailureNone || got != test.want {
				t.Fatalf("replace(%q) = %q, %q; want %q, no failure", test.input, got, failure, test.want)
			}
		})
	}
}

func TestCommonTorrentSuffixCleanup(t *testing.T) {
	t.Parallel()

	for _, suffix := range []string{"ettv", "rartv", "rarbg", "cttv", "publichd"} {
		t.Run(suffix, func(t *testing.T) {
			input := "Film[" + suffix + "]"
			got, failure := cleanTorrentSuffixRegex.replace(input)
			if failure != regexFailureNone || got != "Film" {
				t.Fatalf("replace(%q) = %q, %q; want Film", input, got, failure)
			}
		})
	}

	for _, input := range []string{"", "Film[ETTV] ", "Film[unknown]", "Film（ettv）"} {
		got, failure := cleanTorrentSuffixRegex.replace(input)
		if failure != regexFailureNone || got != input {
			t.Fatalf("replace(%q) = %q, %q; want unchanged", input, got, failure)
		}
	}
}

func TestCommonRegexReplacementDotNETSemantics(t *testing.T) {
	t.Parallel()

	replacement := mustCompileRegexReplacement(
		`(?<word>[a-z]+)-(\d+)`,
		`${word}:$1 [$&]`,
		regexIgnoreCase,
	)

	got, failure := replacement.replace("abc-12 DEF-34")
	if failure != regexFailureNone || got != "abc:12 [abc-12] DEF:34 [DEF-34]" {
		t.Fatalf("replace() = %q, %q", got, failure)
	}

	got, matched, failure := replacement.tryReplace("no match")
	if failure != regexFailureNone || matched || got != "no match" {
		t.Fatalf("tryReplace(no match) = %q, %v, %q", got, matched, failure)
	}

	got, matched, failure = replacement.tryReplace("abc-12")
	if failure != regexFailureNone || !matched || got != "abc:12 [abc-12]" {
		t.Fatalf("tryReplace(match) = %q, %v, %q", got, matched, failure)
	}
}

func TestCommonPreSubstitutionOrderAndUnicodeWhitespace(t *testing.T) {
	t.Parallel()

	if len(preSubstitutionRegex) != 0 {
		t.Fatalf("preSubstitutionRegex length = %d; want legacy empty list", len(preSubstitutionRegex))
	}

	// .NET \s accepts Unicode space separators. Keep that behavior at the
	// centralized regex boundary rather than normalizing the title first.
	input := "[example.com\u2003]Film"
	got, failure := websitePrefixRegex.replace(input)
	if failure != regexFailureNone || got != "Film" {
		t.Fatalf("Unicode whitespace cleanup = %q, %q; input runes %v", got, failure, fmt.Sprint([]rune(input)))
	}
}
