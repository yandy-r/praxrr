package parser

import "strings"

// regexReplacement is the Go counterpart of RegexReplace. It deliberately
// keeps match detection and replacement as one operation so TryReplace callers
// can preserve the C# mutation semantics.
type regexReplacement struct {
	regex       *compiledRegex
	replacement string
}

func mustCompileRegexReplacement(
	pattern string,
	replacement string,
	options regexOptions,
) *regexReplacement {
	return &regexReplacement{
		regex:       mustCompileStaticRegex(pattern, options),
		replacement: replacement,
	}
}

func (replacement *regexReplacement) replace(input string) (string, regexFailure) {
	return replacement.regex.replace(input, replacement.replacement)
}

func (replacement *regexReplacement) tryReplace(
	input string,
) (output string, matched bool, failure regexFailure) {
	matched, failure = replacement.regex.isMatch(input)
	if failure != regexFailureNone {
		return input, false, failure
	}

	output, failure = replacement.replace(input)
	if failure != regexFailureNone {
		return input, false, failure
	}
	return output, matched, regexFailureNone
}

// The legacy list is intentionally empty. Keep it as an ordered slice because
// the title, episode, and release-group parsers stop after the first matching
// substitution.
var preSubstitutionRegex = []*regexReplacement{}

// Valid TLDs - removes website prefixes like [www.example.com] or
// www.example.com -. The Naruto-Kun exception and expression order are legacy
// behavior, not simplification opportunities.
var websitePrefixRegex = mustCompileRegexReplacement(
	`^(?:(?:\[|\()\s*)?(?:www\.)?[-a-z0-9-]{1,256}\.(?<!Naruto-Kun\.)(?:[a-z]{2,6}\.[a-z]{2,6}|xn--[a-z0-9-]{4,}|[a-z]{2,})\b(?:\s*(?:\]|\))|[ -]{2,})[ -]*`,
	"",
	regexIgnoreCase,
)

var websitePostfixRegex = mustCompileRegexReplacement(
	`(?:\[\s*)?(?:www\.)?[-a-z0-9-]{1,256}\.(?:xn--[a-z0-9-]{4,}|[a-z]{2,6})\b(?:\s*\])$`,
	"",
	regexIgnoreCase,
)

// Removes torrent site suffixes like [ettv], [rartv], etc.
var cleanTorrentSuffixRegex = mustCompileRegexReplacement(
	`\[(?:ettv|rartv|rarbg|cttv|publichd)\]$`,
	"",
	regexIgnoreCase,
)

var videoExtensions = map[string]struct{}{
	".mkv":  {},
	".mp4":  {},
	".avi":  {},
	".wmv":  {},
	".mov":  {},
	".m4v":  {},
	".mpg":  {},
	".mpeg": {},
	".m2ts": {},
	".ts":   {},
	".flv":  {},
	".webm": {},
	".vob":  {},
	".ogv":  {},
	".divx": {},
	".xvid": {},
	".3gp":  {},
	".asf":  {},
	".rm":   {},
	".rmvb": {},
	".iso":  {},
	".img":  {},
}

var usenetExtensions = map[string]struct{}{
	".par2": {},
	".nzb":  {},
}

var fileExtensionRegex = mustCompileStaticRegex(`\.[a-z0-9]{2,4}$`, regexIgnoreCase)

func removeFileExtension(title string) string {
	result, failure := fileExtensionRegex.replaceFunc(title, func(match regexMatch) string {
		extension := strings.ToLower(match.value)
		if _, ok := videoExtensions[extension]; ok {
			return ""
		}
		if _, ok := usenetExtensions[extension]; ok {
			return ""
		}
		return match.value
	})
	if failure != regexFailureNone {
		// replaceFunc returns the original input on failure. Static cleanup is
		// linear and request sizes are bounded, so this is only a defensive
		// content-preserving fallback.
		return title
	}
	return result
}
