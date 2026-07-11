package parser

import (
	"strconv"
	"strings"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

var qualitySourceRegex = mustCompileStaticRegex(
	`\b(?:
		(?<bluray>M?Blu[-_. ]?Ray|HD[-_. ]?DVD|BD(?!$)|UHD2?BD|BDISO|BDMux|BD25|BD50|BR[-_. ]?DISK)|
		(?<webdl>WEB[-_. ]?DL(?:mux)?|AmazonHD|AmazonSD|iTunesHD|MaxdomeHD|NetflixU?HD|WebHD|HBOMaxHD|DisneyHD|[. ]WEB[. ](?:[xh][ .]?26[45]|AVC|HEVC|DDP?5[. ]1)|[. ](?-i:WEB)$|(?:\d{3,4}0p)[-. ](?:Hybrid[-_. ]?)?WEB[-. ]|[-. ]WEB[-. ]\d{3,4}0p|\b\s\/\sWEB\s\/\s\b|(?:AMZN|NF|DP)[. -]WEB[. -](?!Rip))|
		(?<webrip>WebRip|Web-Rip|WEBMux)|
		(?<hdtv>HDTV)|
		(?<bdrip>BDRip|BDLight|HD[-_. ]?DVDRip|UHDBDRip)|
		(?<brrip>BRRip)|
		(?<dvdr>\d?x?M?DVD-?[R59])|
		(?<dvd>DVD(?!-R)|DVDRip|xvidvd)|
		(?<dsr>WS[-_. ]DSR|DSR)|
		(?<regional>R[0-9]{1}|REGIONAL)|
		(?<scr>SCR|SCREENER|DVDSCR|DVDSCREENER)|
		(?<ts>TS[-_. ]|TELESYNCH?|HD-TS|HDTS|PDVD|TSRip|HDTSRip)|
		(?<tc>TC|TELECINE|HD-TC|HDTC)|
		(?<cam>CAMRIP|(?:NEW)?CAM|HD-?CAM(?:Rip)?|HQCAM)|
		(?<wp>WORKPRINT|WP)|
		(?<pdtv>PDTV)|
		(?<sdtv>SDTV)|
		(?<tvrip>TVRip)
	)(?:\b|$|[ .])`,
	regexIgnoreCase|regexIgnorePatternWhitespace,
)

var qualityResolutionRegex = mustCompileStaticRegex(
	`\b(?:(?<R360p>360p)|(?<R480p>480p|480i|640x480|848x480)|(?<R540p>540p)|(?<R576p>576p)|(?<R720p>720p|1280x720|960p)|(?<R1080p>1080p|1920x1080|1440p|FHD|1080i|4kto1080p)|(?<R2160p>2160p|3840x2160|4k[-_. ](?:UHD|HEVC|BD|H\.?265)|(?:UHD|HEVC|BD|H\.?265)[-_. ]4k))\b`,
	regexIgnoreCase,
)

var qualityAlternativeResolutionRegex = mustCompileStaticRegex(
	`\b(?<R2160p>UHD)\b|(?<R2160p>\[4K\])`,
	regexIgnoreCase,
)

var qualityRemuxRegex = mustCompileStaticRegex(
	`(?:[_. \[]|\d{4}p-|\bHybrid-)(?<remux>(?:(BD|UHD)[-_. ]?)?Remux)\b|(?<remux>(?:(BD|UHD)[-_. ]?)?Remux[_. ]\d{4}p)`,
	regexIgnoreCase,
)

var qualityProperRegex = mustCompileStaticRegex(`\b(?<proper>proper)\b`, regexIgnoreCase)

var qualityRepackRegex = mustCompileStaticRegex(
	`\b(?<repack>repack\d?|rerip\d?)\b`,
	regexIgnoreCase,
)

var qualityVersionRegex = mustCompileStaticRegex(
	`\d[-._ ]?v(?<version>\d)[-._ ]|\[v(?<version>\d)\]|repack(?<version>\d)|rerip(?<version>\d)`,
	regexIgnoreCase,
)

var qualityRealRegex = mustCompileStaticRegex(`\b(?<real>REAL)\b`, 0)

var qualityRawHDRegex = mustCompileStaticRegex(
	`\b(?<rawhd>RawHD|Raw[-_. ]HD)\b`,
	regexIgnoreCase,
)

var qualityBRDiskRegex = mustCompileStaticRegex(
	`^(?!.*\b((?<!HD[._ -]|HD)DVD|BDRip|720p|MKV|XviD|WMV|d3g|(BD)?REMUX|^(?=.*1080p)(?=.*HEVC)|[xh][-_. ]?26[45]|German.*[DM]L|((?<=\d{4}).*German.*([DM]L)?)(?=.*\b(AVC|HEVC|VC[-_. ]?1|MVC|MPEG[-_. ]?2)\b))\b)(((?=.*\b(Blu[-_. ]?ray|BD|HD[-_. ]?DVD)\b)(?=.*\b(AVC|HEVC|VC[-_. ]?1|MVC|MPEG[-_. ]?2|BDMV|ISO)\b))|^((?=.*\b(((?=.*\b((.*_)?COMPLETE.*|Dis[ck])\b)(?=.*(Blu[-_. ]?ray|HD[-_. ]?DVD)))|3D[-_. ]?BD|BR[-_. ]?DISK|Full[-_. ]?Blu[-_. ]?ray|^((?=.*((BD|UHD)[-_. ]?(25|50|66|100|ISO)))))))).*`,
	regexIgnoreCase,
)

var qualityCodecRegex = mustCompileStaticRegex(
	`\b(?:(?<x264>x264)|(?<h264>h264)|(?<xvidhd>XvidHD)|(?<xvid>X-?vid)|(?<divx>divx))\b`,
	regexIgnoreCase,
)

var qualityAnimeBlurayRegex = mustCompileStaticRegex(
	`bd(?:720|1080|2160)|(?<=[-_. (\[])bd(?=[-_. )\]])`,
	regexIgnoreCase,
)

var qualityAnimeWebDLRegex = mustCompileStaticRegex(
	`\[WEB\]|[\[\(]WEB[ .]`,
	regexIgnoreCase,
)

var qualityMPEG2Regex = mustCompileStaticRegex(
	`\b(?<mpeg2>MPEG[-_. ]?2)\b`,
	regexIgnoreCase,
)

type qualityResult struct {
	Source     contract.QualitySource
	Resolution contract.Resolution
	Modifier   contract.QualityModifier
	Revision   contract.RevisionResponse
}

func newQualityResult() qualityResult {
	return qualityResult{
		Source:   contract.QualitySourceUnknown,
		Modifier: contract.QualityModifierNone,
		Revision: contract.NewRevisionResponse(),
	}
}

func parseQuality(name string) qualityResult {
	normalizedName := strings.TrimSpace(strings.ReplaceAll(name, "_", " "))
	result := newQualityResult()

	parseQualityRevision(name, normalizedName, &result)

	resolution := parseQualityResolution(normalizedName)
	result.Resolution = resolution

	if qualityRegexMatches(qualityRawHDRegex, normalizedName) &&
		!qualityRegexMatches(qualityBRDiskRegex, normalizedName) {
		result.Modifier = contract.QualityModifierRawHD
		return result
	}

	sourceMatch, sourceMatched, _ := qualitySourceRegex.firstMatch(normalizedName)
	isRemux := qualityRegexMatches(qualityRemuxRegex, normalizedName)
	isBRDisk := qualityRegexMatches(qualityBRDiskRegex, normalizedName)
	codecMatch, _, _ := qualityCodecRegex.firstMatch(normalizedName)

	if sourceMatched {
		if qualityGroupMatched(sourceMatch, "bluray") {
			result.Source = contract.QualitySourceBluray

			if isBRDisk {
				result.Modifier = contract.QualityModifierBRDisk
				return result
			}

			if qualityGroupMatched(codecMatch, "xvid") || qualityGroupMatched(codecMatch, "divx") {
				result.Resolution = contract.Resolution480p
				return result
			}

			if isRemux {
				result.Modifier = contract.QualityModifierRemux
			}
			if result.Resolution == contract.ResolutionUnknown {
				result.Resolution = contract.Resolution720p
			}
			return result
		}

		if qualityGroupMatched(sourceMatch, "webdl") {
			result.Source = contract.QualitySourceWebDL
			if result.Resolution == contract.ResolutionUnknown {
				result.Resolution = contract.Resolution480p
			}
			return result
		}

		if qualityGroupMatched(sourceMatch, "webrip") {
			result.Source = contract.QualitySourceWebRip
			if result.Resolution == contract.ResolutionUnknown {
				result.Resolution = contract.Resolution480p
			}
			return result
		}

		if qualityGroupMatched(sourceMatch, "hdtv") {
			result.Source = contract.QualitySourceTV
			if qualityRegexMatches(qualityMPEG2Regex, normalizedName) {
				result.Modifier = contract.QualityModifierRawHD
			}
			return result
		}

		if qualityGroupMatched(sourceMatch, "bdrip") || qualityGroupMatched(sourceMatch, "brrip") {
			result.Source = contract.QualitySourceBluray
			if result.Resolution == contract.ResolutionUnknown {
				result.Resolution = contract.Resolution480p
			}
			return result
		}

		if qualityGroupMatched(sourceMatch, "dvdr") || qualityGroupMatched(sourceMatch, "dvd") {
			result.Source = contract.QualitySourceDVD
			result.Resolution = contract.Resolution480p
			return result
		}

		if qualityGroupMatched(sourceMatch, "scr") {
			result.Source = contract.QualitySourceDVD
			result.Resolution = contract.Resolution480p
			result.Modifier = contract.QualityModifierScreener
			return result
		}

		if qualityGroupMatched(sourceMatch, "cam") {
			result.Source = contract.QualitySourceCam
			return result
		}

		if qualityGroupMatched(sourceMatch, "ts") {
			result.Source = contract.QualitySourceTelesync
			return result
		}

		if qualityGroupMatched(sourceMatch, "tc") {
			result.Source = contract.QualitySourceTelecine
			return result
		}

		if qualityGroupMatched(sourceMatch, "wp") {
			result.Source = contract.QualitySourceWorkprint
			return result
		}

		if qualityGroupMatched(sourceMatch, "regional") {
			result.Source = contract.QualitySourceDVD
			result.Resolution = contract.Resolution480p
			result.Modifier = contract.QualityModifierRegional
			return result
		}

		if qualityGroupMatched(sourceMatch, "pdtv") ||
			qualityGroupMatched(sourceMatch, "sdtv") ||
			qualityGroupMatched(sourceMatch, "dsr") ||
			qualityGroupMatched(sourceMatch, "tvrip") {
			result.Source = contract.QualitySourceTV
			return result
		}
	}

	if isRemux && resolution != contract.ResolutionUnknown {
		result.Source = contract.QualitySourceBluray
		result.Modifier = contract.QualityModifierRemux
		return result
	}

	if qualityRegexMatches(qualityAnimeBlurayRegex, normalizedName) {
		result.Source = contract.QualitySourceBluray
		if isRemux {
			result.Modifier = contract.QualityModifierRemux
		}
		if result.Resolution == contract.ResolutionUnknown {
			result.Resolution = contract.Resolution720p
		}
		return result
	}

	if qualityRegexMatches(qualityAnimeWebDLRegex, normalizedName) {
		result.Source = contract.QualitySourceWebDL
		if result.Resolution == contract.ResolutionUnknown {
			result.Resolution = contract.Resolution720p
		}
		return result
	}

	if resolution != contract.ResolutionUnknown && isRemux {
		result.Source = contract.QualitySourceBluray
		result.Modifier = contract.QualityModifierRemux
	}

	return result
}

func parseQualityResolution(name string) contract.Resolution {
	match, matched, _ := qualityResolutionRegex.firstMatch(name)
	alternativeMatch, alternativeMatched, _ := qualityAlternativeResolutionRegex.firstMatch(name)

	if !matched && !alternativeMatched {
		return contract.ResolutionUnknown
	}

	if qualityGroupMatched(match, "R360p") {
		return contract.Resolution360p
	}
	if qualityGroupMatched(match, "R480p") {
		return contract.Resolution480p
	}
	if qualityGroupMatched(match, "R540p") {
		return contract.Resolution540p
	}
	if qualityGroupMatched(match, "R576p") {
		return contract.Resolution576p
	}
	if qualityGroupMatched(match, "R720p") {
		return contract.Resolution720p
	}
	if qualityGroupMatched(match, "R1080p") {
		return contract.Resolution1080p
	}
	if qualityGroupMatched(match, "R2160p") || qualityGroupMatched(alternativeMatch, "R2160p") {
		return contract.Resolution2160p
	}

	return contract.ResolutionUnknown
}

func parseQualityRevision(name, normalizedName string, result *qualityResult) {
	versionMatch, versionMatched, _ := qualityVersionRegex.firstMatch(normalizedName)
	if qualityGroupMatched(versionMatch, "version") {
		versionGroup, _ := versionMatch.group("version")
		if version, err := strconv.Atoi(versionGroup.value); err == nil {
			result.Revision.Version = version
		}
	}

	if qualityRegexMatches(qualityProperRegex, normalizedName) {
		if versionMatched {
			result.Revision.Version++
		} else {
			result.Revision.Version = 2
		}
	}

	if qualityRegexMatches(qualityRepackRegex, normalizedName) {
		if versionMatched {
			result.Revision.Version++
		} else {
			result.Revision.Version = 2
		}
		result.Revision.IsRepack = true
	}

	realMatches, failure := qualityRealRegex.allMatches(name)
	if failure == regexFailureNone && len(realMatches) > 0 {
		result.Revision.Real = len(realMatches)
	}
}

func qualityRegexMatches(regex *compiledRegex, input string) bool {
	matched, failure := regex.isMatch(input)
	return failure == regexFailureNone && matched
}

func qualityGroupMatched(match regexMatch, name string) bool {
	group, ok := match.group(name)
	return ok && len(group.captures) > 0
}
