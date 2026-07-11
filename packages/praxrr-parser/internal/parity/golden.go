// Package parity loads and compares the immutable response corpus captured from
// the retired .NET parser.
package parity

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
)

const manifestName = "manifest.json"

var requiredProvenanceFields = []string{
	"sourceCommit",
	"dotnetRuntime",
	"container",
	"os",
	"culture",
	"globalizationMode",
	"timeZone",
	"configuration",
	"invocation",
}

// Provenance identifies the legacy oracle which authored an expectation.
type Provenance struct {
	SourceCommit      string `json:"sourceCommit"`
	DotnetRuntime     string `json:"dotnetRuntime"`
	Container         string `json:"container"`
	OS                string `json:"os"`
	Culture           string `json:"culture"`
	GlobalizationMode string `json:"globalizationMode"`
	TimeZone          string `json:"timeZone"`
	Configuration     string `json:"configuration"`
	Invocation        string `json:"invocation"`
}

// Request is the exact request sent to the legacy oracle.
type Request struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

// Response is an observed HTTP response. DecodedBody is populated only when
// that field was present in the golden record.
type Response struct {
	Status         int
	Headers        map[string]string
	Body           string
	DecodedBody    json.RawMessage
	HasDecodedBody bool
}

// Record is one immutable oracle observation.
type Record struct {
	Category   string
	ID         string
	Notes      string
	Provenance Provenance
	Request    Request
	Response   Response
	SourceFile string
	SourceLine int
}

// Corpus contains a validated manifest and every JSONL observation in its
// directory. Returned slices and maps are independent of decoder buffers.
type Corpus struct {
	Records                 []Record
	SelectedResponseHeaders []string
	ExcludedResponseHeaders []string
	Oracle                  Provenance
}

type manifest struct {
	SchemaVersion           int               `json:"schemaVersion"`
	Oracle                  Provenance        `json:"oracle"`
	SelectedResponseHeaders []string          `json:"selectedResponseHeaders"`
	ExcludedResponseHeaders []string          `json:"excludedResponseHeaders"`
	Fixtures                []json.RawMessage `json:"fixtures"`
}

type wireRecord struct {
	Category   string          `json:"category"`
	ID         string          `json:"id"`
	Notes      string          `json:"notes"`
	Oracle     json.RawMessage `json:"oracle"`
	Provenance json.RawMessage `json:"provenance"`
	Request    json.RawMessage `json:"request"`
	Response   json.RawMessage `json:"response"`
}

type wireResponse struct {
	Status      *int              `json:"status"`
	Headers     map[string]string `json:"headers"`
	Body        *string           `json:"body"`
	DecodedBody json.RawMessage   `json:"decodedBody"`
}

// Load reads manifest.json and all JSONL files in dir. It rejects malformed
// records, duplicate IDs, incomplete provenance, provenance not pinned to the
// manifest's legacy .NET oracle, and expectations attributed to Go.
func Load(dir string) (*Corpus, error) {
	manifestPath := filepath.Join(dir, manifestName)
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("read golden manifest: %w", err)
	}

	var m manifest
	if err := decodeStrict(manifestBytes, &m); err != nil {
		return nil, fmt.Errorf("decode golden manifest: %w", err)
	}
	if m.SchemaVersion != 1 {
		return nil, fmt.Errorf("golden manifest schemaVersion must be 1, got %d", m.SchemaVersion)
	}
	if err := validateProvenance(m.Oracle, Provenance{}, false); err != nil {
		return nil, fmt.Errorf("golden manifest oracle: %w", err)
	}
	selected, err := validateHeaderPolicy(m.SelectedResponseHeaders, "selectedResponseHeaders")
	if err != nil {
		return nil, err
	}
	excluded, err := validateHeaderPolicy(m.ExcludedResponseHeaders, "excludedResponseHeaders")
	if err != nil {
		return nil, err
	}
	for _, name := range selected {
		if contains(excluded, name) {
			return nil, fmt.Errorf("response header %q cannot be both selected and excluded", name)
		}
	}

	paths, err := filepath.Glob(filepath.Join(dir, "*.jsonl"))
	if err != nil {
		return nil, fmt.Errorf("list golden records: %w", err)
	}
	if len(paths) == 0 {
		return nil, errors.New("golden corpus contains no JSONL files")
	}
	sort.Strings(paths)

	corpus := &Corpus{
		SelectedResponseHeaders: append([]string(nil), selected...),
		ExcludedResponseHeaders: append([]string(nil), excluded...),
		Oracle:                  m.Oracle,
	}
	ids := make(map[string]string)
	for _, path := range paths {
		if err := loadJSONL(path, m.Oracle, selected, ids, &corpus.Records); err != nil {
			return nil, err
		}
	}
	return corpus, nil
}

func loadJSONL(path string, pinned Provenance, selected []string, ids map[string]string, records *[]Record) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open golden records %s: %w", filepath.Base(path), err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for line := 1; scanner.Scan(); line++ {
		if len(bytes.TrimSpace(scanner.Bytes())) == 0 {
			return fmt.Errorf("%s:%d: blank lines are not allowed", filepath.Base(path), line)
		}
		record, err := decodeRecord(scanner.Bytes(), pinned, selected)
		if err != nil {
			return fmt.Errorf("%s:%d: %w", filepath.Base(path), line, err)
		}
		location := fmt.Sprintf("%s:%d", filepath.Base(path), line)
		if previous, exists := ids[record.ID]; exists {
			return fmt.Errorf("%s: duplicate golden id %q (first at %s)", location, record.ID, previous)
		}
		ids[record.ID] = location
		record.SourceFile = filepath.Base(path)
		record.SourceLine = line
		*records = append(*records, record)
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("scan golden records %s: %w", filepath.Base(path), err)
	}
	return nil
}

func decodeRecord(data []byte, pinned Provenance, selected []string) (Record, error) {
	var wire wireRecord
	if err := decodeStrict(data, &wire); err != nil {
		return Record{}, fmt.Errorf("decode record: %w", err)
	}
	if strings.TrimSpace(wire.ID) == "" || strings.TrimSpace(wire.Category) == "" {
		return Record{}, errors.New("record id and category must be non-empty")
	}

	provenanceRaw, oracleForm, err := selectProvenance(wire.Oracle, wire.Provenance)
	if err != nil {
		return Record{}, err
	}
	var provenance Provenance
	if err := decodeStrict(provenanceRaw, &provenance); err != nil {
		return Record{}, fmt.Errorf("decode provenance: %w", err)
	}
	if err := validateProvenance(provenance, pinned, oracleForm); err != nil {
		return Record{}, fmt.Errorf("invalid provenance: %w", err)
	}

	var request Request
	if len(wire.Request) == 0 || bytes.Equal(wire.Request, []byte("null")) {
		return Record{}, errors.New("request is required")
	}
	if err := decodeStrict(wire.Request, &request); err != nil {
		return Record{}, fmt.Errorf("decode request: %w", err)
	}
	if err := validateRequest(request); err != nil {
		return Record{}, err
	}

	response, err := decodeResponse(wire.Response, selected)
	if err != nil {
		return Record{}, err
	}
	return Record{
		Category:   wire.Category,
		ID:         wire.ID,
		Notes:      wire.Notes,
		Provenance: provenance,
		Request:    request,
		Response:   response,
	}, nil
}

func selectProvenance(oracle, provenance json.RawMessage) (json.RawMessage, bool, error) {
	hasOracle := len(oracle) != 0 && !bytes.Equal(oracle, []byte("null"))
	hasProvenance := len(provenance) != 0 && !bytes.Equal(provenance, []byte("null"))
	if hasOracle == hasProvenance {
		return nil, false, errors.New("record must contain exactly one of oracle or provenance")
	}
	if hasOracle {
		return oracle, true, nil
	}
	return provenance, false, nil
}

func decodeResponse(raw json.RawMessage, selected []string) (Response, error) {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return Response{}, errors.New("captured response is required")
	}
	var wire wireResponse
	if err := decodeStrict(raw, &wire); err != nil {
		return Response{}, fmt.Errorf("decode response: %w", err)
	}
	if wire.Status == nil || *wire.Status < 100 || *wire.Status > 599 {
		return Response{}, errors.New("response status must be an HTTP status integer")
	}
	if wire.Headers == nil {
		return Response{}, errors.New("response headers field is required")
	}
	if wire.Body == nil {
		return Response{}, errors.New("response body field is required")
	}
	if err := validateHeaders(wire.Headers, "response headers"); err != nil {
		return Response{}, err
	}
	for name := range wire.Headers {
		if !contains(selected, name) {
			return Response{}, fmt.Errorf("response records unselected header %q", name)
		}
	}

	hasDecoded := wire.DecodedBody != nil
	if hasDecoded {
		decoded, err := decodeJSON(wire.DecodedBody)
		if err != nil {
			return Response{}, fmt.Errorf("decodedBody is invalid JSON: %w", err)
		}
		bodyDecoded, err := decodeJSON([]byte(*wire.Body))
		if err != nil {
			return Response{}, fmt.Errorf("body with decodedBody is invalid JSON: %w", err)
		}
		if !reflect.DeepEqual(decoded, bodyDecoded) {
			return Response{}, errors.New("decodedBody does not match response body semantics")
		}
	}
	return Response{
		Status:         *wire.Status,
		Headers:        cloneMap(wire.Headers),
		Body:           *wire.Body,
		DecodedBody:    append(json.RawMessage(nil), wire.DecodedBody...),
		HasDecodedBody: hasDecoded,
	}, nil
}

func validateRequest(request Request) error {
	if request.Method != "GET" && request.Method != "POST" {
		return fmt.Errorf("request method must be GET or POST, got %q", request.Method)
	}
	if !strings.HasPrefix(request.Path, "/") || strings.HasPrefix(request.Path, "//") {
		return fmt.Errorf("request path must be origin-relative, got %q", request.Path)
	}
	if request.Headers == nil {
		return errors.New("request headers field is required")
	}
	return validateHeaders(request.Headers, "request headers")
}

func validateHeaders(headers map[string]string, location string) error {
	for name := range headers {
		if name == "" || name != strings.ToLower(name) {
			return fmt.Errorf("%s must use non-empty lowercase names, got %q", location, name)
		}
	}
	return nil
}

func validateHeaderPolicy(headers []string, location string) ([]string, error) {
	if headers == nil {
		return nil, fmt.Errorf("%s is required", location)
	}
	seen := make(map[string]struct{}, len(headers))
	result := make([]string, len(headers))
	for index, name := range headers {
		if name == "" || name != strings.ToLower(name) {
			return nil, fmt.Errorf("%s[%d] must be a non-empty lowercase header name", location, index)
		}
		if _, exists := seen[name]; exists {
			return nil, fmt.Errorf("%s contains duplicate header %q", location, name)
		}
		seen[name] = struct{}{}
		result[index] = name
	}
	return result, nil
}

func validateProvenance(provenance, pinned Provenance, exact bool) error {
	values := []string{
		provenance.SourceCommit,
		provenance.DotnetRuntime,
		provenance.Container,
		provenance.OS,
		provenance.Culture,
		provenance.GlobalizationMode,
		provenance.TimeZone,
		provenance.Configuration,
		provenance.Invocation,
	}
	for index, value := range values {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s must be non-empty", requiredProvenanceFields[index])
		}
	}
	identity := strings.ToLower(strings.Join([]string{
		provenance.DotnetRuntime,
		provenance.Configuration,
		provenance.Invocation,
	}, " "))
	if !strings.Contains(identity, ".net") && !strings.Contains(identity, "dotnet") {
		return errors.New("expectation is not attributed to the legacy .NET oracle")
	}
	if strings.Contains(identity, "go-authored") || strings.Contains(identity, "go oracle") || strings.Contains(identity, "go1.") {
		return errors.New("Go-authored expectations are forbidden")
	}
	if pinned.SourceCommit != "" {
		if provenance.SourceCommit != pinned.SourceCommit {
			return fmt.Errorf("sourceCommit %q does not match pinned oracle", provenance.SourceCommit)
		}
		pinnedDigest := imageDigest(pinned.Container)
		if pinnedDigest == "" || imageDigest(provenance.Container) != pinnedDigest {
			return errors.New("container digest does not match pinned oracle")
		}
		if exact && provenance != pinned {
			return errors.New("oracle provenance does not exactly match the manifest pin")
		}
		if !exact {
			if provenance.Culture != pinned.Culture || provenance.TimeZone != pinned.TimeZone {
				return errors.New("culture or timeZone does not match pinned oracle")
			}
			if !commonRuntimeVersion(provenance.DotnetRuntime, pinned.DotnetRuntime) {
				return errors.New("dotnetRuntime patch does not match pinned oracle")
			}
			if !hasAllFold(provenance.GlobalizationMode, "invariant") ||
				!hasAllFold(provenance.Configuration, "production", "parser", "1.0.0") ||
				!hasAllFold(provenance.Invocation, "dotnet", "parser.dll") ||
				!hasAllFold(provenance.OS, "linux") ||
				(!hasAllFold(provenance.OS, "amd64") && !hasAllFold(provenance.OS, "x64")) {
				return errors.New("provenance runtime environment does not match the pinned legacy oracle")
			}
		}
	}
	return nil
}

func commonRuntimeVersion(left, right string) bool {
	for _, leftField := range strings.FieldsFunc(left, func(r rune) bool {
		return (r < '0' || r > '9') && r != '.'
	}) {
		if strings.Count(leftField, ".") < 2 {
			continue
		}
		for _, rightField := range strings.FieldsFunc(right, func(r rune) bool {
			return (r < '0' || r > '9') && r != '.'
		}) {
			if leftField == rightField {
				return true
			}
		}
	}
	return false
}

func hasAllFold(value string, fragments ...string) bool {
	lower := strings.ToLower(value)
	for _, fragment := range fragments {
		if !strings.Contains(lower, strings.ToLower(fragment)) {
			return false
		}
	}
	return true
}

func imageDigest(container string) string {
	lower := strings.ToLower(container)
	index := strings.Index(lower, "sha256:")
	if index < 0 {
		return ""
	}
	digest := lower[index+len("sha256:"):]
	if len(digest) < sha256.Size*2 {
		return ""
	}
	digest = digest[:sha256.Size*2]
	if _, err := hex.DecodeString(digest); err != nil {
		return ""
	}
	return digest
}

// Compare checks an implementation response against one golden response.
// JSON object order is ignored. Status, JSON field presence, array order,
// scalar types, selected headers, and raw non-success bodies remain exact.
func (c *Corpus) Compare(expected Response, actual Response) error {
	if expected.Status != actual.Status {
		return fmt.Errorf("status mismatch: expected %d, got %d", expected.Status, actual.Status)
	}
	if err := compareSelectedHeaders(expected.Headers, actual.Headers, c.SelectedResponseHeaders); err != nil {
		return err
	}
	if expected.Status >= 400 || !expected.HasDecodedBody {
		if expected.Body != actual.Body {
			return fmt.Errorf("raw body mismatch: expected %q, got %q", expected.Body, actual.Body)
		}
		return nil
	}

	expectedJSON, err := decodeJSON(expected.DecodedBody)
	if err != nil {
		return fmt.Errorf("invalid expected decoded body: %w", err)
	}
	actualJSON, err := decodeJSON([]byte(actual.Body))
	if err != nil {
		return fmt.Errorf("actual body is not valid JSON: %w", err)
	}
	if !reflect.DeepEqual(expectedJSON, actualJSON) {
		return fmt.Errorf("JSON semantics mismatch: expected %s, got %s", expected.DecodedBody, actual.Body)
	}
	return nil
}

func compareSelectedHeaders(expected, actual map[string]string, selected []string) error {
	actualLower := make(map[string]string, len(actual))
	for name, value := range actual {
		lower := strings.ToLower(name)
		if previous, exists := actualLower[lower]; exists && previous != value {
			return fmt.Errorf("actual response has conflicting values for header %q", lower)
		}
		actualLower[lower] = value
	}
	for _, name := range selected {
		expectedValue, expectedPresent := expected[name]
		actualValue, actualPresent := actualLower[name]
		if expectedPresent != actualPresent || expectedValue != actualValue {
			return fmt.Errorf("header %q mismatch: expected (%t, %q), got (%t, %q)", name, expectedPresent, expectedValue, actualPresent, actualValue)
		}
	}
	return nil
}

func decodeStrict(data []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func decodeJSON(data []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, errors.New("multiple JSON values")
		}
		return nil, err
	}
	return value, nil
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func cloneMap(source map[string]string) map[string]string {
	result := make(map[string]string, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}
