package parser

import (
	"reflect"
	"testing"
)

func TestTitleOracleGoldens(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  *parsedMovieInfo
	}{
		{
			name:  "parse-movie-all-fields",
			title: "Blade.Runner.1982.Final.Cut.Remastered.2160p.UHD.BluRay.REMUX.HC.ENG.FRA.tt0083658.tmdbid-78-GROUP.mkv",
			want: &parsedMovieInfo{
				MovieTitles:   []string{"Blade Runner"},
				Year:          1982,
				Edition:       titleStringPointer("Final Cut Remastered"),
				ImdbID:        titleStringPointer("tt0083658"),
				TmdbID:        78,
				HardcodedSubs: titleStringPointer("Generic Hardcoded Subs"),
			},
		},
		{
			name:  "domain-movie-normal",
			title: "The.Matrix.1999.1080p.BluRay.x264-GROUP",
			want:  &parsedMovieInfo{MovieTitles: []string{"The Matrix"}, Year: 1999},
		},
		{
			name:  "domain-movie-alternative-titles",
			title: "Amelie AKA Le Fabuleux Destin d Amelie 2001 FRENCH 1080p BluRay-QxR",
			want: &parsedMovieInfo{
				MovieTitles: []string{
					"Amelie AKA Le Fabuleux Destin d Amelie",
					"Amelie",
					"Le Fabuleux Destin d Amelie",
				},
				Year: 2001,
			},
		},
		{
			name:  "domain-movie-anime",
			title: "[Group] Spirited Away 2001 1080p BluRay [ABCDEF12].mkv",
			want:  &parsedMovieInfo{MovieTitles: []string{"Spirited Away"}, Year: 2001},
		},
		{
			name:  "unicode-accented-movie",
			title: "Amélie.2001.FRENCH.1080p.BluRay-GROUP",
			want:  &parsedMovieInfo{MovieTitles: []string{"Amélie"}, Year: 2001},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertParsedMovieInfo(t, parseMovieTitle(test.title, false), test.want)
		})
	}
}

func TestTitleValidationRejectsObfuscationAndNonTitles(t *testing.T) {
	t.Parallel()

	// These cases correspond to ValidateBeforeParsing and every entry in the
	// source-ordered RejectHashedReleasesRegex oracle array.
	for _, title := range []string{
		"password protected yEnc Movie.2020.mkv",
		"PASSWORD.YENC.Movie.2020.mkv",
		"---___...mkv",
		"0123456789abcdef0123456789abcdef.mkv",
		"abcdefghijklmnopqrstuvwx.mkv",
		"ABCDEFGHIJK123.mkv",
		"abcdefghijkl123.mkv",
		"Backup_12345S01-02.mkv",
		"123.mkv",
		"ABC.mkv",
		"abc_xyz.Movie.2020.mkv",
		"b00bs.mkv",
	} {
		t.Run(title, func(t *testing.T) {
			if got := parseMovieTitle(title, false); got != nil {
				t.Fatalf("parseMovieTitle() = %#v; want nil", got)
			}
		})
	}
}

func TestTitleSourceOrderedReportBranches(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  *parsedMovieInfo
	}{
		{
			name: "anime version and hash",
			// The unknown outer suffix prevents CleanQualityBracketsRegex from
			// erasing the hash before the second source-ordered report rule.
			title: "[Arid] Cowboy Bebop - Knockin' on Heaven's Door v2 [00F4CDA0].mkv.rar",
			want: &parsedMovieInfo{
				MovieTitles: []string{"Cowboy Bebop - Knockin' on Heaven's Door"},
				ReleaseHash: titleStringPointer("00F4CDA0"),
			},
		},
		{
			name:  "edition report precedes normal movie",
			title: "Movie.Special.Edition.2020.1080p.mkv",
			want: &parsedMovieInfo{
				MovieTitles: []string{"Movie"},
				Year:        2020,
				Edition:     titleStringPointer("Special Edition"),
			},
		},
		{
			name:  "anime double bracket metadata and hash",
			title: "[Kulot] Violet Evergarden Gaiden [Dual-Audio][BDRip 1920x804] [91FC62A8].mkv.rar",
			want: &parsedMovieInfo{
				MovieTitles: []string{"Violet Evergarden Gaiden"},
				ReleaseHash: titleStringPointer("91FC62A8"),
			},
		},
		{
			name:  "anime parenthesized metadata and hash",
			title: "[Arid] 5 Centimeters per Second (BDRip 1920x1080) [FD8B6FF2].mkv.rar",
			want: &parsedMovieInfo{
				MovieTitles: []string{"5 Centimeters per Second"},
				ReleaseHash: titleStringPointer("FD8B6FF2"),
			},
		},
		{
			name:  "german tracker without year",
			title: "Passengers.German.DL.AC3.Dubbed..BluRay.x264-PsO",
			want:  &parsedMovieInfo{MovieTitles: []string{"Passengers"}},
		},
		{
			name: "pass the popcorn bracket marker",
			// The legacy expression captures exactly one bracket character despite
			// its source comment mentioning PassThePopcorn. The unknown suffix also
			// preserves that bracket through the earlier cleanup rule.
			title: "Star.Wars[P].rar",
			want:  &parsedMovieInfo{MovieTitles: []string{"Star Wars"}},
		},
		{
			name:  "last resort title with parentheses",
			title: "Movie (Part One).2020.1080p.mkv",
			want:  &parsedMovieInfo{MovieTitles: []string{"Movie (Part One)"}, Year: 2020},
		},
		{
			name:  "bracket year fallback",
			title: "World Movie Z Movie [2023].rar",
			want:  &parsedMovieInfo{MovieTitles: []string{"World Movie Z Movie"}, Year: 2023},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertParsedMovieInfo(t, parseMovieTitle(test.title, false), test.want)
		})
	}
}

func TestTitleReversedUnicodeBracketsAndFolderMode(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		isDir bool
		want  *parsedMovieInfo
	}{
		{
			name:  "reversed release keeps extension outside reversal",
			title: "p0801.0202.eivoM.mkv",
			want:  &parsedMovieInfo{MovieTitles: []string{"Movie"}, Year: 2020},
		},
		{
			name:  "fullwidth brackets normalize before anime rules",
			title: "【Group】 千と千尋 2001 1080p 【ABCDEF12】.mkv",
			want:  &parsedMovieInfo{MovieTitles: []string{"千と千尋"}, Year: 2001},
		},
		{
			name:  "year-first folder enabled",
			title: "2020 - Movie Name",
			isDir: true,
			want:  &parsedMovieInfo{MovieTitles: []string{"Movie Name"}, Year: 2020},
		},
		{
			name:  "year-first folder disabled",
			title: "2020 - Movie Name",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertParsedMovieInfo(t, parseMovieTitle(test.title, test.isDir), test.want)
		})
	}
}

func TestTitleAlternateTitlesAndAcronymDots(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  []string
	}{
		{name: "dotted acronym", title: "U.S.A.Movie.2020.mkv", want: []string{"U.S.A. Movie"}},
		{name: "article in acronym", title: "A.I.Artificial.Intelligence.2001.mkv", want: []string{"A.I. Artificial Intelligence"}},
		{name: "doctor abbreviation", title: "Dr.Strangelove.1964.mkv", want: []string{"Dr. Strangelove"}},
		{
			name:  "normalized dotted AKA",
			title: "Primary A.K.A. Alternate 2020.mkv",
			want:  []string{"Primary AKA Alternate", "Primary", "Alternate"},
		},
		{
			name:  "bracketed AKA",
			title: "Primary (AKA Alternate) 2020.mkv",
			want:  []string{"Primary (AKA Alternate)", "Primary", "Alternate"},
		},
		{
			name:  "slash alternate",
			title: "Primary / Alternate 2020.mkv",
			want:  []string{"Primary / Alternate", "Primary", "Alternate"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := parseMovieTitle(test.title, false)
			if got == nil {
				t.Fatal("parseMovieTitle() = nil; want movie")
			}
			if !reflect.DeepEqual(got.MovieTitles, test.want) {
				t.Fatalf("MovieTitles = %#v; want %#v", got.MovieTitles, test.want)
			}
		})
	}
}

func TestTitleEditionIdentifiersAndHardcodedSubs(t *testing.T) {
	t.Parallel()

	if got := parseEdition("Movie.2020.Directors.Cut.IMAX.1080p"); !titleStringPointersEqual(got, titleStringPointer("Directors Cut IMAX")) {
		t.Fatalf("parseEdition() = %v; want Directors Cut IMAX", printableTitlePointer(got))
	}
	if got := parseEdition("Movie.2020.1080p"); got != nil {
		t.Fatalf("parseEdition() = %v; want nil", printableTitlePointer(got))
	}

	for _, test := range []struct {
		title string
		want  *string
	}{
		{title: "Movie.tt1234567", want: titleStringPointer("tt1234567")},
		{title: "Movie.TT12345678", want: titleStringPointer("TT12345678")},
		{title: "Movie.tt123456"},
	} {
		if got := parseImdbID(test.title); !titleStringPointersEqual(got, test.want) {
			t.Fatalf("parseImdbID(%q) = %v; want %v", test.title, printableTitlePointer(got), printableTitlePointer(test.want))
		}
	}

	for _, test := range []struct {
		title string
		want  int
	}{
		{title: "Movie.tmdb-78", want: 78},
		{title: "Movie.TMDBID-2147483647", want: 2147483647},
		{title: "Movie.tmdb-2147483648"},
	} {
		if got := parseTmdbID(test.title); got != test.want {
			t.Fatalf("parseTmdbID(%q) = %d; want %d", test.title, got, test.want)
		}
	}

	for _, test := range []struct {
		title string
		want  *string
	}{
		{title: "Movie.2020.HC", want: titleStringPointer("Generic Hardcoded Subs")},
		{title: "Movie.2020.SUBBED", want: titleStringPointer("Generic Hardcoded Subs")},
		{title: "Movie.2020.ENGSUBS", want: titleStringPointer("ENGSUBS")},
		{title: "Movie.2020.HC.FRESUB", want: titleStringPointer("FRESUB")},
		{title: "Movie.2020.SOFTSUBS"},
		{title: "Movie.2020.MULTISUBS"},
		{title: "Movie.2020.HORRIBLESUBS"},
	} {
		if got := parseHardcodedSubs(test.title); !titleStringPointersEqual(got, test.want) {
			t.Fatalf("parseHardcodedSubs(%q) = %v; want %v", test.title, printableTitlePointer(got), printableTitlePointer(test.want))
		}
	}
}

func TestTitleExtensionAndExactDefaults(t *testing.T) {
	t.Parallel()

	known := parseMovieTitle("Movie.2020.MKV", false)
	assertParsedMovieInfo(t, known, &parsedMovieInfo{MovieTitles: []string{"Movie"}, Year: 2020})

	unknown := parseMovieTitle("Movie.2020.rar", false)
	assertParsedMovieInfo(t, unknown, &parsedMovieInfo{MovieTitles: []string{"Movie"}, Year: 2020})

	// The movie parser represents a domain miss as nil. Task 3.1 is responsible
	// for projecting that to movieTitles=[], zero IDs/year, and nil optionals.
	if got := parseMovieTitle("Unparseable Title", false); got != nil {
		t.Fatalf("parseMovieTitle() = %#v; want nil legacy movie defaults", got)
	}
}

func assertParsedMovieInfo(t *testing.T, got, want *parsedMovieInfo) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseMovieTitle() = %#v; want %#v", got, want)
	}
}

func titleStringPointer(value string) *string {
	return &value
}

func titleStringPointersEqual(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func printableTitlePointer(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
