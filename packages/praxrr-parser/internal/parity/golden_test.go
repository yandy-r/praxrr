package parity

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const goldenDir = "../../testdata/golden"

func TestGoldenLoadsCompleteCorpus(t *testing.T) {
	corpus, err := Load(goldenDir)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got, want := len(corpus.Records), 114; got != want {
		t.Fatalf("record count = %d, want %d", got, want)
	}
	if got, want := corpus.SelectedResponseHeaders, []string{"allow", "content-type"}; !equalStrings(got, want) {
		t.Fatalf("selected headers = %v, want %v", got, want)
	}
	if got, want := corpus.ExcludedResponseHeaders, []string{"date", "server", "transfer-encoding"}; !equalStrings(got, want) {
		t.Fatalf("excluded headers = %v, want %v", got, want)
	}

	counts := make(map[string]int)
	provenanceForms := make(map[string]bool)
	for _, record := range corpus.Records {
		counts[record.SourceFile]++
		provenanceForms[record.Provenance.DotnetRuntime] = true
		if record.SourceLine < 1 || record.SourceFile == "" {
			t.Fatalf("record %q lacks source location", record.ID)
		}
		if err := corpus.Compare(record.Response, Response{
			Status:  record.Response.Status,
			Headers: cloneMap(record.Response.Headers),
			Body:    record.Response.Body,
		}); err != nil {
			t.Fatalf("self comparison for %q failed: %v", record.ID, err)
		}
	}
	wantCounts := map[string]int{
		"domain-edges.jsonl": 40,
		"http.jsonl":         24,
		"match-batch.jsonl":  9,
		"match.jsonl":        14,
		"parse.jsonl":        8,
		"unicode-date.jsonl": 19,
	}
	if len(counts) != len(wantCounts) {
		t.Fatalf("loaded file counts = %v, want %v", counts, wantCounts)
	}
	for name, want := range wantCounts {
		if got := counts[name]; got != want {
			t.Fatalf("%s count = %d, want %d", name, got, want)
		}
	}
	if len(provenanceForms) != 2 {
		t.Fatalf("provenance encodings loaded = %d, want both actual schemas", len(provenanceForms))
	}
}

func TestGoldenRejectsCorruptRecord(t *testing.T) {
	dir := copyGoldenCorpus(t)
	path := filepath.Join(dir, "match.jsonl")
	data := readFile(t, path)
	writeFile(t, path, strings.Replace(data, `"status":200`, `"status":"200"`, 1))
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "status") {
		t.Fatalf("Load() error = %v, want corrupt status rejection", err)
	}
}

func TestGoldenRejectsMissingAndGoAuthoredProvenance(t *testing.T) {
	t.Run("missing provenance field", func(t *testing.T) {
		dir := copyGoldenCorpus(t)
		path := filepath.Join(dir, "match.jsonl")
		data := readFile(t, path)
		writeFile(t, path, strings.Replace(data, `"sourceCommit":"a02b62eac1f69b28f98349f9c2814181be2e122c",`, "", 1))
		if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "sourceCommit") {
			t.Fatalf("Load() error = %v, want missing provenance rejection", err)
		}
	})

	t.Run("Go-authored expectation", func(t *testing.T) {
		dir := copyGoldenCorpus(t)
		path := filepath.Join(dir, "match.jsonl")
		data := readFile(t, path)
		writeFile(t, path, strings.Replace(data, `"dotnetRuntime":".NET 8.0.28"`, `"dotnetRuntime":"go1.26.5 Go oracle"`, 1))
		if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "Go-authored") {
			t.Fatalf("Load() error = %v, want Go-authored provenance rejection", err)
		}
	})

	t.Run("unpinned source", func(t *testing.T) {
		dir := copyGoldenCorpus(t)
		path := filepath.Join(dir, "domain-edges.jsonl")
		data := readFile(t, path)
		writeFile(t, path, strings.Replace(data, "a02b62eac1f69b28f98349f9c2814181be2e122c", "b02b62eac1f69b28f98349f9c2814181be2e122c", 1))
		if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "pinned oracle") {
			t.Fatalf("Load() error = %v, want unpinned provenance rejection", err)
		}
	})

	t.Run("drifted runtime environment", func(t *testing.T) {
		dir := copyGoldenCorpus(t)
		path := filepath.Join(dir, "match.jsonl")
		data := readFile(t, path)
		writeFile(t, path, strings.Replace(data, `"os":"Alpine Linux v3.23 (linux/amd64)"`, `"os":"darwin/arm64"`, 1))
		if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "runtime environment") {
			t.Fatalf("Load() error = %v, want runtime provenance rejection", err)
		}
	})
}

func TestGoldenComparisonPreservesFieldsAndRawErrors(t *testing.T) {
	corpus := mustLoadGolden(t)

	expected := Response{
		Status:         200,
		Headers:        map[string]string{"content-type": "application/json; charset=utf-8"},
		Body:           `{"nullable":null,"empty":[],"nested":{"value":1}}`,
		DecodedBody:    json.RawMessage(`{"nested":{"value":1},"empty":[],"nullable":null}`),
		HasDecodedBody: true,
	}
	if err := corpus.Compare(expected, Response{
		Status:  200,
		Headers: map[string]string{"Content-Type": "application/json; charset=utf-8"},
		Body:    `{"nested":{"value":1},"nullable":null,"empty":[]}`,
	}); err != nil {
		t.Fatalf("object-order-only comparison failed: %v", err)
	}

	fieldCases := []struct {
		name string
		body string
	}{
		{name: "missing field", body: `{"empty":[],"nested":{"value":1}}`},
		{name: "null versus empty", body: `{"nullable":[],"empty":[],"nested":{"value":1}}`},
		{name: "array order", body: `{"nullable":null,"empty":[1,2],"nested":{"value":1}}`},
		{name: "number versus string", body: `{"nullable":null,"empty":[],"nested":{"value":"1"}}`},
	}
	for _, test := range fieldCases {
		t.Run(test.name, func(t *testing.T) {
			actual := Response{Status: 200, Headers: cloneMap(expected.Headers), Body: test.body}
			if err := corpus.Compare(expected, actual); err == nil || !strings.Contains(err.Error(), "semantics mismatch") {
				t.Fatalf("Compare() error = %v, want semantic field mismatch", err)
			}
		})
	}

	rawError := Response{
		Status:         400,
		Headers:        map[string]string{"content-type": "application/json; charset=utf-8"},
		Body:           `{"error":"Text is required"}`,
		DecodedBody:    json.RawMessage(`{"error":"Text is required"}`),
		HasDecodedBody: true,
	}
	actual := Response{
		Status:  400,
		Headers: cloneMap(rawError.Headers),
		Body:    `{ "error": "Text is required" }`,
	}
	if err := corpus.Compare(rawError, actual); err == nil || !strings.Contains(err.Error(), "raw body mismatch") {
		t.Fatalf("Compare() error = %v, want byte-exact raw error mismatch", err)
	}
}

func TestGoldenComparisonTransportPolicy(t *testing.T) {
	corpus := mustLoadGolden(t)
	expected := Response{
		Status:         200,
		Headers:        map[string]string{"content-type": "application/json; charset=utf-8"},
		Body:           `{"ok":true}`,
		DecodedBody:    json.RawMessage(`{"ok":true}`),
		HasDecodedBody: true,
	}

	actual := Response{
		Status: 200,
		Headers: map[string]string{
			"content-type":      "application/json; charset=utf-8",
			"date":              "tomorrow",
			"server":            "go-test",
			"transfer-encoding": "chunked",
		},
		Body: `{"ok":true}`,
	}
	if err := corpus.Compare(expected, actual); err != nil {
		t.Fatalf("explicitly excluded transport headers affected comparison: %v", err)
	}

	actual.Headers["content-type"] = "application/json"
	if err := corpus.Compare(expected, actual); err == nil || !strings.Contains(err.Error(), `header "content-type" mismatch`) {
		t.Fatalf("Compare() error = %v, want selected-header mismatch", err)
	}
	actual.Headers["content-type"] = "application/json; charset=utf-8"
	actual.Status = 201
	if err := corpus.Compare(expected, actual); err == nil || !strings.Contains(err.Error(), "status mismatch") {
		t.Fatalf("Compare() error = %v, want status mismatch", err)
	}
}

func mustLoadGolden(t *testing.T) *Corpus {
	t.Helper()
	corpus, err := Load(goldenDir)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	return corpus
}

func copyGoldenCorpus(t *testing.T) string {
	t.Helper()
	destination := t.TempDir()
	entries, err := os.ReadDir(goldenDir)
	if err != nil {
		t.Fatalf("ReadDir(%q) error = %v", goldenDir, err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(goldenDir, entry.Name()))
		if err != nil {
			t.Fatalf("ReadFile(%q) error = %v", entry.Name(), err)
		}
		if err := os.WriteFile(filepath.Join(destination, entry.Name()), data, 0o600); err != nil {
			t.Fatalf("WriteFile(%q) error = %v", entry.Name(), err)
		}
	}
	return destination
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", path, err)
	}
	return string(data)
}

func writeFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", path, err)
	}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
