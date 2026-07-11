package parser

import (
	"strconv"
	"strings"
)

var releaseGroupRegex = mustCompileStaticRegex(
	`-(?<releasegroup>[a-z0-9]+(?<part2>-[a-z0-9]+)?(?!.+?(?:480p|576p|720p|1080p|2160p)))(?<!(?:WEB-(DL|Rip)|Blu-Ray|480p|576p|720p|1080p|2160p|DTS-HD|DTS-X|DTS-MA|DTS-ES|-ES|-EN|-CAT|-ENG|-JAP|-GER|-FRA|-FRE|-ITA|-HDRip|\d{1,2}-bit|[ ._]\d{4}-\d{2}|-\d{2}|tmdb(id)?-(?<tmdbid>\d+)|(?<imdbid>tt\d{7,8}))(?:\k<part2>)?)(?:\b|[-._ ]|$)|[-._ ]\[(?<releasegroup>[a-z0-9]+)\]$`,
	regexIgnoreCase,
)

var invalidReleaseGroupRegex = mustCompileStaticRegex(
	`^([se]\d+|[0-9a-f]{8})$`,
	regexIgnoreCase,
)

var animeReleaseGroupRegex = mustCompileStaticRegex(
	`^(?:\[(?<subgroup>(?!\s).+?(?<!\s))\](?:_|-|\s|\.)?)`,
	regexIgnoreCase,
)

// Handle exception release groups that do not follow the -RlsGrp pattern.
var exceptionReleaseGroupRegexExact = mustCompileStaticRegex(
	`\b(?<releasegroup>KRaLiMaRKo|E\.N\.D|D\-Z0N3|Koten_Gars|BluDragon|ZØNEHD|HQMUX|VARYG|YIFY|YTS(.(MX|LT|AG))?|TMd|Eml HDTeam|LMain|DarQ|BEN THE MEN|TAoE|QxR|126811)\b`,
	regexIgnoreCase,
)

// These exception groups are recognized only when a release ends with the
// group followed by ')' or ']'.
var exceptionReleaseGroupRegex = mustCompileStaticRegex(
	`(?<=[._ \[])(?<releasegroup>(Silence|afm72|Panda|Ghost|MONOLITH|Tigole|Joy|ImE|UTR|t3nzin|Anime Time|Project Angel|Hakata Ramen|HONE|GiLG|Vyndros|SEV|Garshasp|Kappa|Natty|RCVR|SAMPA|YOGI|r00t|EDGE2020|RZeroX|FreetheFish|Anna|Bandi|Qman|theincognito|HDO|DusIctv|DHD|CtrlHD|-ZR-|ADC|XZVN|RH|Kametsu)(?=\]|\)))`,
	regexIgnoreCase,
)

var cleanReleaseGroupRegex = mustCompileRegexReplacement(
	`(-(RP|1|NZBGeek|Obfuscated|Obfuscation|Scrambled|sample|Pre|postbot|xpost|Rakuv[a-z0-9]*|WhiteRev|BUYMORE|AsRequested|AlternativeToRequested|GEROV|Z0iDS3N|Chamele0n|4P|4Planet|AlteZachen|RePACKPOST))+$`,
	"",
	regexIgnoreCase,
)

// parseReleaseGroup is an ordered transliteration of the legacy parser. A nil
// result represents both an ordinary miss and a fail-closed static-regex
// failure; callers must not include the title or candidate group in diagnostics.
func parseReleaseGroup(title string) *string {
	title = strings.TrimSpace(title)
	title = removeFileExtension(title)

	for _, replacement := range preSubstitutionRegex {
		var matched bool
		var failure regexFailure
		title, matched, failure = replacement.tryReplace(title)
		if failure != regexFailureNone {
			return nil
		}
		if matched {
			break
		}
	}

	var failure regexFailure
	title, failure = websitePrefixRegex.replace(title)
	if failure != regexFailureNone {
		return nil
	}
	title, failure = cleanTorrentSuffixRegex.replace(title)
	if failure != regexFailureNone {
		return nil
	}

	// Anime-style groups have precedence over every suffix-based branch.
	animeMatch, matched, failure := animeReleaseGroupRegex.firstMatch(title)
	if failure != regexFailureNone {
		return nil
	}
	if matched {
		return releaseGroupMatchValue(animeMatch, "subgroup")
	}

	title, failure = cleanReleaseGroupRegex.replace(title)
	if failure != regexFailureNone {
		return nil
	}

	if group, ok, failed := releaseGroupLastMatchedGroup(exceptionReleaseGroupRegexExact, title, "releasegroup"); failed {
		return nil
	} else if ok {
		return group
	}

	if group, ok, failed := releaseGroupLastMatchedGroup(exceptionReleaseGroupRegex, title, "releasegroup"); failed {
		return nil
	} else if ok {
		return group
	}

	group, ok, failed := releaseGroupLastMatchedGroup(releaseGroupRegex, title, "releasegroup")
	if failed || !ok {
		return nil
	}
	if group == nil {
		return nil
	}

	// int.TryParse in the legacy parser is specifically a signed 32-bit parse.
	// Numeric strings outside that range therefore remain valid group names.
	if _, err := strconv.ParseInt(*group, 10, 32); err == nil {
		return nil
	}

	invalid, failure := invalidReleaseGroupRegex.isMatch(*group)
	if failure != regexFailureNone || invalid {
		return nil
	}

	return group
}

func releaseGroupLastMatchedGroup(
	regex *compiledRegex,
	input string,
	groupName string,
) (group *string, matched bool, failed bool) {
	matches, failure := regex.allMatches(input)
	if failure != regexFailureNone {
		return nil, false, true
	}
	if len(matches) == 0 {
		return nil, false, false
	}
	group = releaseGroupMatchValue(matches[len(matches)-1], groupName)
	return group, group != nil, group == nil
}

func releaseGroupMatchValue(match regexMatch, groupName string) *string {
	group, ok := match.group(groupName)
	if !ok {
		return nil
	}
	value := group.value
	return &value
}
