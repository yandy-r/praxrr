package parser

import "testing"

func TestReleaseGroupOracleBranches(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  *string
	}{
		{name: "standard", title: "The.Matrix.1999.1080p.BluRay.x264-GROUP", want: releaseGroupStringPointer("GROUP")},
		{name: "anime", title: "[SubsPlease] Example Show - 012 [1080p] [ABCDEF12].mkv", want: releaseGroupStringPointer("SubsPlease")},
		{name: "exception exact", title: "Film.2020.1080p.BluRay.QxR", want: releaseGroupStringPointer("QxR")},
		{name: "numeric rejected", title: "Film.2020.1080p.WEB-DL-1234.mkv"},
		{name: "episode rejected", title: "Example.Show.S01E05.1080p.WEB-DL-S01.mkv"},
		{name: "obfuscation cleanup", title: "Film.2020.1080p.WEB-DL-REALGROUP-Obfuscated.mkv", want: releaseGroupStringPointer("REALGROUP")},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertReleaseGroup(t, test.title, test.want)
		})
	}
}

func TestReleaseGroupSelectionPrecedenceAndLastCapture(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  string
	}{
		{
			name:  "anime precedes exact exception and standard suffix",
			title: "[Anime Time] Film.2020.QxR-GROUP.mkv",
			want:  "Anime Time",
		},
		{
			name:  "last exact exception preserves source casing",
			title: "Film.KRaLiMaRKo.Other.qXr",
			want:  "qXr",
		},
		{
			name:  "last parenthesized exception",
			title: "Film [Silence] Extra Panda)",
			want:  "Panda",
		},
		{
			name:  "last standard capture",
			title: "Film-GROUP Other-SECOND",
			want:  "SECOND",
		},
		{
			name:  "two part standard group",
			title: "Film.2020.1080p.WEB-DL-GROUP-TEAM",
			want:  "GROUP-TEAM",
		},
		{
			name:  "terminal bracket standard alternative",
			title: "Film.2020.1080p [GROUP]",
			want:  "GROUP",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertReleaseGroup(t, test.title, releaseGroupStringPointer(test.want))
		})
	}
}

func TestReleaseGroupCleanupOrder(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  string
	}{
		{name: "trim before anime", title: " \t[SubsPlease] Show.mkv\r\n", want: "SubsPlease"},
		{name: "known extension", title: "Film.2020.WEB-DL-GROUP.MKV", want: "GROUP"},
		{name: "website prefix", title: "www.example.com - Film.2020.WEB-DL-GROUP", want: "GROUP"},
		{name: "torrent suffix before anime selection", title: "[SubsPlease] Show[ettv]", want: "SubsPlease"},
		{name: "repeated cleanup suffixes", title: "Film.WEB-DL-GROUP-Obfuscated-RePACKPOST", want: "GROUP"},
		{name: "case insensitive cleanup", title: "Film.WEB-DL-GROUP-oBfUsCaTiOn", want: "GROUP"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertReleaseGroup(t, test.title, releaseGroupStringPointer(test.want))
		})
	}
}

func TestReleaseGroupStandardRejectionsAndLegacyQuirks(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  *string
	}{
		{name: "empty", title: ""},
		{name: "whitespace", title: " \t\n"},
		{name: "ordinary miss", title: "Film.2020.1080p.WEB-DL"},
		{name: "positive numeric", title: "Film-2147483647"},
		{name: "zero numeric", title: "Film-0"},
		{name: "season lowercase", title: "Film-s12"},
		{name: "episode uppercase", title: "Film-E05"},
		{name: "eight digit hex", title: "Film-aBcDeF12"},
		// C# int.TryParse returns false beyond Int32, so this numeric-only value
		// survives the numeric filter. Preserve that observable quirk.
		{name: "int32 overflow accepted", title: "Film-2147483648", want: releaseGroupStringPointer("2147483648")},
		// Rejection is deliberately confined to the standard suffix branch.
		{name: "anime season-like group accepted", title: "[S01] Film", want: releaseGroupStringPointer("S01")},
		{name: "exact numeric exception accepted", title: "Film.126811", want: releaseGroupStringPointer("126811")},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertReleaseGroup(t, test.title, test.want)
		})
	}
}

func TestReleaseGroupAvoidsCodecQualityAndIdentifierFalsePositives(t *testing.T) {
	t.Parallel()

	for _, title := range []string{
		"Film.2020.1080p.WEB-DL",
		"Film.2020.1080p.WEB-Rip",
		"Film.2020.1080p.Blu-Ray",
		"Film.2020.1080p.DTS-HD",
		"Film.2020.1080p.DTS-X",
		"Film.2020.1080p.DTS-MA",
		"Film.2020.1080p.DTS-ES",
		"Film.2020.1080p.tmdb-12345",
		"Film.2020.1080p.tmdbid-12345",
		"Film.2020.1080p.tt1234567",
	} {
		assertReleaseGroup(t, title, nil)
	}
}

func assertReleaseGroup(t *testing.T, title string, want *string) {
	t.Helper()

	got := parseReleaseGroup(title)
	if got == nil && want == nil {
		return
	}
	if got == nil || want == nil || *got != *want {
		t.Fatalf("parseReleaseGroup() = %v; want %v", printableReleaseGroupPointer(got), printableReleaseGroupPointer(want))
	}
}

func releaseGroupStringPointer(value string) *string {
	return &value
}

func printableReleaseGroupPointer(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
