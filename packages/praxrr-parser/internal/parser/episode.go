package parser

import (
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

// parsedEpisodeInfo retains the legacy parser's internal fields as well as the
// public response fields. The internal flags are intentionally not collapsed:
// orchestration and future parity tests need to distinguish partial packs,
// extras, split episodes, and daily parts before constructing the wire DTO.
type parsedEpisodeInfo struct {
	SeriesTitle            string
	SeasonNumber           int
	EpisodeNumbers         []int
	AbsoluteEpisodeNumbers []int
	AirDate                string
	FullSeason             bool
	IsPartialSeason        bool
	IsMultiSeason          bool
	IsSeasonExtra          bool
	IsSplitEpisode         bool
	IsMiniSeries           bool
	Special                bool
	SeasonPart             int
	DailyPart              *int
}

func (info parsedEpisodeInfo) isDaily() bool {
	return strings.TrimSpace(info.AirDate) != ""
}

func (info parsedEpisodeInfo) isAbsoluteNumbering() bool {
	return len(info.AbsoluteEpisodeNumbers) != 0
}

func (info parsedEpisodeInfo) releaseType() contract.ReleaseType {
	if len(info.EpisodeNumbers) > 1 || len(info.AbsoluteEpisodeNumbers) > 1 {
		return contract.ReleaseTypeMultiEpisode
	}
	if len(info.EpisodeNumbers) == 1 || len(info.AbsoluteEpisodeNumbers) == 1 {
		return contract.ReleaseTypeSingleEpisode
	}
	if info.FullSeason {
		return contract.ReleaseTypeSeasonPack
	}
	return contract.ReleaseTypeUnknown
}

// reportTitleRegex is a literal, order-preserving port of ReportTitleRegex.
// The order is observable: the first expression that produces a valid parsed
// result wins, while an invalid date/range falls through to later expressions.
var reportTitleRegex = []*compiledRegex{
	mustCompileStaticRegex(`^^(?<title>.+?\((?<titleyear>\d{4})\))[-_. ]+(?<airyear>19[4-9]\d|20\d\d)(?<sep>[-_]?)(?<airmonth>0\d|1[0-2])\k<sep>(?<airday>[0-2]\d|3[01])[-_. ]\d{2}[-_. ]\d{2}[-_. ]\d{2}`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<airyear>19[6-9]\d|20\d\d)(?<sep>[-_]?)(?<airmonth>0\d|1[0-2])\k<sep>(?<airday>[0-2]\d|3[01])(?!\d)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?:\W*S(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:e{1,2}(?<episode>\d{1,3}(?!\d+)))+){2,}`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?:\W*(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:x{1,2}(?<episode>\d{1,3}(?!\d+)))+){2,}`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?:S?(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:(?:[-_]|[ex]){1,2}(?<episode>\d{2,3}(?!\d+))){2,})`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:S?(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:(?:[-_ ]?[ex])(?<episode>\d{2,3}(?!\d+))(?<splitepisode>[a-d])(?:[ _.])))`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?:S?(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:(?:[-_ ]?[ex])(?<episode>\d{2,3}(?!\d+))))`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?:\[(?<subgroup>.+?)\](?:_|-|\s|\.)?)(?<title>.+?)[-_. ]+(?<absoluteepisode>(?<!\d+)\d{2,3}(\.\d{1,2})?(?!\d+))(?:[-_. ])+\((?:S(?<season>(?<!\d+)\d{1,2}(?!\d+))(?:(?:[ex]|\W[ex]){1,2}(?<episode>\d{2}(?!\d+))))(?:v\d+)?(?:\)(?!\d+)).*?(?<hash>[(\[]\w{8}[)\]])?$`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?:\[(?<subgroup>.+?)\](?:_|-|\s|\.)?)(?<title>.+?)(?:[-_\W](?<![()\[!]))+(?:S?(?<season>(?<!\d+)\d{1,2}(?!\d+))(?:(?:[ex]|\W[ex]){1,2}(?<episode>\d{2}(?!\d+)))+)(?:v\d+)?(?:[_. ](?!\d+)).*?(?<hash>[(\[]\w{8}[)\]])?$`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>.+?)[-_. ]+?(?:Episode)(?:[-_. ]+(?<absoluteepisode>(?<!\d+)\d{2,3}(\.\d{1,2})?(?!\d+)))+.*?(?<hash>[(\[]\w{8}[)\]])?$`, regexIgnoreCase),
	mustCompileStaticRegex(`^\[(?<subgroup>.+?)\][-_. ]?(?<title>[^-]+?)(?:(?<![-_. ]|\b[0]\d+) - )(?:[-_. ]?(?<absoluteepisode>\d{2,3}(\.\d{1,2})?(?!\d+)))+(?:[-_. ]+(?<special>special|ova|ovd))?.*?(?<hash>[(\[]\w{8}[)\]])?(?:$|\.mkv)`, regexIgnoreCase),
	mustCompileStaticRegex(`^\[(?<subgroup>.+?)\][-_. ]?(?<title>.+?)[-_. ]+\(?(?:[-_. ]?#?(?<absoluteepisode>\d{2,3}(\.\d{1,2})?(?!\d+|-[a-z]+)))+\)?(?:[-_. ]+(?<special>special|ova|ovd))?.*?(?<hash>[(\[]\w{8}[)\]])?(?:$|\.mkv)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:(?:[-_\W](?<![()\[!]))+S(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:(?:e|[-_. ]e){1,2}(?<episode>\d{1,3}(?!\d+)))+){2,}`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:(?:[-_\W](?<![()\[!]))+(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:x{1,2}(?<episode>\d{1,3}(?!\d+)))+){2,}`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:[-_\W](?<![()\[!]))+S(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))E(?<episode>\d{2,3}(?!\d+))(?:-(?<episode>\d{2,3}(?!\d+)))+(?:[-_. ]|$)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:(?:[-_\W](?<![()\[!]))+S?(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))(?:[ex]|\W[ex]){1,2}(?<episode>\d{2,3}(?!\d+))(?:(?:\-|[ex]|\W[ex]|_){1,2}(?<episode>\d{2,3}(?!\d+)))*)(?:[-_. ]|$)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:(?:[-_\W](?<![()\[!]))+S(?<season>(?<!\d+)(?:\d{4})(?!\d+))(?:e|\We|_){1,2}(?<episode>\d{2,4}(?!\d+))(?:(?:\-|e|\We|_){1,2}(?<episode>\d{2,3}(?!\d+)))*)\W?(?!\\)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(Complete Series)?[-_. ]+(?:S|(?:Season|Saison|Series|Stagione)[_. ])(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))(?:[-_. ]{1}|[-_. ]{3})(?:S|(?:Season|Saison|Series|Stagione)[_. ])?(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:\W+S(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))\W+(?:(?:(?:Part|Vol)\W?|(?<!\d+\W+)e|p)(?<seasonpart>\d{1,2}(?!\d+)))+)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)[-_. ]+?(?:S|Season|Saison|Series|Stagione)[-_. ]?(?<season>\d{1,2}(?=[-_. ]\d{4}[-_. ]+))(?<extras>EXTRAS|SUBPACK)?(?!\\)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)[-_. ]+?(?:S|Season|Saison|Series|Stagione)[-_. ]?(?<season>\d{1,2}(?![-_. ]?\d+))(?:[-_. ]|$)+(?<extras>EXTRAS|SUBPACK)?(?!\\)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)[-_. ]+?(?:S|Season|Saison|Series|Stagione)[-_. ]?(?<season>\d{4}(?![-_. ]?\d+))(\W+|_|$)(?<extras>EXTRAS|SUBPACK)?(?!\\)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?\d{4})(?:\W+(?:(?:Part\W?|e)(?<episode>\d{1,2}(?!\d+)))+)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:[-._ ][e])(?<episode>\d{2,3}(?!\d+))(?:(?:\-?[e])(?<episode>\d{2,3}(?!\d+)))+`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)?\W*(?<airyear>\d{4})[-_. ]+(?<airmonth>[0-1][0-9])[-_. ]+(?<airday>[0-3][0-9])(?![-_. ]+[0-3][0-9])`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)?\W*(?<ambiguousairmonth>[0-1][0-9])[-_. ]+(?<ambiguousairday>[0-3][0-9])[-_. ]+(?<airyear>\d{4})(?!\d+)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)?\W*(?<!\d+)(?<airyear>\d{4})(?<airmonth>[0-1][0-9])(?<airday>[0-3][0-9])(?!\d+)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:\W+(?:(?:(?<!\()Part\W?|(?<!\d+\W+)e)(?<episode>\d{1,2}(?!\d+|\))))+)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:\W+(?:Part[-._ ](?<episode>One|Two|Three|Four|Five|Six|Seven|Eight|Nine)(?>[-._ ])))`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)(?:\W+(?:(?<episode>(?<!\d+)\d{1,2}(?!\d+))of\d+)+)`, regexIgnoreCase),
	mustCompileStaticRegex(`(?:.*(?:"|^))(?<title>.*?)(?:[-_\W](?<![()\[]))+(?:\W?Season\W?)(?<season>(?<!\d+)\d{1,2}(?!\d+))(?:\W|_)+(?:Episode\W)(?:[-_. ]?(?<episode>(?<!\d+)\d{1,2}(?!\d+)))+`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)[-_. ]S(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:[-_. ]?[ex]?(?<episode>(?<!\d+)\d{1,2}(?!\d+)))+`, regexIgnoreCase),
	mustCompileStaticRegex(`(?:.*(?:"|^))(?<title>.*?)(?:\W?|_)S(?<season>(?<!\d+)\d{1,2}(?!\d+))(?:\W|_)?Ep?[ ._]?(?<episode>(?<!\d+)\d{1,2}(?!\d+))`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?<title>.+?)?(?:(?:[_.-](?<![()\[!]))+(?<season>(?<!\d+)[1-9])(?<episode>[1-9][0-9]|[0][1-9])(?![a-z]|\d+))+(?:[_.]|$)`, regexIgnoreCase),
	mustCompileStaticRegex(`^(?:\[(?<subgroup>.+?)\][-_. ]?)?(?<title>.+?)(?:[-_. ]+(?<absoluteepisode>(?<!\d+)\d{2,4}(\.\d{1,2})?(?!\d+|[ip])))+.*?(?<hash>[(\[]\w{8}[)\]])?$`, regexIgnoreCase),
	mustCompileStaticRegex(`^\[(?<subgroup>.+?)\][-_. ]?(?<title>.+?)(?:[-_. ]+(?<special>special|ova|ovd)).*?(?<hash>[(\[]\w{8}[)\]])?(?:$|\.mkv)`, regexIgnoreCase),
}

var episodeRejectHashedReleasesRegex = []*compiledRegex{
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

var episodeReversedTitleRegex = mustCompileStaticRegex(
	`(?:^|[-._ ])(p027|p0801|\d{2,3}E\d{2}S)[-._ ]`,
	0,
)

var simpleEpisodeTitleRegex = mustCompileRegexReplacement(
	`(?:(480|540|576|720|1080|1440|2160)[ip]|[xh][\W_]?26[45]|DD\W?5\W1|[<>?*]|848x480|1280x720|1920x1080|3840x2160|4096x2160|(?<![a-f0-9])(8|10)[ -]?(b(?![a-z0-9])|bit))\s*?`,
	"",
	regexIgnoreCase,
)

var episodeCleanQualityBracketsRegex = mustCompileRegexReplacement(
	`\[[a-z0-9 ._-]+\]$`,
	"",
	regexIgnoreCase,
)

var sixDigitAirDateRegex = mustCompileStaticRegex(
	`(?<=[_.-])(?<airdate>(?<!\d)(?<airyear>[1-9]\d{1})(?<airmonth>[0-1][0-9])(?<airday>[0-3][0-9]))(?=[_.-])`,
	regexIgnoreCase,
)

var episodeRequestInfoRegex = mustCompileRegexReplacement(`^(?:\[.+?\])+`, "", 0)

var episodeNumbersAsWords = []string{
	"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
}

func parseEpisode(title string) *parsedEpisodeInfo {
	return parseEpisodeAt(title, time.Now())
}

// parseEpisodeAt exists to make the legacy DateTime.Now.AddDays(1).Date rule
// deterministic in tests. Production always calls parseEpisode.
func parseEpisodeAt(title string, now time.Time) (result *parsedEpisodeInfo) {
	// The C# entry point catches every exception. Keep this recovery local so
	// static-regex, conversion, and indexing failures remain a content-free miss.
	defer func() {
		if recover() != nil {
			result = nil
		}
	}()

	if !validateEpisodeBeforeParsing(title) {
		return nil
	}

	reversed, failure := episodeReversedTitleRegex.isMatch(title)
	if failure != regexFailureNone {
		return nil
	}
	if reversed {
		withoutExtension := removeFileExtension(title)
		title = reverseUTF16CodeUnits(withoutExtension) + strings.TrimPrefix(title, withoutExtension)
	}

	releaseTitle := removeFileExtension(title)
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

	simpleTitle, failure := simpleEpisodeTitleRegex.replace(releaseTitle)
	if failure != regexFailureNone {
		return nil
	}
	for _, replacement := range []*regexReplacement{
		websitePrefixRegex,
		websitePostfixRegex,
		cleanTorrentSuffixRegex,
		episodeCleanQualityBracketsRegex,
	} {
		simpleTitle, failure = replacement.replace(simpleTitle)
		if failure != regexFailureNone {
			return nil
		}
	}

	if dateMatch, matched, matchFailure := sixDigitAirDateRegex.firstMatch(simpleTitle); matchFailure != regexFailureNone {
		return nil
	} else if matched {
		airYear := episodeGroupValue(dateMatch, "airyear")
		airMonth := episodeGroupValue(dateMatch, "airmonth")
		airDay := episodeGroupValue(dateMatch, "airday")
		if airMonth != "00" || airDay != "00" {
			fixedDate := "20" + airYear + "." + airMonth + "." + airDay
			simpleTitle = strings.ReplaceAll(simpleTitle, episodeGroupValue(dateMatch, "airdate"), fixedDate)
		}
	}

	for _, expression := range reportTitleRegex {
		matches, matchFailure := expression.allMatches(simpleTitle)
		if matchFailure != regexFailureNone {
			return nil
		}
		if len(matches) == 0 {
			continue
		}

		parsed := parseEpisodeMatches(matches, now)
		if parsed == nil {
			continue
		}
		if parsed.FullSeason && strings.Contains(strings.ToLower(releaseTitle), "special") {
			parsed.FullSeason = false
			parsed.Special = true
		}
		return parsed
	}

	return nil
}

func parseEpisodeMatches(matches []regexMatch, now time.Time) *parsedEpisodeInfo {
	firstMatch := matches[0]
	seriesName := strings.NewReplacer(".", " ", "_", " ").Replace(episodeGroupValue(firstMatch, "title"))
	seriesName = normalizeLegacyEpisodeTitleUTF16(seriesName)
	cleanedSeriesName, failure := episodeRequestInfoRegex.replace(seriesName)
	if failure != regexFailureNone {
		return nil
	}
	seriesName = strings.Trim(cleanedSeriesName, " ")

	airYear, _ := strconv.Atoi(episodeGroupValue(firstMatch, "airyear"))
	if airYear < 1900 {
		result := &parsedEpisodeInfo{
			EpisodeNumbers:         []int{},
			AbsoluteEpisodeNumbers: []int{},
		}

		for _, match := range matches {
			episodeCaptures := episodeGroupCaptureValues(match, "episode")
			absoluteEpisodeCaptures := episodeGroupCaptureValues(match, "absoluteepisode")

			if len(episodeCaptures) != 0 {
				first, ok := parseEpisodeNumber(episodeCaptures[0])
				if !ok {
					return nil
				}
				last, ok := parseEpisodeNumber(episodeCaptures[len(episodeCaptures)-1])
				if !ok || first > last {
					return nil
				}
				result.EpisodeNumbers = inclusiveIntRange(first, last)
				if episodeGroupSuccess(match, "special") {
					result.Special = true
				}
				if episodeGroupSuccess(match, "splitepisode") {
					result.IsSplitEpisode = true
				}
			}

			if len(absoluteEpisodeCaptures) != 0 {
				first, err := strconv.ParseFloat(absoluteEpisodeCaptures[0], 64)
				if err != nil {
					return nil
				}
				last, err := strconv.ParseFloat(absoluteEpisodeCaptures[len(absoluteEpisodeCaptures)-1], 64)
				if err != nil || first > last {
					return nil
				}
				if first != float64(int(first)) || last != float64(int(last)) {
					result.Special = true
				} else {
					result.AbsoluteEpisodeNumbers = inclusiveIntRange(int(first), int(last))
					if episodeGroupSuccess(match, "special") {
						result.Special = true
					}
				}
			}

			if len(episodeCaptures) == 0 && len(absoluteEpisodeCaptures) == 0 {
				if strings.TrimSpace(episodeGroupValue(firstMatch, "extras")) != "" {
					result.IsSeasonExtra = true
				}
				seasonPart := episodeGroupValue(firstMatch, "seasonpart")
				if strings.TrimSpace(seasonPart) != "" {
					parsedSeasonPart, err := strconv.Atoi(seasonPart)
					if err != nil {
						return nil
					}
					result.SeasonPart = parsedSeasonPart
					result.IsPartialSeason = true
				} else if episodeGroupSuccess(firstMatch, "special") {
					result.Special = true
				} else {
					result.FullSeason = true
				}
			}
		}

		seasons := make([]int, 0)
		for _, seasonCapture := range episodeGroupCaptureValues(firstMatch, "season") {
			if parsedSeason, err := strconv.Atoi(seasonCapture); err == nil {
				seasons = append(seasons, parsedSeason)
			}
		}
		if distinctIntCount(seasons) > 1 {
			result.IsMultiSeason = true
		}
		if len(seasons) != 0 {
			result.SeasonNumber = seasons[0]
		} else if len(result.AbsoluteEpisodeNumbers) == 0 && len(result.EpisodeNumbers) != 0 {
			result.SeasonNumber = 1
			result.IsMiniSeries = true
		}
		result.SeriesTitle = seriesName
		return result
	}

	airMonth, airDay := 0, 0
	if episodeGroupSuccess(firstMatch, "ambiguousairmonth") && episodeGroupSuccess(firstMatch, "ambiguousairday") {
		var err error
		airMonth, err = strconv.Atoi(episodeGroupValue(firstMatch, "ambiguousairmonth"))
		if err != nil {
			return nil
		}
		airDay, err = strconv.Atoi(episodeGroupValue(firstMatch, "ambiguousairday"))
		if err != nil || (airDay <= 12 && airMonth <= 12) {
			return nil
		}
	} else {
		var err error
		airMonth, err = strconv.Atoi(episodeGroupValue(firstMatch, "airmonth"))
		if err != nil {
			return nil
		}
		airDay, err = strconv.Atoi(episodeGroupValue(firstMatch, "airday"))
		if err != nil {
			return nil
		}
	}
	if airMonth > 12 {
		airDay, airMonth = airMonth, airDay
	}

	location := now.Location()
	airDate := time.Date(airYear, time.Month(airMonth), airDay, 0, 0, 0, 0, location)
	// time.Date normalizes invalid dates while DateTime rejects them.
	if airDate.Year() != airYear || int(airDate.Month()) != airMonth || airDate.Day() != airDay {
		return nil
	}
	tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, location)
	epoch := time.Date(1970, time.January, 1, 0, 0, 0, 0, location)
	if airDate.After(tomorrow) || airDate.Before(epoch) {
		return nil
	}

	result := &parsedEpisodeInfo{
		EpisodeNumbers:         []int{},
		AbsoluteEpisodeNumbers: []int{},
		AirDate:                airDate.Format("2006-01-02"),
		SeriesTitle:            seriesName,
	}
	if episodeGroupSuccess(firstMatch, "part") {
		part, err := strconv.Atoi(episodeGroupValue(firstMatch, "part"))
		if err != nil {
			return nil
		}
		result.DailyPart = &part
	}
	return result
}

// .NET Regex operates on UTF-16 code units. In the episode title expressions,
// a supplementary character can be split at the following \W boundary: the
// high surrogate remains in the title capture and is serialized as U+FFFD,
// while the low surrogate is consumed as a separator. regexp2 operates on Go
// runes, so reproduce that observable legacy result after capture.
func normalizeLegacyEpisodeTitleUTF16(value string) string {
	return strings.Map(func(character rune) rune {
		if character > 0xffff {
			return unicode.ReplacementChar
		}
		return character
	}, value)
}

func validateEpisodeBeforeParsing(title string) bool {
	lowerTitle := strings.ToLower(title)
	if strings.Contains(lowerTitle, "password") && strings.Contains(lowerTitle, "yenc") {
		return false
	}
	hasLetterOrDigit := false
	for _, character := range title {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			hasLetterOrDigit = true
			break
		}
	}
	if !hasLetterOrDigit {
		return false
	}

	withoutExtension := removeFileExtension(title)
	for _, expression := range episodeRejectHashedReleasesRegex {
		matched, failure := expression.isMatch(withoutExtension)
		if failure != regexFailureNone || matched {
			return false
		}
	}
	return true
}

func episodeGroupValue(match regexMatch, name string) string {
	group, ok := match.group(name)
	if !ok {
		return ""
	}
	return group.value
}

func episodeGroupCaptureValues(match regexMatch, name string) []string {
	group, ok := match.group(name)
	if !ok {
		return nil
	}
	return group.allCaptureValues()
}

func episodeGroupSuccess(match regexMatch, name string) bool {
	group, ok := match.group(name)
	return ok && len(group.captures) != 0
}

func parseEpisodeNumber(value string) (int, bool) {
	if number, err := strconv.Atoi(value); err == nil {
		return number, true
	}
	for index, word := range episodeNumbersAsWords {
		if strings.EqualFold(value, word) {
			return index, true
		}
	}
	return 0, false
}

func inclusiveIntRange(first, last int) []int {
	values := make([]int, last-first+1)
	for index := range values {
		values[index] = first + index
	}
	return values
}

func distinctIntCount(values []int) int {
	distinct := make(map[int]struct{}, len(values))
	for _, value := range values {
		distinct[value] = struct{}{}
	}
	return len(distinct)
}

// C# reverses a char[] (UTF-16 code units), not Unicode scalar values. That
// observable behavior turns reversed surrogate pairs into replacement runes.
func reverseUTF16CodeUnits(value string) string {
	units := utf16.Encode([]rune(value))
	for left, right := 0, len(units)-1; left < right; left, right = left+1, right-1 {
		units[left], units[right] = units[right], units[left]
	}
	return string(utf16.Decode(units))
}
