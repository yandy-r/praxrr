package contract

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type goldenRecord struct {
	ID      string `json:"id"`
	Request struct {
		Body string `json:"body"`
		Path string `json:"path"`
	} `json:"request"`
	Response struct {
		Body        string          `json:"body"`
		DecodedBody json.RawMessage `json:"decodedBody"`
		Status      int             `json:"status"`
	} `json:"response"`
}

func TestEnumWireValues(t *testing.T) {
	t.Parallel()

	assertValues(t, "media type", []MediaType{MediaTypeMovie, MediaTypeSeries}, []MediaType{"movie", "series"})
	assertValues(t, "quality source", []QualitySource{
		QualitySourceUnknown,
		QualitySourceCam,
		QualitySourceTelesync,
		QualitySourceTelecine,
		QualitySourceWorkprint,
		QualitySourceDVD,
		QualitySourceTV,
		QualitySourceWebDL,
		QualitySourceWebRip,
		QualitySourceBluray,
	}, []QualitySource{
		"Unknown", "Cam", "Telesync", "Telecine", "Workprint", "DVD", "TV", "WebDL", "WebRip", "Bluray",
	})
	assertValues(t, "resolution", []Resolution{
		ResolutionUnknown,
		Resolution360p,
		Resolution480p,
		Resolution540p,
		Resolution576p,
		Resolution720p,
		Resolution1080p,
		Resolution2160p,
	}, []Resolution{0, 360, 480, 540, 576, 720, 1080, 2160})
	assertValues(t, "quality modifier", []QualityModifier{
		QualityModifierNone,
		QualityModifierRegional,
		QualityModifierScreener,
		QualityModifierRawHD,
		QualityModifierBRDisk,
		QualityModifierRemux,
	}, []QualityModifier{"None", "Regional", "Screener", "RawHD", "BRDisk", "Remux"})
	assertValues(t, "language", []Language{
		LanguageUnknown,
		LanguageEnglish,
		LanguageFrench,
		LanguageSpanish,
		LanguageGerman,
		LanguageItalian,
		LanguageDanish,
		LanguageDutch,
		LanguageJapanese,
		LanguageIcelandic,
		LanguageChinese,
		LanguageRussian,
		LanguagePolish,
		LanguageVietnamese,
		LanguageSwedish,
		LanguageNorwegian,
		LanguageFinnish,
		LanguageTurkish,
		LanguagePortuguese,
		LanguageFlemish,
		LanguageGreek,
		LanguageKorean,
		LanguageHungarian,
		LanguageHebrew,
		LanguageLithuanian,
		LanguageCzech,
		LanguageHindi,
		LanguageRomanian,
		LanguageThai,
		LanguageBulgarian,
		LanguagePortugueseBR,
		LanguageArabic,
		LanguageUkrainian,
		LanguagePersian,
		LanguageBengali,
		LanguageSlovak,
		LanguageLatvian,
		LanguageSpanishLatino,
		LanguageCatalan,
		LanguageCroatian,
		LanguageSerbian,
		LanguageBosnian,
		LanguageEstonian,
		LanguageTamil,
		LanguageIndonesian,
		LanguageTelugu,
		LanguageMacedonian,
		LanguageSlovenian,
		LanguageMalayalam,
		LanguageKannada,
		LanguageAlbanian,
		LanguageAfrikaans,
		LanguageMarathi,
		LanguageTagalog,
		LanguageUrdu,
		LanguageRomansh,
		LanguageMongolian,
		LanguageGeorgian,
		LanguageOriginal,
	}, []Language{
		"Unknown", "English", "French", "Spanish", "German", "Italian", "Danish", "Dutch", "Japanese", "Icelandic",
		"Chinese", "Russian", "Polish", "Vietnamese", "Swedish", "Norwegian", "Finnish", "Turkish", "Portuguese",
		"Flemish", "Greek", "Korean", "Hungarian", "Hebrew", "Lithuanian", "Czech", "Hindi", "Romanian", "Thai",
		"Bulgarian", "PortugueseBR", "Arabic", "Ukrainian", "Persian", "Bengali", "Slovak", "Latvian", "SpanishLatino",
		"Catalan", "Croatian", "Serbian", "Bosnian", "Estonian", "Tamil", "Indonesian", "Telugu", "Macedonian",
		"Slovenian", "Malayalam", "Kannada", "Albanian", "Afrikaans", "Marathi", "Tagalog", "Urdu", "Romansh",
		"Mongolian", "Georgian", "Original",
	})
	assertValues(t, "release type", []ReleaseType{
		ReleaseTypeUnknown,
		ReleaseTypeSingleEpisode,
		ReleaseTypeMultiEpisode,
		ReleaseTypeSeasonPack,
	}, []ReleaseType{"Unknown", "SingleEpisode", "MultiEpisode", "SeasonPack"})
}

func TestInitializedResponseFieldPresence(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		value any
		want  string
	}{
		{
			name:  "parse",
			value: NewParseResponse(),
			want:  `{"title":"","type":"","source":"","resolution":0,"modifier":"","revision":{"version":1,"real":0,"isRepack":false},"languages":[],"releaseGroup":null,"movieTitles":[],"year":0,"edition":null,"imdbId":null,"tmdbId":0,"hardcodedSubs":null,"releaseHash":null,"episode":null}`,
		},
		{
			name:  "episode",
			value: NewEpisodeResponse(),
			want:  `{"seriesTitle":null,"seasonNumber":0,"episodeNumbers":[],"absoluteEpisodeNumbers":[],"airDate":null,"fullSeason":false,"isPartialSeason":false,"isMultiSeason":false,"isMiniSeries":false,"special":false,"releaseType":"Unknown"}`,
		},
		{
			name:  "match",
			value: NewMatchResponse(),
			want:  `{"results":{}}`,
		},
		{
			name:  "batch match",
			value: NewBatchMatchResponse(),
			want:  `{"results":{}}`,
		},
		{
			name:  "health",
			value: HealthResponse{Status: HealthStatusHealthy, Version: "1.0.0"},
			want:  `{"status":"healthy","version":"1.0.0"}`,
		},
		{
			name:  "error",
			value: ErrorResponse{Error: ErrorTitleRequired},
			want:  `{"error":"Title is required"}`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := json.Marshal(test.value)
			if err != nil {
				t.Fatalf("marshal response: %v", err)
			}
			if string(got) != test.want {
				t.Fatalf("wire response mismatch\n got: %s\nwant: %s", got, test.want)
			}
		})
	}
}

func TestRequestNullEmptyAndOrdering(t *testing.T) {
	t.Parallel()

	movie := MediaTypeMovie
	tests := []struct {
		name  string
		value any
		want  string
	}{
		{
			name:  "parse fields",
			value: ParseRequest{Title: "Example", Type: &movie},
			want:  `{"title":"Example","type":"movie"}`,
		},
		{
			name:  "parse null type",
			value: ParseRequest{Title: "Example"},
			want:  `{"title":"Example","type":null}`,
		},
		{
			name:  "match null patterns",
			value: MatchRequest{Text: "Example"},
			want:  `{"text":"Example","patterns":null}`,
		},
		{
			name:  "match empty patterns",
			value: MatchRequest{Text: "Example", Patterns: []string{}},
			want:  `{"text":"Example","patterns":[]}`,
		},
		{
			name: "match ordered patterns",
			value: MatchRequest{
				Text:     "Example",
				Patterns: []string{"third", "first", "second"},
			},
			want: `{"text":"Example","patterns":["third","first","second"]}`,
		},
		{
			name:  "batch null slices",
			value: BatchMatchRequest{},
			want:  `{"texts":null,"patterns":null}`,
		},
		{
			name:  "batch empty slices",
			value: BatchMatchRequest{Texts: []string{}, Patterns: []string{}},
			want:  `{"texts":[],"patterns":[]}`,
		},
		{
			name: "batch ordered slices",
			value: BatchMatchRequest{
				Texts:    []string{"beta", "alpha"},
				Patterns: []string{"b", "a"},
			},
			want: `{"texts":["beta","alpha"],"patterns":["b","a"]}`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := json.Marshal(test.value)
			if err != nil {
				t.Fatalf("marshal request: %v", err)
			}
			if string(got) != test.want {
				t.Fatalf("wire request mismatch\n got: %s\nwant: %s", got, test.want)
			}
		})
	}
}

func TestOracleCorpusWireContracts(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "testdata", "golden", "*.jsonl"))
	if err != nil {
		t.Fatalf("locate golden corpus: %v", err)
	}
	if len(files) < 6 {
		t.Fatalf("golden corpus file count = %d, want at least 6", len(files))
	}

	recordCount := 0
	for _, file := range files {
		file := file
		t.Run(filepath.Base(file), func(t *testing.T) {
			count := verifyGoldenFile(t, file)
			recordCount += count
		})
	}
	if recordCount < 114 {
		t.Fatalf("golden corpus record count = %d, want at least 114", recordCount)
	}
}

func verifyGoldenFile(t *testing.T, path string) int {
	t.Helper()

	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open golden file: %v", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	count := 0
	for scanner.Scan() {
		count++
		var record goldenRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			t.Fatalf("record %d: decode envelope: %v", count, err)
		}
		if record.ID == "" || record.Request.Path == "" || record.Response.Status == 0 {
			t.Fatalf("record %d: incomplete golden schema", count)
		}

		t.Run(record.ID, func(t *testing.T) {
			verifyGoldenRequest(t, record)
			verifyGoldenResponse(t, record)
		})
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("read golden file: %v", err)
	}
	return count
}

func verifyGoldenRequest(t *testing.T, record goldenRecord) {
	t.Helper()

	body := []byte(record.Request.Body)
	if len(body) == 0 || !json.Valid(body) || body[0] != '{' {
		return
	}

	var value any
	switch record.Request.Path {
	case "/parse":
		value = &ParseRequest{}
	case "/match":
		value = &MatchRequest{}
	case "/match/batch":
		value = &BatchMatchRequest{}
	case "/health":
		return
	default:
		return
	}

	if err := json.Unmarshal(body, value); err != nil {
		// The HTTP corpus deliberately contains wrong field and element types.
		if record.Response.Status == 400 {
			return
		}
		t.Fatalf("decode request: %v", err)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("re-encode request: %v", err)
	}
	assertJSONEqual(t, encoded, body)
}

func verifyGoldenResponse(t *testing.T, record goldenRecord) {
	t.Helper()

	if record.Response.Body == "" {
		return
	}
	body := []byte(record.Response.Body)
	if !json.Valid(body) {
		t.Fatalf("oracle response is not valid JSON: %s", body)
	}
	if len(record.Response.DecodedBody) == 0 {
		t.Fatal("JSON oracle response has no decodedBody")
	}
	assertJSONEqual(t, record.Response.DecodedBody, body)

	var value any
	if record.Response.Status >= 400 {
		value = &ErrorResponse{}
	} else {
		switch record.Request.Path {
		case "/health":
			value = &HealthResponse{}
		case "/parse":
			value = &ParseResponse{}
		case "/match":
			value = &MatchResponse{}
		case "/match/batch":
			value = &BatchMatchResponse{}
		default:
			t.Fatalf("successful response for unsupported path %q", record.Request.Path)
		}
	}

	if err := json.Unmarshal(body, value); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("re-encode response: %v", err)
	}
	assertJSONEqual(t, encoded, body)

	// Struct-backed parse and health bodies must also retain the oracle's exact
	// field order. Array ordering is covered by the semantic comparison above.
	// Compare tokens rather than raw bytes because System.Text.Json escapes
	// supplementary Unicode while encoding/json emits valid UTF-8.
	if record.Response.Status < 400 && (record.Request.Path == "/parse" || record.Request.Path == "/health") {
		gotOrder := objectKeyOrder(t, encoded)
		wantOrder := objectKeyOrder(t, body)
		if !reflect.DeepEqual(gotOrder, wantOrder) {
			t.Fatalf("response field order mismatch\n got: %v\nwant: %v", gotOrder, wantOrder)
		}
	}
}

func objectKeyOrder(t *testing.T, body []byte) []string {
	t.Helper()

	decoder := json.NewDecoder(bytes.NewReader(body))
	keys := make([]string, 0)
	collectObjectKeys(t, decoder, &keys)
	return keys
}

func collectObjectKeys(t *testing.T, decoder *json.Decoder, keys *[]string) {
	t.Helper()

	token, err := decoder.Token()
	if err != nil {
		t.Fatalf("read JSON token: %v", err)
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return
	}

	switch delimiter {
	case '{':
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				t.Fatalf("read JSON object key: %v", err)
			}
			key, ok := keyToken.(string)
			if !ok {
				t.Fatalf("JSON object key has type %T", keyToken)
			}
			*keys = append(*keys, key)
			collectObjectKeys(t, decoder, keys)
		}
	case '[':
		for decoder.More() {
			collectObjectKeys(t, decoder, keys)
		}
	default:
		t.Fatalf("unexpected JSON delimiter %q", delimiter)
	}
	if _, err := decoder.Token(); err != nil {
		t.Fatalf("read closing JSON delimiter: %v", err)
	}
}

func assertJSONEqual(t *testing.T, got, want []byte) {
	t.Helper()

	var gotValue any
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("decode actual JSON: %v", err)
	}
	var wantValue any
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("decode expected JSON: %v", err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Fatalf("JSON mismatch\n got: %s\nwant: %s", got, want)
	}
}

func assertValues[T comparable](t *testing.T, name string, got, want []T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s values mismatch\n got: %v\nwant: %v", name, got, want)
	}

	for index, value := range got {
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatalf("marshal %s value %d: %v", name, index, err)
		}
		if len(encoded) == 0 {
			t.Fatalf("marshal %s value %d: empty output", name, index)
		}
	}
}

func TestContractStructsHaveExplicitJSONTagsWithoutOmitEmpty(t *testing.T) {
	t.Parallel()

	types := []any{
		ParseRequest{},
		MatchRequest{},
		BatchMatchRequest{},
		HealthResponse{},
		ErrorResponse{},
		RevisionResponse{},
		EpisodeResponse{},
		ParseResponse{},
		MatchResponse{},
		BatchMatchResponse{},
	}
	for _, value := range types {
		typeOf := reflect.TypeOf(value)
		for index := range typeOf.NumField() {
			field := typeOf.Field(index)
			tag, ok := field.Tag.Lookup("json")
			if !ok || tag == "" {
				t.Errorf("%s.%s has no explicit JSON tag", typeOf.Name(), field.Name)
			}
			if bytes.Contains([]byte(tag), []byte("omitempty")) {
				t.Errorf("%s.%s unexpectedly uses omitempty", typeOf.Name(), field.Name)
			}
		}
	}
}

func ExampleNewParseResponse() {
	response := NewParseResponse()
	encoded, _ := json.Marshal(response)
	fmt.Println(string(encoded))
	// Output: {"title":"","type":"","source":"","resolution":0,"modifier":"","revision":{"version":1,"real":0,"isRepack":false},"languages":[],"releaseGroup":null,"movieTitles":[],"year":0,"edition":null,"imdbId":null,"tmdbId":0,"hardcodedSubs":null,"releaseHash":null,"episode":null}
}
