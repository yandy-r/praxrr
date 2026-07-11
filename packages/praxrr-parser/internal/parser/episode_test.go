package parser

import (
	"reflect"
	"testing"
	"time"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

func TestEpisodeOracleBranches(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 11, 18, 0, 0, 0, time.UTC)
	tests := []struct {
		name  string
		title string
		want  *parsedEpisodeInfo
	}{
		{
			name:  "single season episode",
			title: "Example.Show.S01E05.1080p.WEB-DL-GROUP.mkv",
			want:  episodeWant("Example Show", 1, []int{5}, nil),
		},
		{
			name:  "no title",
			title: "S01E05",
			want:  episodeWant("", 1, []int{5}, nil),
		},
		{
			name:  "repeated captures expand inclusive range",
			title: "Example.Show.S01E05E06E07.1080p.WEB-DL-GROUP",
			want:  episodeWant("Example Show", 1, []int{5, 6, 7}, nil),
		},
		{
			name:  "hyphen range expands inclusive range",
			title: "Example.Show.S01E05-07.1080p.WEB-DL-GROUP",
			want:  episodeWant("Example Show", 1, []int{5, 6, 7}, nil),
		},
		{
			name:  "descending range rejects range then later rule parses first episode",
			title: "Example.Show.S01E07-05.1080p.WEB-DL-GROUP",
			want:  episodeWant("Example Show", 1, []int{7}, nil),
		},
		{
			name:  "repeated season episode",
			title: "Example.Show.S01E05.S01E06.1080p.WEB-DL-GROUP",
			want:  episodeWant("Example Show", 1, []int{5, 6}, nil),
		},
		{
			name:  "repeated x episode",
			title: "Example.Show.1x05.1x06.1080p.WEB-DL-GROUP",
			want:  episodeWant("Example Show", 1, []int{5, 6}, nil),
		},
		{
			name:  "compact 103",
			title: "Example.Show.103.1080p.WEB-DL-GROUP",
			want:  episodeWant("Example Show", 1, []int{3}, nil),
		},
		{
			name:  "absolute anime",
			title: "[SubsPlease] Example Show - 012 [1080p] [ABCDEF12].mkv",
			want:  episodeWant("Example Show", 0, nil, []int{12}),
		},
		{
			name:  "absolute anime range",
			title: "[SubsPlease] Example Show - 012 013 014 [1080p] [ABCDEF12].mkv",
			want:  episodeWant("Example Show", 0, nil, []int{12, 13, 14}),
		},
		{
			name:  "absolute decimal is special without integer number",
			title: "[SubsPlease] Example Show - 012.5 [1080p] [ABCDEF12].mkv",
			want: episodeModify(episodeWant("Example Show", 0, nil, nil), func(info *parsedEpisodeInfo) {
				info.Special = true
			}),
		},
		{
			name:  "anime OVA",
			title: "[SubsPlease] Example Show - OVA [1080p] [ABCDEF12].mkv",
			want: episodeModify(episodeWant("Example Show", 0, nil, nil), func(info *parsedEpisodeInfo) {
				info.Special = true
			}),
		},
		{
			name:  "season pack",
			title: "Example.Show.S03.1080p.BluRay-GROUP",
			want: episodeModify(episodeWant("Example Show", 3, nil, nil), func(info *parsedEpisodeInfo) {
				info.FullSeason = true
			}),
		},
		{
			name:  "season pack expression precedes explicit season episode expression",
			title: "Example Show Season 01 Episode 03 1080p WEB-DL-GROUP",
			want: episodeModify(episodeWant("Example Show", 1, nil, nil), func(info *parsedEpisodeInfo) {
				info.FullSeason = true
			}),
		},
		{
			name:  "multi season pack",
			title: "Example.Show.S01-S03.Complete.1080p.BluRay-GROUP",
			want: episodeModify(episodeWant("Example Show", 1, nil, nil), func(info *parsedEpisodeInfo) {
				info.FullSeason = true
				info.IsMultiSeason = true
			}),
		},
		{
			name:  "partial season",
			title: "Example.Show.S03.Part2.1080p.BluRay-GROUP",
			want: episodeModify(episodeWant("Example Show", 3, nil, nil), func(info *parsedEpisodeInfo) {
				info.IsPartialSeason = true
				info.SeasonPart = 2
			}),
		},
		{
			name:  "season extras",
			title: "Example.Show.S03.EXTRAS.1080p.BluRay-GROUP",
			want: episodeModify(episodeWant("Example Show", 3, nil, nil), func(info *parsedEpisodeInfo) {
				info.FullSeason = true
				info.IsSeasonExtra = true
			}),
		},
		{
			name:  "special changes full season into special",
			title: "Example.Show.S00.Special.1080p.BluRay-GROUP",
			want: episodeModify(episodeWant("Example Show", 0, nil, nil), func(info *parsedEpisodeInfo) {
				info.Special = true
			}),
		},
		{
			name:  "split episode internal flag",
			title: "Example.Show.S01E05a.1080p.WEB-DL-GROUP",
			want: episodeModify(episodeWant("Example Show", 1, []int{5}, nil), func(info *parsedEpisodeInfo) {
				info.IsSplitEpisode = true
			}),
		},
		{
			name:  "miniseries word",
			title: "Example Show Part One 1080p WEB-DL-GROUP",
			want: episodeModify(episodeWant("Example Show", 1, []int{1}, nil), func(info *parsedEpisodeInfo) {
				info.IsMiniSeries = true
			}),
		},
		{
			name:  "miniseries x of y",
			title: "Example Show 2of6 1080p WEB-DL-GROUP",
			want: episodeModify(episodeWant("Example Show", 1, []int{2}, nil), func(info *parsedEpisodeInfo) {
				info.IsMiniSeries = true
			}),
		},
		{
			name:  "compact daily date",
			title: "Daily Show 20180428 HDTV-GROUP",
			want: episodeModify(episodeWant("Daily Show", 0, nil, nil), func(info *parsedEpisodeInfo) {
				info.AirDate = "2018-04-28"
			}),
		},
		{
			name:  "unambiguous month day year",
			title: "Daily Show 04.28.2018 HDTV-GROUP",
			want: episodeModify(episodeWant("Daily Show", 0, nil, nil), func(info *parsedEpisodeInfo) {
				info.AirDate = "2018-04-28"
			}),
		},
		{
			name:  "swap day and month",
			title: "Daily Show 13.04.2018 HDTV-GROUP",
			want: episodeModify(episodeWant("Daily Show", 0, nil, nil), func(info *parsedEpisodeInfo) {
				info.AirDate = "2018-04-13"
			}),
		},
		{
			name:  "ambiguous date falls through to anime special quirk",
			title: "Daily Show 04.05.2018 HDTV-GROUP",
			want: episodeModify(episodeWant("Daily Show", 0, nil, nil), func(info *parsedEpisodeInfo) {
				info.Special = true
			}),
		},
		{
			name:  "fullwidth brackets normalize before anime",
			title: "【字幕組】 作品名 - 012 [1080p] [ABCDEF12].mkv",
			want:  episodeWant("作品名", 0, nil, []int{12}),
		},
		{
			name:  "unicode title",
			title: "進撃の巨人.S01E05.1080p.WEB-DL-組",
			want:  episodeWant("進撃の巨人", 1, []int{5}, nil),
		},
		{
			name:  "supplementary title preserves legacy UTF-16 split",
			title: "😀.S01E01.1080p.WEB-DL-GROUP",
			want:  episodeWant("�", 1, []int{1}, nil),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := parseEpisodeAt(test.title, now)
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("parseEpisodeAt() = %#v; want %#v", got, test.want)
			}
		})
	}
}

func TestEpisodeDateBoundariesAndRejections(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 11, 23, 59, 59, 0, time.UTC)
	tests := []struct {
		name    string
		title   string
		airDate string
	}{
		{name: "epoch inclusive", title: "Daily Show 1970-01-01 HDTV-GROUP", airDate: "1970-01-01"},
		{name: "tomorrow inclusive", title: "Daily Show 2026-07-12 HDTV-GROUP", airDate: "2026-07-12"},
		{name: "year boundary 1999", title: "Daily Show 1999-12-31 HDTV-GROUP", airDate: "1999-12-31"},
		{name: "year boundary 2000", title: "Daily Show 2000-01-01 HDTV-GROUP", airDate: "2000-01-01"},
		{name: "leap day", title: "Daily Show 2024-02-29 HDTV-GROUP", airDate: "2024-02-29"},
		{name: "before epoch", title: "Daily Show 1969-12-31 HDTV-GROUP"},
		{name: "day after tomorrow", title: "Daily Show 2026-07-13 HDTV-GROUP"},
		{name: "invalid calendar date", title: "Daily Show 2024-02-30 HDTV-GROUP"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := parseEpisodeAt(test.title, now)
			if test.airDate == "" {
				if got != nil {
					t.Fatalf("parseEpisodeAt() = %#v; want nil", got)
				}
				return
			}
			if got == nil || got.AirDate != test.airDate {
				t.Fatalf("parseEpisodeAt() = %#v; want air date %q", got, test.airDate)
			}
		})
	}
}

func TestEpisodeValidationFailsClosed(t *testing.T) {
	t.Parallel()

	for _, title := range []string{
		"",
		"---___...",
		"Example.Show.S01E01.password.yenc",
		"0123456789abcdef0123456789abcdef",
		"abcdefghijklmnopqrstuvwx",
		"ABCDEFGHIJK123",
		"abcdefghijkl123",
		"Backup_12345S01-02",
		"123",
		"abc",
		"abc-xyz-release",
		"b00bs",
	} {
		if got := parseEpisodeAt(title, time.Date(2026, 7, 11, 0, 0, 0, 0, time.UTC)); got != nil {
			t.Errorf("parseEpisodeAt(%q) = %#v; want nil", title, got)
		}
	}
}

func TestEpisodeReleaseTypesAndDerivedFlags(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		info parsedEpisodeInfo
		want contract.ReleaseType
	}{
		{name: "unknown", info: parsedEpisodeInfo{}, want: contract.ReleaseTypeUnknown},
		{name: "single standard", info: parsedEpisodeInfo{EpisodeNumbers: []int{1}}, want: contract.ReleaseTypeSingleEpisode},
		{name: "single absolute", info: parsedEpisodeInfo{AbsoluteEpisodeNumbers: []int{12}}, want: contract.ReleaseTypeSingleEpisode},
		{name: "multi standard", info: parsedEpisodeInfo{EpisodeNumbers: []int{1, 2}}, want: contract.ReleaseTypeMultiEpisode},
		{name: "multi absolute", info: parsedEpisodeInfo{AbsoluteEpisodeNumbers: []int{12, 13}}, want: contract.ReleaseTypeMultiEpisode},
		{name: "season pack", info: parsedEpisodeInfo{FullSeason: true}, want: contract.ReleaseTypeSeasonPack},
		{name: "episodes precede season", info: parsedEpisodeInfo{EpisodeNumbers: []int{1}, FullSeason: true}, want: contract.ReleaseTypeSingleEpisode},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.info.releaseType(); got != test.want {
				t.Fatalf("releaseType() = %q; want %q", got, test.want)
			}
		})
	}

	if !(parsedEpisodeInfo{AirDate: "2024-01-01"}).isDaily() {
		t.Fatal("dated episode must be daily")
	}
	if !(parsedEpisodeInfo{AbsoluteEpisodeNumbers: []int{1}}).isAbsoluteNumbering() {
		t.Fatal("absolute episode must report absolute numbering")
	}
}

func TestEpisodeRuleListIsComplete(t *testing.T) {
	t.Parallel()

	// Source oracle has 36 ordered ReportTitleRegex entries. Pinning the count
	// makes accidental omission during maintenance visible even when a later,
	// broader expression happens to parse the same common fixtures.
	if got, want := len(reportTitleRegex), 36; got != want {
		t.Fatalf("len(reportTitleRegex) = %d; want %d", got, want)
	}
}

func episodeWant(
	title string,
	season int,
	episodes []int,
	absoluteEpisodes []int,
) *parsedEpisodeInfo {
	if episodes == nil {
		episodes = []int{}
	}
	if absoluteEpisodes == nil {
		absoluteEpisodes = []int{}
	}
	return &parsedEpisodeInfo{
		SeriesTitle:            title,
		SeasonNumber:           season,
		EpisodeNumbers:         episodes,
		AbsoluteEpisodeNumbers: absoluteEpisodes,
	}
}

func episodeModify(info *parsedEpisodeInfo, modify func(*parsedEpisodeInfo)) *parsedEpisodeInfo {
	modify(info)
	return info
}
