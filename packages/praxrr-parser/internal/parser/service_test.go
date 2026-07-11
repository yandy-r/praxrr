package parser

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

func TestServiceCompleteParseGoldens(t *testing.T) {
	t.Parallel()

	file, err := os.Open(filepath.Join("..", "..", "testdata", "golden", "parse.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = file.Close() })

	service := newServiceWithClock(func() time.Time {
		return time.Date(2026, time.July, 11, 18, 0, 0, 0, time.UTC)
	})
	scanner := bufio.NewScanner(file)
	seen := 0
	for scanner.Scan() {
		var fixture serviceGoldenFixture
		if err := json.Unmarshal(scanner.Bytes(), &fixture); err != nil {
			t.Fatalf("decode fixture: %v", err)
		}
		if fixture.Response.Status != 200 {
			continue
		}
		seen++

		current := fixture
		t.Run(current.ID, func(t *testing.T) {
			var request contract.ParseRequest
			if err := json.Unmarshal([]byte(current.Request.Body), &request); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if request.Type == nil {
				t.Fatal("complete parse fixture has nil media type")
			}

			var want contract.ParseResponse
			if err := json.Unmarshal(current.Response.DecodedBody, &want); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			got := service.Parse(request.Title, *request.Type)
			if !reflect.DeepEqual(got, want) {
				gotJSON, _ := json.Marshal(got)
				wantJSON, _ := json.Marshal(want)
				t.Fatalf("Parse() differs\ngot:  %s\nwant: %s", gotJSON, wantJSON)
			}

			gotJSON, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("marshal response: %v", err)
			}
			if string(gotJSON) != current.Response.Body {
				t.Fatalf("wire body differs\ngot:  %s\nwant: %s", gotJSON, current.Response.Body)
			}
		})
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if seen != 4 {
		t.Fatalf("complete parse fixtures = %d, want 4", seen)
	}
}

func TestServiceMediaDefaults(t *testing.T) {
	t.Parallel()

	service := NewService()
	tests := []struct {
		name      string
		mediaType contract.MediaType
	}{
		{name: "movie", mediaType: contract.MediaTypeMovie},
		{name: "series", mediaType: contract.MediaTypeSeries},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			got := service.Parse("Unparseable Title", test.mediaType)
			want := contract.NewParseResponse()
			want.Title = "Unparseable Title"
			want.Type = test.mediaType
			want.Source = contract.QualitySourceUnknown
			want.Modifier = contract.QualityModifierNone
			want.Languages = []contract.Language{contract.LanguageUnknown}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("Parse() = %#v; want %#v", got, want)
			}
			if got.MovieTitles == nil || got.Languages == nil || got.Episode != nil {
				t.Fatalf("default shape = movieTitles:%#v languages:%#v episode:%#v", got.MovieTitles, got.Languages, got.Episode)
			}
		})
	}
}

func TestServiceUsesInjectedClockForDailyBoundary(t *testing.T) {
	t.Parallel()

	service := newServiceWithClock(func() time.Time {
		return time.Date(2026, time.July, 11, 23, 59, 0, 0, time.UTC)
	})
	got := service.Parse("Daily.Show.2026.07.12.1080p.WEB-DL-GROUP", contract.MediaTypeSeries)
	if got.Episode == nil {
		t.Fatal("Parse() episode = nil; want tomorrow daily episode")
	}
	if got.Episode.AirDate == nil || *got.Episode.AirDate != "2026-07-12" {
		t.Fatalf("Parse() airDate = %#v, want 2026-07-12", got.Episode.AirDate)
	}
	if got.Episode.EpisodeNumbers == nil || got.Episode.AbsoluteEpisodeNumbers == nil {
		t.Fatal("episode collections must encode as [] rather than null")
	}
	if got.Episode.ReleaseType != contract.ReleaseTypeUnknown {
		t.Fatalf("releaseType = %q, want Unknown", got.Episode.ReleaseType)
	}
}

type serviceGoldenFixture struct {
	ID      string `json:"id"`
	Request struct {
		Body string `json:"body"`
	} `json:"request"`
	Response struct {
		Status      int             `json:"status"`
		Body        string          `json:"body"`
		DecodedBody json.RawMessage `json:"decodedBody"`
	} `json:"response"`
}
