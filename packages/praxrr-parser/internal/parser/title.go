package parser

import (
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"
)

// parsedMovieInfo preserves the legacy movie parser's internal null and zero
// distinctions. The HTTP service maps it onto the explicit contract DTO.
type parsedMovieInfo struct {
	MovieTitles   []string
	Year          int
	Edition       *string
	ImdbID        *string
	TmdbID        int
	ReleaseHash   *string
	HardcodedSubs *string
}

const titleEditionPattern = `\(?\b(?<edition>(((Recut.|Extended.|Ultimate.)?(Director.?s|Collector.?s|Theatrical|Ultimate|Extended|Despecialized|(Special|Rouge|Final|Assembly|Imperial|Diamond|Signature|Hunter|Rekall)(?=(.(Cut|Edition|Version)))|\d{2,3}(th)?.Anniversary)(?:.(Cut|Edition|Version))?(.(Extended|Uncensored|Remastered|Unrated|Uncut|Open.?Matte|IMAX|Fan.?Edit))?|((Uncensored|Remastered|Unrated|Uncut|Open?.Matte|IMAX|Fan.?Edit|Restored|((2|3|4)in1))))))\b\)?`

var titleEditionRegex = mustCompileStaticRegex(titleEditionPattern, regexIgnoreCase)

var titleReportEditionRegex = mustCompileStaticRegex(`^.+?`+titleEditionPattern, regexIgnoreCase)

var titleHardcodedSubsRegex = mustCompileStaticRegex(
	`\b((?<hcsub>(\w+(?<!SOFT|MULTI|HORRIBLE)SUBS?))|(?<hc>(HC|SUBBED)))\b`,
	regexIgnoreCase|regexIgnorePatternWhitespace,
)

// reportMovieTitleRegex is deliberately kept in the declaration order of the
// C# oracle. First successfully parsed match wins.
var titleReportMovieTitleRegex = []*compiledRegex{
	// Anime [Subgroup] and Year.
	mustCompileStaticRegex(`^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)\[!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|x|\d+|\]|\W\d+)))+.*?(?<hash>\[\w{8}\])?(?:$|\.)`, regexIgnoreCase),
	// Anime [Subgroup] no year, versioned title, hash.
	mustCompileStaticRegex(`^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+?)((v)(?:\d{1,2})(?:([-_. ])))(\[.*)?(?:[\[(][^])])?.*?(?<hash>\[\w{8}\])(?:$|\.)`, regexIgnoreCase),
	// Anime [Subgroup] no year, info in double sets of brackets, hash.
	mustCompileStaticRegex(`^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+?)(\[.*).*?(?<hash>\[\w{8}\])(?:$|\.)`, regexIgnoreCase),
	// Anime [Subgroup] no year, info in parentheses or brackets, hash.
	mustCompileStaticRegex(`^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+)(?:[\[(][^])]).*?(?<hash>\[\w{8}\])(?:$|\.)`, regexIgnoreCase),
	// German and French tracker formats.
	mustCompileStaticRegex(`^(?<title>(?![(\[]).+?)((\W|_))(`+titleEditionPattern+`.{1,3})?(?:(?<!(19|20)\d{2}.*?)(?<!(?:Good|The)[_ .-])(German|TrueFrench))(.+?)(?=((19|20)\d{2}|$))(?<year>(19|20)\d{2}(?!p|i|\d+|\]|\W\d+))?(\W+|_|$)(?!\\)`, regexIgnoreCase),
	// Special, Despecialized, etc. Edition movies.
	mustCompileStaticRegex(`^(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)\[!]))*`+titleEditionPattern+`.{1,3}(?<year>(1(8|9)|20)\d{2}(?!p|i|\d+|\]|\W\d+)))+(\W+|_|$)(?!\\)`, regexIgnoreCase),
	// Normal movie format.
	mustCompileStaticRegex(`^(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)\[!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|(1(8|9)|20)\d{2}|\]|\W(1(8|9)|20)\d{2})))+(\W+|_|$)(?!\\)`, regexIgnoreCase),
	// PassThePopcorn torrent names.
	mustCompileStaticRegex(`^(?<title>.+?)?(?:(?:[-_\W](?<![()\[!]))*(?<year>(\[\w *\])))+(\W+|_|$)(?!\\)`, regexIgnoreCase),
	// Some tools use brackets for years.
	mustCompileStaticRegex(`^(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|\d+|\W\d+)))+(\W+|_|$)(?!\\)`, regexIgnoreCase),
	// Last resort for movies with ( or [ in their title.
	mustCompileStaticRegex(`^(?<title>.+?)?(?:(?:[-_\W](?<![)\[!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|\d+|\]|\W\d+)))+(\W+|_|$)(?!\\)`, regexIgnoreCase),
}

var titleReportMovieTitleFolderRegex = []*compiledRegex{
	mustCompileStaticRegex(`^(?:(?:[-_\W](?<![)!]))*(?<year>(19|20)\d{2}(?!p|i|\d+|\W\d+)))+(\W+|_|$)(?<title>.+?)?$`, 0),
}

var titleRejectHashedReleasesRegex = []*compiledRegex{
	mustCompileStaticRegex(`^[0-9a-zA-Z]{32}`, 0),
	mustCompileStaticRegex(`^[a-z0-9]{24}$`, 0),
	mustCompileStaticRegex(`^[A-Z]{11}\d{3}$`, 0),
	mustCompileStaticRegex(`^[a-z]{12}\d{3}$`, 0),
	mustCompileStaticRegex(`^Backup_\d{5,}S\d{2}-\d{2}$`, 0),
	mustCompileStaticRegex(`^123$`, 0),
	mustCompileStaticRegex(`^abc$`, regexIgnoreCase),
	mustCompileStaticRegex(`^abc[-_. ]xyz`, regexIgnoreCase),
	mustCompileStaticRegex(`^b00bs$`, regexIgnoreCase),
}

var titleReversedTitleRegex = mustCompileStaticRegex(`(?:^|[-._ ])(p027|p0801)[-._ ]`, 0)

var titleAlternativeTitleRegex = mustCompileStaticRegex(`[ ]+(?:AKA|\/)[ ]+`, regexIgnoreCase)

var titleBracketedAlternativeTitleRegex = mustCompileRegexReplacement(
	`(.*) \([ ]*AKA[ ]+(.*)\)`,
	`$1 AKA $2`,
	regexIgnoreCase,
)

var titleNormalizeAlternativeTitleRegex = mustCompileRegexReplacement(
	`[ ]+(?:A\.K\.A\.)[ ]+`,
	` AKA `,
	regexIgnoreCase,
)

var titleReportImdbIDRegex = mustCompileStaticRegex(`(?<imdbid>tt\d{7,8})`, regexIgnoreCase)

var titleReportTmdbIDRegex = mustCompileStaticRegex(`tmdb(id)?-(?<tmdbid>\d+)`, regexIgnoreCase)

var titleSimpleTitleRegex = mustCompileRegexReplacement(
	`(?:(480|540|576|720|1080|2160)[ip]|[xh][\W_]?26[45]|DD\W?5\W1|[<>?*]|848x480|1280x720|1920x1080|3840x2160|4096x2160|(8|10)b(it)?|10-bit)\s*?(?![a-b0-9])`,
	``,
	regexIgnoreCase,
)

var titleSimpleReleaseTitleRegex = mustCompileRegexReplacement(`\s*(?:[<>?*|])`, ``, regexIgnoreCase)

var titleCleanQualityBracketsRegex = mustCompileRegexReplacement(
	`\[[a-z0-9 ._-]+\]$`,
	``,
	regexIgnoreCase,
)

var titleRequestInfoRegex = mustCompileRegexReplacement(`^(?:\[.+?\])+`, ``, 0)

func parseMovieTitle(title string, isDir bool) *parsedMovieInfo {
	originalTitle := title

	if !validateMovieTitleBeforeParsing(title) {
		return nil
	}

	reversed, failure := titleReversedTitleRegex.isMatch(title)
	if failure != regexFailureNone {
		return nil
	}
	if reversed {
		titleWithoutExtension := removeFileExtension(title)
		extension := strings.TrimPrefix(title, titleWithoutExtension)
		title = titleReverseUTF16CodeUnits(titleWithoutExtension) + extension
	}

	releaseTitle := removeFileExtension(title)
	// C# string.Trim('-', '_') trims both ends despite the legacy comment.
	releaseTitle = strings.Trim(releaseTitle, "-_")
	releaseTitle = strings.NewReplacer("【", "[", "】", "]").Replace(releaseTitle)

	for _, replacement := range preSubstitutionRegex {
		var matched bool
		releaseTitle, matched, failure = replacement.tryReplace(releaseTitle)
		if failure != regexFailureNone {
			return nil
		}
		if matched {
			break
		}
	}

	simpleTitle, failure := titleSimpleTitleRegex.replace(releaseTitle)
	if failure != regexFailureNone {
		return nil
	}
	for _, replacement := range []*regexReplacement{
		websitePrefixRegex,
		websitePostfixRegex,
		cleanTorrentSuffixRegex,
		titleCleanQualityBracketsRegex,
	} {
		simpleTitle, failure = replacement.replace(simpleTitle)
		if failure != regexFailureNone {
			return nil
		}
	}

	allRegexes := titleReportMovieTitleRegex
	if isDir {
		allRegexes = append(append([]*compiledRegex{}, titleReportMovieTitleRegex...), titleReportMovieTitleFolderRegex...)
	}

	for _, reportRegex := range allRegexes {
		matches, matchFailure := reportRegex.allMatches(simpleTitle)
		if matchFailure != regexFailureNone {
			return nil
		}
		if len(matches) == 0 {
			continue
		}

		result := parseMovieMatchCollection(matches)
		if result == nil {
			continue
		}

		simpleReleaseTitle, replaceFailure := titleSimpleReleaseTitleRegex.replace(releaseTitle)
		if replaceFailure != regexFailureNone {
			return nil
		}
		if result.Edition == nil || strings.TrimSpace(*result.Edition) == "" {
			result.Edition = parseEdition(simpleReleaseTitle)
		}
		result.ReleaseHash = getReleaseHash(matches)
		result.HardcodedSubs = parseHardcodedSubs(originalTitle)
		result.ImdbID = parseImdbID(simpleReleaseTitle)
		result.TmdbID = parseTmdbID(simpleReleaseTitle)
		return result
	}

	return nil
}

func parseImdbID(title string) *string {
	match, matched, failure := titleReportImdbIDRegex.firstMatch(title)
	if failure != regexFailureNone || !matched {
		return nil
	}
	group, ok := titleSuccessfulRegexGroup(match, "imdbid")
	if !ok || (len(group.value) != 9 && len(group.value) != 10) {
		return nil
	}
	value := group.value
	return &value
}

func parseTmdbID(title string) int {
	match, matched, failure := titleReportTmdbIDRegex.firstMatch(title)
	if failure != regexFailureNone || !matched {
		return 0
	}
	group, ok := titleSuccessfulRegexGroup(match, "tmdbid")
	if !ok {
		return 0
	}
	value, err := strconv.ParseInt(group.value, 10, 32)
	if err != nil {
		return 0
	}
	return int(value)
}

func parseEdition(title string) *string {
	match, matched, failure := titleReportEditionRegex.firstMatch(title)
	if failure != regexFailureNone || !matched {
		return nil
	}
	group, ok := titleSuccessfulRegexGroup(match, "edition")
	if !ok || strings.TrimSpace(group.value) == "" {
		return nil
	}
	value := strings.ReplaceAll(group.value, ".", " ")
	return &value
}

func parseHardcodedSubs(title string) *string {
	matches, failure := titleHardcodedSubsRegex.allMatches(title)
	if failure != regexFailureNone || len(matches) == 0 {
		return nil
	}
	lastMatch := matches[len(matches)-1]
	if group, ok := titleSuccessfulRegexGroup(lastMatch, "hcsub"); ok {
		value := group.value
		return &value
	}
	if _, ok := titleSuccessfulRegexGroup(lastMatch, "hc"); ok {
		value := "Generic Hardcoded Subs"
		return &value
	}
	return nil
}

func parseMovieMatchCollection(matches []regexMatch) *parsedMovieInfo {
	if len(matches) == 0 {
		return nil
	}
	titleGroup, ok := titleSuccessfulRegexGroup(matches[0], "title")
	if !ok || titleGroup.value == "(" {
		return nil
	}

	movieName := strings.ReplaceAll(titleGroup.value, "_", " ")
	var failure regexFailure
	movieName, failure = titleNormalizeAlternativeTitleRegex.replace(movieName)
	if failure != regexFailureNone {
		return nil
	}
	movieName, failure = titleRequestInfoRegex.replace(movieName)
	if failure != regexFailureNone {
		return nil
	}
	movieName = strings.Trim(movieName, " ")
	movieName = normalizeMovieTitleDots(movieName)

	year := 0
	if yearGroup, found := titleSuccessfulRegexGroup(matches[0], "year"); found {
		if parsedYear, err := strconv.ParseInt(yearGroup.value, 10, 32); err == nil {
			year = int(parsedYear)
		}
	}
	result := &parsedMovieInfo{Year: year}

	if editionGroup, found := titleSuccessfulRegexGroup(matches[0], "edition"); found {
		value := strings.ReplaceAll(editionGroup.value, ".", " ")
		result.Edition = &value
	}

	movieTitles := []string{movieName}
	unbracketedName, failure := titleBracketedAlternativeTitleRegex.replace(movieName)
	if failure != regexFailureNone {
		return nil
	}
	for _, alternativeName := range titleSplitByRegex(titleAlternativeTitleRegex, unbracketedName) {
		if strings.TrimSpace(alternativeName) != "" && alternativeName != movieName {
			movieTitles = append(movieTitles, alternativeName)
		}
	}
	result.MovieTitles = movieTitles
	return result
}

func validateMovieTitleBeforeParsing(title string) bool {
	lowerTitle := strings.ToLower(title)
	if strings.Contains(lowerTitle, "password") && strings.Contains(lowerTitle, "yenc") {
		return false
	}
	if !strings.ContainsFunc(title, func(value rune) bool {
		return unicode.IsLetter(value) || unicode.IsDigit(value)
	}) {
		return false
	}

	titleWithoutExtension := removeFileExtension(title)
	for _, rejectRegex := range titleRejectHashedReleasesRegex {
		matched, failure := rejectRegex.isMatch(titleWithoutExtension)
		if failure != regexFailureNone || matched {
			return false
		}
	}
	return true
}

func getReleaseHash(matches []regexMatch) *string {
	if len(matches) == 0 {
		return nil
	}
	hashGroup, ok := titleSuccessfulRegexGroup(matches[0], "hash")
	if !ok {
		return nil
	}
	value := strings.Trim(hashGroup.value, "[]")
	if value == "1280x720" {
		return nil
	}
	return &value
}

func titleSuccessfulRegexGroup(match regexMatch, name string) (regexGroup, bool) {
	group, ok := match.group(name)
	return group, ok && len(group.captures) != 0
}

func normalizeMovieTitleDots(movieName string) string {
	parts := strings.Split(movieName, ".")
	var builder strings.Builder
	previousAcronym := false

	for index, part := range parts {
		nextPart := ""
		if index+1 < len(parts) {
			nextPart = parts[index+1]
		}
		_, partNumberError := strconv.ParseInt(part, 10, 32)
		_, nextPartNumberError := strconv.ParseInt(nextPart, 10, 32)
		partIsNumber := partNumberError == nil
		nextPartIsNumber := nextPartNumberError == nil
		lowerPart := strings.ToLower(part)

		if titleUTF16Length(part) == 1 && lowerPart != "a" && !partIsNumber &&
			(previousAcronym || index < len(parts)-1) &&
			(previousAcronym || titleUTF16Length(nextPart) != 1 || !nextPartIsNumber) {
			builder.WriteString(part)
			builder.WriteByte('.')
			previousAcronym = true
		} else if lowerPart == "a" && (previousAcronym || titleUTF16Length(nextPart) == 1) {
			builder.WriteString(part)
			builder.WriteByte('.')
			previousAcronym = true
		} else if lowerPart == "dr" {
			builder.WriteString(part)
			builder.WriteByte('.')
			previousAcronym = true
		} else {
			if previousAcronym {
				builder.WriteByte(' ')
				previousAcronym = false
			}
			builder.WriteString(part)
			builder.WriteByte(' ')
		}
	}

	return strings.Trim(builder.String(), " ")
}

func titleSplitByRegex(regex *compiledRegex, input string) []string {
	matches, failure := regex.allMatches(input)
	if failure != regexFailureNone || len(matches) == 0 {
		return []string{input}
	}
	runes := []rune(input)
	parts := make([]string, 0, len(matches)+1)
	start := 0
	for _, match := range matches {
		parts = append(parts, string(runes[start:match.runeIndex]))
		start = match.runeIndex + match.runeLength
	}
	parts = append(parts, string(runes[start:]))
	return parts
}

func titleReverseUTF16CodeUnits(value string) string {
	units := utf16.Encode([]rune(value))
	for left, right := 0, len(units)-1; left < right; left, right = left+1, right-1 {
		units[left], units[right] = units[right], units[left]
	}
	return string(utf16.Decode(units))
}

func titleUTF16Length(value string) int {
	return len(utf16.Encode([]rune(value)))
}
