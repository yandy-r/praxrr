package parser

import (
	"strings"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

var languageRegex = mustCompileStaticRegex(
	`(?:\W|_|^)(?<english>\beng\b)|
	 (?<italian>\b(?:ita|italian)\b)|
	 (?<german>(?:swiss)?german\b|videomann|ger[. ]dub|\bger\b)|
	 (?<flemish>flemish)|
	 (?<bulgarian>bgaudio)|
	 (?<romanian>rodubbed)|
	 (?<brazilian>\b(dublado|pt-BR)\b)|
	 (?<greek>greek)|
	 (?<french>\b(?:FR|VO|VF|VFF|VFQ|VFI|VF2|TRUEFRENCH|FRENCH|FRE|FRA)\b)|
	 (?<russian>\b(?:rus|ru)\b)|
	 (?<hungarian>\b(?:HUNDUB|HUN)\b)|
	 (?<hebrew>\b(?:HebDub|HebDubbed)\b)|
	 (?<polish>\b(?:PL\W?DUB|DUB\W?PL|LEK\W?PL|PL\W?LEK)\b)|
	 (?<chinese>\[(?:CH[ST]|BIG5|GB)\]|简|繁|字幕)|
	 (?<ukrainian>(?:(?:\dx)?UKR))|
	 (?<spanish>\b(?:español|castellano)\b)|
	 (?<catalan>\b(?:catalan?|catalán|català)\b)|
	 (?<latvian>\b(?:lat|lav|lv)\b)|
	 (?<telugu>\btel\b)|
	 (?<vietnamese>\bVIE\b)|
	 (?<japanese>\bJAP\b)|
	 (?<korean>\bKOR\b)|
	 (?<urdu>\burdu\b)|
	 (?<romansh>\b(?:romansh|rumantsch|romansch)\b)|
	 (?<mongolian>\b(?:mongolian|khalkha)\b)|
	 (?<georgian>\b(?:georgian|geo|ka|kat)\b)|
	 (?<original>\b(?:orig|original)\b)`,
	regexIgnoreCase|regexIgnorePatternWhitespace,
)

var caseSensitiveLanguageRegex = mustCompileStaticRegex(
	`(?:(?i)(?<!SUB[\W|_|^]))(?:(?<english>\bEN\b)|
	 (?<lithuanian>\bLT\b)|
	 (?<czech>\bCZ\b)|
	 (?<polish>\bPL\b)|
	 (?<bulgarian>\bBG\b)|
	 (?<slovak>\bSK\b)|
	 (?<german>\bDE\b)|
	 (?<spanish>\b(?<!DTS[._ -])ES\b))(?:(?i)(?![\W|_|^]SUB))`,
	regexIgnorePatternWhitespace,
)

var germanDualLanguageRegex = mustCompileStaticRegex(
	`(?<!WEB[-_. ]?)\bDL\b`,
	regexIgnoreCase,
)

var germanMultiLanguageRegex = mustCompileStaticRegex(`\bML\b`, regexIgnoreCase)

type languageMarker struct {
	marker   string
	language contract.Language
}

// fullWordLanguageMarkers intentionally mirrors the source if-statements.
// Substring checks and declaration order are observable legacy behavior.
var fullWordLanguageMarkers = []languageMarker{
	{marker: "english", language: contract.LanguageEnglish},
	{marker: "spanish", language: contract.LanguageSpanish},
	{marker: "danish", language: contract.LanguageDanish},
	{marker: "dutch", language: contract.LanguageDutch},
	{marker: "japanese", language: contract.LanguageJapanese},
	{marker: "icelandic", language: contract.LanguageIcelandic},
	{marker: "mandarin", language: contract.LanguageChinese},
	{marker: "cantonese", language: contract.LanguageChinese},
	{marker: "chinese", language: contract.LanguageChinese},
	{marker: "korean", language: contract.LanguageKorean},
	{marker: "russian", language: contract.LanguageRussian},
	{marker: "romanian", language: contract.LanguageRomanian},
	{marker: "hindi", language: contract.LanguageHindi},
	{marker: "arabic", language: contract.LanguageArabic},
	{marker: "thai", language: contract.LanguageThai},
	{marker: "bulgarian", language: contract.LanguageBulgarian},
	{marker: "polish", language: contract.LanguagePolish},
	{marker: "vietnamese", language: contract.LanguageVietnamese},
	{marker: "swedish", language: contract.LanguageSwedish},
	{marker: "norwegian", language: contract.LanguageNorwegian},
	{marker: "finnish", language: contract.LanguageFinnish},
	{marker: "turkish", language: contract.LanguageTurkish},
	{marker: "portuguese", language: contract.LanguagePortuguese},
	{marker: "brazilian", language: contract.LanguagePortugueseBR},
	{marker: "hungarian", language: contract.LanguageHungarian},
	{marker: "hebrew", language: contract.LanguageHebrew},
	{marker: "ukrainian", language: contract.LanguageUkrainian},
	{marker: "persian", language: contract.LanguagePersian},
	{marker: "bengali", language: contract.LanguageBengali},
	{marker: "slovak", language: contract.LanguageSlovak},
	{marker: "latvian", language: contract.LanguageLatvian},
	{marker: "latino", language: contract.LanguageSpanishLatino},
	{marker: "tamil", language: contract.LanguageTamil},
	{marker: "telugu", language: contract.LanguageTelugu},
	{marker: "malayalam", language: contract.LanguageMalayalam},
	{marker: "kannada", language: contract.LanguageKannada},
	{marker: "albanian", language: contract.LanguageAlbanian},
	{marker: "afrikaans", language: contract.LanguageAfrikaans},
	{marker: "marathi", language: contract.LanguageMarathi},
	{marker: "tagalog", language: contract.LanguageTagalog},
}

var caseSensitiveLanguageGroups = []languageMarker{
	{marker: "english", language: contract.LanguageEnglish},
	{marker: "lithuanian", language: contract.LanguageLithuanian},
	{marker: "czech", language: contract.LanguageCzech},
	{marker: "polish", language: contract.LanguagePolish},
	{marker: "bulgarian", language: contract.LanguageBulgarian},
	{marker: "slovak", language: contract.LanguageSlovak},
	{marker: "spanish", language: contract.LanguageSpanish},
	{marker: "german", language: contract.LanguageGerman},
}

var caseInsensitiveLanguageGroups = []languageMarker{
	{marker: "english", language: contract.LanguageEnglish},
	{marker: "italian", language: contract.LanguageItalian},
	{marker: "german", language: contract.LanguageGerman},
	{marker: "flemish", language: contract.LanguageFlemish},
	{marker: "greek", language: contract.LanguageGreek},
	{marker: "french", language: contract.LanguageFrench},
	{marker: "russian", language: contract.LanguageRussian},
	{marker: "bulgarian", language: contract.LanguageBulgarian},
	{marker: "brazilian", language: contract.LanguagePortugueseBR},
	{marker: "hungarian", language: contract.LanguageHungarian},
	{marker: "hebrew", language: contract.LanguageHebrew},
	{marker: "polish", language: contract.LanguagePolish},
	{marker: "chinese", language: contract.LanguageChinese},
	{marker: "spanish", language: contract.LanguageSpanish},
	{marker: "catalan", language: contract.LanguageCatalan},
	{marker: "ukrainian", language: contract.LanguageUkrainian},
	{marker: "latvian", language: contract.LanguageLatvian},
	{marker: "romanian", language: contract.LanguageRomanian},
	{marker: "telugu", language: contract.LanguageTelugu},
	{marker: "vietnamese", language: contract.LanguageVietnamese},
	{marker: "japanese", language: contract.LanguageJapanese},
	{marker: "korean", language: contract.LanguageKorean},
	{marker: "urdu", language: contract.LanguageUrdu},
	{marker: "romansh", language: contract.LanguageRomansh},
	{marker: "mongolian", language: contract.LanguageMongolian},
	{marker: "georgian", language: contract.LanguageGeorgian},
	{marker: "original", language: contract.LanguageOriginal},
}

func parseLanguages(title string) []contract.Language {
	languages := make([]contract.Language, 0)
	lowerTitle := strings.ToLower(title)

	// Pass one: full-word source checks. These are intentionally substring
	// checks rather than boundary-aware regular expressions.
	for _, marker := range fullWordLanguageMarkers {
		if strings.Contains(lowerTitle, marker.marker) {
			languages = append(languages, marker.language)
		}
	}

	// Pass two: uppercase abbreviations with subtitle and DTS exclusions.
	languages = appendLanguageRegexMatches(
		languages,
		caseSensitiveLanguageRegex,
		title,
		caseSensitiveLanguageGroups,
	)

	// Pass three: general aliases and Unicode language markers.
	languages = appendLanguageRegexMatches(
		languages,
		languageRegex,
		title,
		caseInsensitiveLanguageGroups,
	)

	if len(languages) == 0 {
		languages = append(languages, contract.LanguageUnknown)
	}

	// DL and ML expand only a German-only result. WEB-DL is explicitly not a
	// dual-language marker.
	if len(languages) == 1 && languages[0] == contract.LanguageGerman {
		if matched, failure := germanDualLanguageRegex.isMatch(title); failure == regexFailureNone && matched {
			languages = append(languages, contract.LanguageOriginal)
		} else if matched, failure := germanMultiLanguageRegex.isMatch(title); failure == regexFailureNone && matched {
			languages = append(languages, contract.LanguageOriginal, contract.LanguageEnglish)
		}
	}

	return distinctLanguages(languages)
}

func appendLanguageRegexMatches(
	languages []contract.Language,
	re *compiledRegex,
	title string,
	groups []languageMarker,
) []contract.Language {
	matches, failure := re.allMatches(title)
	if failure != regexFailureNone {
		return languages
	}

	for _, match := range matches {
		for _, group := range groups {
			matchedGroup, ok := match.group(group.marker)
			if ok && len(matchedGroup.captures) != 0 {
				languages = append(languages, group.language)
			}
		}
	}
	return languages
}

func distinctLanguages(languages []contract.Language) []contract.Language {
	distinct := make([]contract.Language, 0, len(languages))
	for _, language := range languages {
		seen := false
		for _, existing := range distinct {
			if existing == language {
				seen = true
				break
			}
		}
		if !seen {
			distinct = append(distinct, language)
		}
	}
	return distinct
}
