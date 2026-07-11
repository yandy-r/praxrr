package parser

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

func TestQualityGoldenCorpus(t *testing.T) {
	t.Parallel()

	goldenDirectory := qualityGoldenDirectory(t)
	for _, filename := range []string{"parse.jsonl", "domain-edges.jsonl", "unicode-date.jsonl"} {
		filename := filename
		t.Run(filename, func(t *testing.T) {
			file, err := os.Open(filepath.Join(goldenDirectory, filename))
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()

			scanner := bufio.NewScanner(file)
			for scanner.Scan() {
				var fixture qualityGoldenFixture
				if err := json.Unmarshal(scanner.Bytes(), &fixture); err != nil {
					t.Fatalf("decode fixture: %v", err)
				}
				if fixture.Response.Status != 200 || fixture.Response.DecodedBody.Source == "" {
					continue
				}

				var request struct {
					Title string `json:"title"`
				}
				if err := json.Unmarshal([]byte(fixture.Request.Body), &request); err != nil {
					t.Fatalf("%s: decode request: %v", fixture.ID, err)
				}

				t.Run(fixture.ID, func(t *testing.T) {
					got := parseQuality(request.Title)
					want := qualityResult{
						Source:     fixture.Response.DecodedBody.Source,
						Resolution: fixture.Response.DecodedBody.Resolution,
						Modifier:   fixture.Response.DecodedBody.Modifier,
						Revision:   fixture.Response.DecodedBody.Revision,
					}
					if !reflect.DeepEqual(got, want) {
						t.Fatalf("parseQuality(%q) = %+v; want %+v", request.Title, got, want)
					}
				})
			}
			if err := scanner.Err(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestQualitySourceAndModifierPrecedence(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  qualityResult
	}{
		{
			name:  "defaults",
			title: "Unparseable Title",
			want:  newQualityResult(),
		},
		{
			name:  "bluray defaults to 720p",
			title: "Film.BluRay-GROUP",
			want: qualityWant(
				contract.QualitySourceBluray,
				contract.Resolution720p,
				contract.QualityModifierNone,
			),
		},
		{
			name:  "bluray xvid forces 480p before remux modifier",
			title: "Film.1080p.BluRay.Remux.XviD-GROUP",
			want: qualityWant(
				contract.QualitySourceBluray,
				contract.Resolution480p,
				contract.QualityModifierNone,
			),
		},
		{
			name:  "bluray xvidhd does not trigger xvid branch",
			title: "Film.1080p.BluRay.Remux.XvidHD-GROUP",
			want: qualityWant(
				contract.QualitySourceBluray,
				contract.Resolution1080p,
				contract.QualityModifierRemux,
			),
		},
		{
			name:  "complete bluray disk returns before remux handling",
			title: "Film.COMPLETE.BluRay.AVC-GROUP",
			want: qualityWant(
				contract.QualitySourceBluray,
				contract.ResolutionUnknown,
				contract.QualityModifierBRDisk,
			),
		},
		{
			name:  "rawhd returns before hdtv source",
			title: "Film.1080p.HDTV.Raw-HD-GROUP",
			want: qualityWant(
				contract.QualitySourceUnknown,
				contract.Resolution1080p,
				contract.QualityModifierRawHD,
			),
		},
		{
			name:  "hdtv mpeg2 modifier",
			title: "Film.1080p.HDTV.MPEG-2-GROUP",
			want: qualityWant(
				contract.QualitySourceTV,
				contract.Resolution1080p,
				contract.QualityModifierRawHD,
			),
		},
		{
			name:  "webdl default resolution",
			title: "Film.WEB-DL-GROUP",
			want: qualityWant(
				contract.QualitySourceWebDL,
				contract.Resolution480p,
				contract.QualityModifierNone,
			),
		},
		{
			name:  "webrip default resolution",
			title: "Film.WEBRip-GROUP",
			want: qualityWant(
				contract.QualitySourceWebRip,
				contract.Resolution480p,
				contract.QualityModifierNone,
			),
		},
		{
			name:  "bdrip default resolution",
			title: "Film.BDRip-GROUP",
			want: qualityWant(
				contract.QualitySourceBluray,
				contract.Resolution480p,
				contract.QualityModifierNone,
			),
		},
		{
			name:  "resolution remux fallback",
			title: "Film.2160p.Remux-GROUP",
			want: qualityWant(
				contract.QualitySourceBluray,
				contract.Resolution2160p,
				contract.QualityModifierRemux,
			),
		},
		{
			name:  "anime bluray fallback",
			title: "[Group] Anime - 01 [BD1080]",
			want: qualityWant(
				contract.QualitySourceBluray,
				contract.Resolution720p,
				contract.QualityModifierNone,
			),
		},
		{
			name:  "anime web fallback",
			title: "[Group] Anime - 01 [WEB]",
			want: qualityWant(
				contract.QualitySourceWebDL,
				contract.Resolution720p,
				contract.QualityModifierNone,
			),
		},
		{
			name:  "first source match controls branch",
			title: "Film.CAM.1080p.WEB-DL-GROUP",
			want: qualityWant(
				contract.QualitySourceCam,
				contract.Resolution1080p,
				contract.QualityModifierNone,
			),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := parseQuality(test.title); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("parseQuality(%q) = %+v; want %+v", test.title, got, test.want)
			}
		})
	}
}

func TestQualityResolutionPrecedenceAndAliases(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input string
		want  contract.Resolution
	}{
		{input: "360p", want: contract.Resolution360p},
		{input: "848x480", want: contract.Resolution480p},
		{input: "540p", want: contract.Resolution540p},
		{input: "576p", want: contract.Resolution576p},
		{input: "960p", want: contract.Resolution720p},
		{input: "FHD", want: contract.Resolution1080p},
		{input: "4k-HEVC", want: contract.Resolution2160p},
		{input: "UHD", want: contract.Resolution2160p},
		{input: "[4K]", want: contract.Resolution2160p},
		{input: "720p UHD", want: contract.Resolution720p},
		{input: "no resolution", want: contract.ResolutionUnknown},
	}

	for _, test := range tests {
		t.Run(test.input, func(t *testing.T) {
			if got := parseQualityResolution(test.input); got != test.want {
				t.Fatalf("parseQualityResolution(%q) = %d; want %d", test.input, got, test.want)
			}
		})
	}
}

func TestQualityRevisionOrderingAndCase(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		title string
		want  contract.RevisionResponse
	}{
		{name: "default", title: "Film", want: contract.NewRevisionResponse()},
		{name: "proper", title: "Film.PROPER", want: contract.RevisionResponse{Version: 2}},
		{name: "repack", title: "Film.REPACK", want: contract.RevisionResponse{Version: 2, IsRepack: true}},
		{name: "version", title: "Film.[v3]", want: contract.RevisionResponse{Version: 3}},
		{name: "version proper", title: "Film.[v3].PROPER", want: contract.RevisionResponse{Version: 4}},
		{name: "repack digit is version and repack", title: "Film.REPACK2", want: contract.RevisionResponse{Version: 3, IsRepack: true}},
		{name: "proper then repack increments twice", title: "Film.REPACK2.PROPER", want: contract.RevisionResponse{Version: 4, IsRepack: true}},
		{name: "repeated uppercase real", title: "REAL.Film.REAL", want: contract.RevisionResponse{Version: 1, Real: 2}},
		{name: "lowercase real ignored", title: "real.Film.Real", want: contract.NewRevisionResponse()},
		{name: "underscore prevents real word boundary", title: "Film_REAL_REAL", want: contract.NewRevisionResponse()},
		{name: "underscore normalization finds repack", title: "Film_REPACK_", want: contract.RevisionResponse{Version: 2, IsRepack: true}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := parseQuality(test.title).Revision
			if got != test.want {
				t.Fatalf("parseQuality(%q).Revision = %+v; want %+v", test.title, got, test.want)
			}
		})
	}
}

type qualityGoldenFixture struct {
	ID      string `json:"id"`
	Request struct {
		Body string `json:"body"`
	} `json:"request"`
	Response struct {
		Status      int `json:"status"`
		DecodedBody struct {
			Source     contract.QualitySource    `json:"source"`
			Resolution contract.Resolution       `json:"resolution"`
			Modifier   contract.QualityModifier  `json:"modifier"`
			Revision   contract.RevisionResponse `json:"revision"`
		} `json:"decodedBody"`
	} `json:"response"`
}

func qualityWant(
	source contract.QualitySource,
	resolution contract.Resolution,
	modifier contract.QualityModifier,
) qualityResult {
	return qualityResult{
		Source:     source,
		Resolution: resolution,
		Modifier:   modifier,
		Revision:   contract.NewRevisionResponse(),
	}
}

func qualityGoldenDirectory(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve quality test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", "testdata", "golden"))
}

func TestQualityResultContractDefaults(t *testing.T) {
	t.Parallel()

	want := qualityResult{
		Source:     contract.QualitySourceUnknown,
		Resolution: contract.ResolutionUnknown,
		Modifier:   contract.QualityModifierNone,
		Revision:   contract.RevisionResponse{Version: 1},
	}
	if got := newQualityResult(); !reflect.DeepEqual(got, want) {
		t.Fatalf("newQualityResult() = %s; want %s", fmt.Sprint(got), fmt.Sprint(want))
	}
}
