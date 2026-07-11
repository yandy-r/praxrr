package parser

import (
	"slices"
	"testing"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

func TestLanguageGoldenOrderingAndGermanExpansion(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  []contract.Language
	}{
		{
			name:  "domain-language-german-dl",
			title: "Film.2020.German.DL.1080p.BluRay-GROUP",
			want:  []contract.Language{contract.LanguageGerman, contract.LanguageOriginal},
		},
		{
			name:  "domain-language-german-ml",
			title: "Film.2020.German.ML.1080p.BluRay-GROUP",
			want: []contract.Language{
				contract.LanguageGerman,
				contract.LanguageOriginal,
				contract.LanguageEnglish,
			},
		},
		{
			name:  "domain-language-order",
			title: "Film.2020.English.DE.ENG.FRENCH.JAP.KOR.简.1080p.WEB-DL-GROUP",
			want: []contract.Language{
				contract.LanguageEnglish,
				contract.LanguageGerman,
				contract.LanguageFrench,
				contract.LanguageJapanese,
				contract.LanguageKorean,
				contract.LanguageChinese,
			},
		},
		{
			name:  "unicode-fullwidth-brackets",
			title: "【字幕組】 作品名 - 012 [1080p] [ABCDEF12].mkv",
			want:  []contract.Language{contract.LanguageChinese},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := parseLanguages(test.title); !slices.Equal(got, test.want) {
				t.Fatalf("parseLanguages() = %v; want %v", got, test.want)
			}
		})
	}
}

func TestLanguageFullWordPassOrder(t *testing.T) {
	t.Parallel()

	title := "English Spanish Danish Dutch Japanese Icelandic Mandarin Cantonese Chinese " +
		"Korean Russian Romanian Hindi Arabic Thai Bulgarian Polish Vietnamese Swedish " +
		"Norwegian Finnish Turkish Portuguese Brazilian Hungarian Hebrew Ukrainian Persian " +
		"Bengali Slovak Latvian Latino Tamil Telugu Malayalam Kannada Albanian Afrikaans " +
		"Marathi Tagalog"
	want := []contract.Language{
		contract.LanguageEnglish,
		contract.LanguageSpanish,
		contract.LanguageDanish,
		contract.LanguageDutch,
		contract.LanguageJapanese,
		contract.LanguageIcelandic,
		contract.LanguageChinese,
		contract.LanguageKorean,
		contract.LanguageRussian,
		contract.LanguageRomanian,
		contract.LanguageHindi,
		contract.LanguageArabic,
		contract.LanguageThai,
		contract.LanguageBulgarian,
		contract.LanguagePolish,
		contract.LanguageVietnamese,
		contract.LanguageSwedish,
		contract.LanguageNorwegian,
		contract.LanguageFinnish,
		contract.LanguageTurkish,
		contract.LanguagePortuguese,
		contract.LanguagePortugueseBR,
		contract.LanguageHungarian,
		contract.LanguageHebrew,
		contract.LanguageUkrainian,
		contract.LanguagePersian,
		contract.LanguageBengali,
		contract.LanguageSlovak,
		contract.LanguageLatvian,
		contract.LanguageSpanishLatino,
		contract.LanguageTamil,
		contract.LanguageTelugu,
		contract.LanguageMalayalam,
		contract.LanguageKannada,
		contract.LanguageAlbanian,
		contract.LanguageAfrikaans,
		contract.LanguageMarathi,
		contract.LanguageTagalog,
	}

	if got := parseLanguages(title); !slices.Equal(got, want) {
		t.Fatalf("parseLanguages() = %v; want %v", got, want)
	}
}

func TestLanguageCaseSensitiveAbbreviations(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  []contract.Language
	}{
		{
			name:  "uppercase aliases retain match order",
			title: "Film.EN.LT.CZ.PL.BG.SK.ES.DE",
			want: []contract.Language{
				contract.LanguageEnglish,
				contract.LanguageLithuanian,
				contract.LanguageCzech,
				contract.LanguagePolish,
				contract.LanguageBulgarian,
				contract.LanguageSlovak,
				contract.LanguageSpanish,
				contract.LanguageGerman,
			},
		},
		{
			name:  "lowercase aliases are rejected",
			title: "Film.en.lt.cz.pl.bg.sk.es.de",
			want:  []contract.Language{contract.LanguageUnknown},
		},
		{
			name:  "subtitle abbreviations are rejected",
			title: "Film.SUB.EN.EN.SUB.SUB-DE.DE-SUB",
			want:  []contract.Language{contract.LanguageUnknown},
		},
		{
			name:  "DTS ES is rejected",
			title: "Film.DTS.ES",
			want:  []contract.Language{contract.LanguageUnknown},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := parseLanguages(test.title); !slices.Equal(got, test.want) {
				t.Fatalf("parseLanguages() = %v; want %v", got, test.want)
			}
		})
	}
}

func TestLanguageGeneralAliases(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  []contract.Language
	}{
		{name: "all representative aliases", title: "ENG ITA GER Flemish Greek FRA RUS BGAUDIO Dublado HUN HebDub PL-DUB [CHS] Español Catalán UKR LAT TEL VIE JAP KOR Urdu Rumantsch Khalkha KAT Orig", want: []contract.Language{
			contract.LanguagePolish,
			contract.LanguageEnglish,
			contract.LanguageItalian,
			contract.LanguageGerman,
			contract.LanguageFlemish,
			contract.LanguageGreek,
			contract.LanguageFrench,
			contract.LanguageRussian,
			contract.LanguageBulgarian,
			contract.LanguagePortugueseBR,
			contract.LanguageHungarian,
			contract.LanguageHebrew,
			contract.LanguageChinese,
			contract.LanguageSpanish,
			contract.LanguageCatalan,
			contract.LanguageUkrainian,
			contract.LanguageLatvian,
			contract.LanguageTelugu,
			contract.LanguageVietnamese,
			contract.LanguageJapanese,
			contract.LanguageKorean,
			contract.LanguageUrdu,
			contract.LanguageRomansh,
			contract.LanguageMongolian,
			contract.LanguageGeorgian,
			contract.LanguageOriginal,
		}},
		{name: "romanian special alias", title: "Film.RODUBBED", want: []contract.Language{contract.LanguageRomanian}},
		{name: "Ukrainian numbered alias", title: "Film.2xUKR", want: []contract.Language{contract.LanguageUkrainian}},
		{name: "Chinese unicode aliases deduplicate", title: "Film.简.繁.字幕", want: []contract.Language{contract.LanguageChinese}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := parseLanguages(test.title); !slices.Equal(got, test.want) {
				t.Fatalf("parseLanguages() = %v; want %v", got, test.want)
			}
		})
	}
}

func TestLanguageGermanExpansionConstraints(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  []contract.Language
	}{
		{name: "WEB-DL is not dual language", title: "Film.German.WEB-DL", want: []contract.Language{contract.LanguageGerman}},
		{name: "dot WEB DL is not dual language", title: "Film.German.WEB.DL", want: []contract.Language{contract.LanguageGerman}},
		{name: "DL without German is unknown", title: "Film.DL", want: []contract.Language{contract.LanguageUnknown}},
		{name: "ML without German is unknown", title: "Film.ML", want: []contract.Language{contract.LanguageUnknown}},
		{name: "other language blocks expansion", title: "Film.German.FRENCH.DL.ML", want: []contract.Language{contract.LanguageGerman, contract.LanguageFrench}},
		{name: "DL wins over ML", title: "Film.German.DL.ML", want: []contract.Language{contract.LanguageGerman, contract.LanguageOriginal}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := parseLanguages(test.title); !slices.Equal(got, test.want) {
				t.Fatalf("parseLanguages() = %v; want %v", got, test.want)
			}
		})
	}
}

func TestLanguageStableFirstOccurrenceDistinct(t *testing.T) {
	t.Parallel()

	title := "English.EN.ENG.French.FRA.Japanese.JAP.English"
	want := []contract.Language{
		contract.LanguageEnglish,
		contract.LanguageJapanese,
		contract.LanguageFrench,
	}
	if got := parseLanguages(title); !slices.Equal(got, want) {
		t.Fatalf("parseLanguages() = %v; want %v", got, want)
	}
}

func TestLanguageModelIdentifiers(t *testing.T) {
	t.Parallel()

	identifiers := []contract.Language{
		contract.LanguageUnknown,
		contract.LanguageEnglish,
		contract.LanguageFrench,
		contract.LanguageSpanish,
		contract.LanguageGerman,
		contract.LanguageItalian,
		contract.LanguageDanish,
		contract.LanguageDutch,
		contract.LanguageJapanese,
		contract.LanguageIcelandic,
		contract.LanguageChinese,
		contract.LanguageRussian,
		contract.LanguagePolish,
		contract.LanguageVietnamese,
		contract.LanguageSwedish,
		contract.LanguageNorwegian,
		contract.LanguageFinnish,
		contract.LanguageTurkish,
		contract.LanguagePortuguese,
		contract.LanguageFlemish,
		contract.LanguageGreek,
		contract.LanguageKorean,
		contract.LanguageHungarian,
		contract.LanguageHebrew,
		contract.LanguageLithuanian,
		contract.LanguageCzech,
		contract.LanguageHindi,
		contract.LanguageRomanian,
		contract.LanguageThai,
		contract.LanguageBulgarian,
		contract.LanguagePortugueseBR,
		contract.LanguageArabic,
		contract.LanguageUkrainian,
		contract.LanguagePersian,
		contract.LanguageBengali,
		contract.LanguageSlovak,
		contract.LanguageLatvian,
		contract.LanguageSpanishLatino,
		contract.LanguageCatalan,
		contract.LanguageCroatian,
		contract.LanguageSerbian,
		contract.LanguageBosnian,
		contract.LanguageEstonian,
		contract.LanguageTamil,
		contract.LanguageIndonesian,
		contract.LanguageTelugu,
		contract.LanguageMacedonian,
		contract.LanguageSlovenian,
		contract.LanguageMalayalam,
		contract.LanguageKannada,
		contract.LanguageAlbanian,
		contract.LanguageAfrikaans,
		contract.LanguageMarathi,
		contract.LanguageTagalog,
		contract.LanguageUrdu,
		contract.LanguageRomansh,
		contract.LanguageMongolian,
		contract.LanguageGeorgian,
		contract.LanguageOriginal,
	}

	if len(identifiers) != 59 {
		t.Fatalf("language identifier count = %d; want 59", len(identifiers))
	}
	for index, identifier := range identifiers {
		if identifier == "" {
			t.Fatalf("language identifier %d is empty", index)
		}
		for prior := 0; prior < index; prior++ {
			if identifiers[prior] == identifier {
				t.Fatalf("language identifier %q is duplicated", identifier)
			}
		}
	}
}
