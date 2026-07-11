package parity

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"

	_ "github.com/yandy-r/praxrr/packages/praxrr-parser/internal/parser"
)

const (
	wantModulePath      = "github.com/yandy-r/praxrr/packages/praxrr-parser"
	wantLanguageVersion = "1.25.0"
	wantToolchain       = "go1.26.5"
	wantRegexp2Version  = "v2.3.0"
	wantCorpusRecords   = 114
)

func TestFoundationModuleAndToolchain(t *testing.T) {
	root := moduleRoot(t)
	goMod := readFoundationFile(t, filepath.Join(root, "go.mod"))

	requireDirective(t, goMod, "module", wantModulePath)
	requireDirective(t, goMod, "go", wantLanguageVersion)
	requireDirective(t, goMod, "toolchain", wantToolchain)
	requireModuleVersion(t, goMod, "github.com/dlclark/regexp2/v2", wantRegexp2Version)
	if got := runtime.Version(); got != wantToolchain {
		t.Fatalf("running Go version = %q, want exact pinned toolchain %q", got, wantToolchain)
	}

	mise := readFoundationFile(t, filepath.Join(root, "..", "..", "mise.toml"))
	if got := tomlToolValue(mise, "go"); got != strings.TrimPrefix(wantToolchain, "go") {
		t.Fatalf("mise Go version = %q, want %q", got, strings.TrimPrefix(wantToolchain, "go"))
	}
}

func TestFoundationModuleMetadataIsCleanAndVerified(t *testing.T) {
	root := moduleRoot(t)
	runFoundationCommand(t, root, "go", "mod", "tidy", "-diff")
	runFoundationCommand(t, root, "go", "mod", "verify")
}

func TestFoundationRegexBoundaryAndNoSkippedRequirements(t *testing.T) {
	root := moduleRoot(t)
	regexp2Imports := []string{}
	staticConstructors := 0
	skips := []string{}

	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if entry.Name() == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}

		fileSet := token.NewFileSet()
		file, parseErr := parser.ParseFile(fileSet, path, nil, 0)
		if parseErr != nil {
			return fmt.Errorf("parse %s: %w", path, parseErr)
		}
		relative, relativeErr := filepath.Rel(root, path)
		if relativeErr != nil {
			return relativeErr
		}
		for _, imported := range file.Imports {
			importPath, unquoteErr := strconv.Unquote(imported.Path.Value)
			if unquoteErr != nil {
				return fmt.Errorf("unquote import in %s: %w", relative, unquoteErr)
			}
			switch importPath {
			case "github.com/dlclark/regexp2/v2":
				regexp2Imports = append(regexp2Imports, filepath.ToSlash(relative))
			case "regexp", "regexp/syntax":
				return fmt.Errorf("%s imports forbidden standard regex package %q", relative, importPath)
			}
		}

		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			switch function := call.Fun.(type) {
			case *ast.Ident:
				if !strings.HasSuffix(relative, "_test.go") &&
					(function.Name == "mustCompileStaticRegex" || function.Name == "mustCompileRegexReplacement") {
					staticConstructors++
				}
			case *ast.SelectorExpr:
				if strings.HasSuffix(relative, "_test.go") &&
					(function.Sel.Name == "Skip" || function.Sel.Name == "Skipf" ||
						function.Sel.Name == "SkipNow" || function.Sel.Name == "Short") {
					position := fileSet.Position(call.Pos())
					skips = append(skips, fmt.Sprintf("%s:%d %s", filepath.ToSlash(relative), position.Line, function.Sel.Name))
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("inspect Go foundation: %v", err)
	}

	if got, want := regexp2Imports, []string{"internal/parser/regex.go"}; !equalStrings(got, want) {
		t.Fatalf("regexp2 imports = %v, want sole adapter import %v", got, want)
	}
	if staticConstructors == 0 {
		t.Fatal("no production static regex constructors found")
	}
	// The blank import above initializes the parser package. Every package-level
	// static regex therefore compiled successfully before this test could run.
	if len(skips) != 0 {
		t.Fatalf("foundation contains skipped or short-mode requirements: %v", skips)
	}
}

func TestFoundationLimitsMatchApprovedMeasurement(t *testing.T) {
	root := moduleRoot(t)
	limitsPath := filepath.Join(root, "testdata", "golden", "limits.json")
	var artifact limitsArtifact
	decodeFoundationJSON(t, limitsPath, &artifact)
	if artifact.SchemaVersion != 1 {
		t.Fatalf("limits schemaVersion = %d, want 1", artifact.SchemaVersion)
	}
	if strings.TrimSpace(artifact.Environment.CapturedAt) == "" ||
		strings.TrimSpace(artifact.Environment.SourceCommit) == "" {
		t.Fatal("limits measurement lacks capture time or source commit provenance")
	}

	corpus := mustLoadGolden(t)
	if artifact.Environment.SourceCommit != corpus.Oracle.SourceCommit {
		t.Fatalf("limits source commit = %q, golden oracle = %q", artifact.Environment.SourceCommit, corpus.Oracle.SourceCommit)
	}
	if !strings.Contains(artifact.Environment.Oracle.ImageDigest, imageDigest(corpus.Oracle.Container)) {
		t.Fatalf("limits oracle digest %q does not match golden oracle %q", artifact.Environment.Oracle.ImageDigest, corpus.Oracle.Container)
	}
	if artifact.Environment.Oracle.ParserVersion != "1.0.0" ||
		!strings.Contains(corpus.Oracle.Configuration, "1.0.0") {
		t.Fatal("limits and golden provenance do not identify the same parser version")
	}

	wantConstants := map[string]int{
		"request_body_bytes":        integerConstant(t, root, "maxRequestBodyBytes"),
		"text_characters":           integerConstant(t, root, "maxTextCharacters"),
		"pattern_characters":        integerConstant(t, root, "maxPatternCharacters"),
		"text_count":                integerConstant(t, root, "maxTextCount"),
		"pattern_count":             integerConstant(t, root, "maxPatternCount"),
		"unique_key_count":          integerConstant(t, root, "maxUniqueKeyCount"),
		"text_pattern_work_product": integerConstant(t, root, "maxMatchWorkProduct"),
	}
	if len(artifact.Dimensions) != len(wantConstants) {
		t.Fatalf("measured dimensions = %d, want %d", len(artifact.Dimensions), len(wantConstants))
	}

	seen := make(map[string]bool, len(artifact.Dimensions))
	for _, dimension := range artifact.Dimensions {
		if seen[dimension.ID] {
			t.Fatalf("duplicate measured dimension %q", dimension.ID)
		}
		seen[dimension.ID] = true
		constant, ok := wantConstants[dimension.ID]
		if !ok {
			t.Fatalf("unrecognized measured dimension %q", dimension.ID)
		}
		if dimension.Status != "measured" || dimension.Approval.State != "approved" ||
			dimension.PendingReason != nil {
			t.Fatalf("dimension %q is not measured and approved without pending work", dimension.ID)
		}
		if dimension.ObservedMaximum <= 0 || dimension.Samples.Count <= 0 ||
			dimension.Samples.P50 <= 0 || dimension.Samples.P95 <= 0 || dimension.Samples.P99 <= 0 {
			t.Fatalf("dimension %q lacks finite positive measurement samples", dimension.ID)
		}
		if dimension.Margin.Formula != "max(observed * 2, observed + fixed_headroom)" ||
			dimension.Margin.ComputedLimit != dimension.ChosenLimit ||
			dimension.ChosenLimit != constant || dimension.OverflowCase.Value != constant+1 ||
			dimension.OverflowCase.Expected != "reject-before-work" {
			t.Fatalf("dimension %q is not bound exactly to its measured limit and one-over case", dimension.ID)
		}
		if dimension.ClientDeadlineRelation.ClientDeadlineMs != 30000 ||
			strings.TrimSpace(dimension.ClientDeadlineRelation.Relation) == "" {
			t.Fatalf("dimension %q lacks its client deadline relationship", dimension.ID)
		}
		if len(dimension.Sources) == 0 {
			t.Fatalf("dimension %q has no source evidence", dimension.ID)
		}
		for _, source := range dimension.Sources {
			requireEvidencePath(t, root, source.Path)
		}
	}
}

func TestFoundationCorpusIsCompleteAndRegenerable(t *testing.T) {
	root := moduleRoot(t)
	corpus := mustLoadGolden(t)
	if len(corpus.Records) != wantCorpusRecords {
		t.Fatalf("accessible golden records = %d, want %d", len(corpus.Records), wantCorpusRecords)
	}

	manifestPath := filepath.Join(root, "testdata", "golden", "manifest.json")
	var manifest regenerationManifest
	decodeFoundationJSON(t, manifestPath, &manifest)
	if len(manifest.Fixtures) != wantCorpusRecords {
		t.Fatalf("regeneration manifest fixtures = %d, want all %d corpus records", len(manifest.Fixtures), wantCorpusRecords)
	}

	manifestByID := make(map[string]regenerationFixture, len(manifest.Fixtures))
	for _, fixture := range manifest.Fixtures {
		if _, exists := manifestByID[fixture.ID]; exists {
			t.Fatalf("duplicate regeneration fixture id %q", fixture.ID)
		}
		if fixture.Response == nil {
			t.Fatalf("regeneration fixture %q has no captured response", fixture.ID)
		}
		manifestByID[fixture.ID] = fixture
	}
	for _, record := range corpus.Records {
		fixture, ok := manifestByID[record.ID]
		if !ok {
			t.Fatalf("corpus record %q is absent from the regeneration manifest", record.ID)
		}
		if fixture.Category != record.Category || fixture.Request.Method != record.Request.Method ||
			fixture.Request.Path != record.Request.Path || fixture.Request.Body != record.Request.Body ||
			!equalStringMap(fixture.Request.Headers, record.Request.Headers) ||
			fixture.Response.Status != record.Response.Status || fixture.Response.Body != record.Response.Body ||
			!equalStringMap(fixture.Response.Headers, record.Response.Headers) {
			t.Fatalf("regeneration fixture %q differs from accessible corpus evidence", record.ID)
		}
	}

	captureTool := readFoundationFile(t, filepath.Join(root, "..", "..", "scripts", "capture-parser-goldens.ts"))
	for _, required := range []string{"--validate", "--verify-recapture"} {
		if !strings.Contains(captureTool, required) {
			t.Fatalf("capture tool lacks regeneration guard %q", required)
		}
	}
	if strings.Contains(captureTool, `Deno.Command("go"`) {
		t.Fatal("capture tool must not derive oracle expectations by invoking Go")
	}
	captureGuide := readFoundationFile(t, filepath.Join(root, "tools", "golden", "README.md"))
	if !strings.Contains(captureGuide, "never repair a golden by deriving the answer from Go") {
		t.Fatal("golden regeneration guide lacks the one-way legacy-oracle rule")
	}
}

type limitsArtifact struct {
	SchemaVersion int `json:"schemaVersion"`
	Environment   struct {
		CapturedAt   string `json:"capturedAt"`
		SourceCommit string `json:"sourceCommit"`
		Oracle       struct {
			ImageDigest   string `json:"imageDigest"`
			ParserVersion string `json:"parserVersion"`
		} `json:"oracle"`
	} `json:"environment"`
	Dimensions []struct {
		ID              string `json:"id"`
		Status          string `json:"status"`
		ObservedMaximum int    `json:"observedMaximum"`
		Samples         struct {
			Count int     `json:"count"`
			P50   float64 `json:"p50"`
			P95   float64 `json:"p95"`
			P99   float64 `json:"p99"`
		} `json:"samples"`
		Margin struct {
			Formula       string `json:"formula"`
			ComputedLimit int    `json:"computedLimit"`
		} `json:"margin"`
		ChosenLimit            int `json:"chosenLimit"`
		ClientDeadlineRelation struct {
			ClientDeadlineMs int    `json:"clientDeadlineMs"`
			Relation         string `json:"relation"`
		} `json:"clientDeadlineRelation"`
		OverflowCase struct {
			Value    int    `json:"value"`
			Expected string `json:"expected"`
		} `json:"overflowCase"`
		Approval struct {
			State string `json:"state"`
		} `json:"approval"`
		PendingReason *string `json:"pendingReason"`
		Sources       []struct {
			Path string `json:"path"`
		} `json:"sources"`
	} `json:"dimensions"`
}

type regenerationManifest struct {
	Fixtures []regenerationFixture `json:"fixtures"`
}

type regenerationFixture struct {
	ID       string  `json:"id"`
	Category string  `json:"category"`
	Request  Request `json:"request"`
	Response *struct {
		Status  int               `json:"status"`
		Headers map[string]string `json:"headers"`
		Body    string            `json:"body"`
	} `json:"response"`
}

func moduleRoot(t *testing.T) string {
	t.Helper()
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate foundation test source")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(source), "..", ".."))
}

func readFoundationFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

func decodeFoundationJSON(t *testing.T, path string, destination any) {
	t.Helper()
	data := readFoundationFile(t, path)
	if err := json.Unmarshal([]byte(data), destination); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}

func requireDirective(t *testing.T, goMod, name, want string) {
	t.Helper()
	count := 0
	for _, line := range strings.Split(goMod, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == name {
			count++
			if fields[1] != want {
				t.Fatalf("%s directive = %q, want %q", name, fields[1], want)
			}
		}
	}
	if count != 1 {
		t.Fatalf("%s directive count = %d, want 1", name, count)
	}
}

func requireModuleVersion(t *testing.T, goMod, module, want string) {
	t.Helper()
	count := 0
	for _, line := range strings.Split(goMod, "\n") {
		fields := strings.Fields(line)
		for index := 0; index+1 < len(fields); index++ {
			if fields[index] == module {
				count++
				if fields[index+1] != want {
					t.Fatalf("module %s version = %q, want %q", module, fields[index+1], want)
				}
			}
		}
	}
	if count != 1 {
		t.Fatalf("module %s requirement count = %d, want 1", module, count)
	}
}

func tomlToolValue(contents, name string) string {
	inTools := false
	for _, line := range strings.Split(contents, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") {
			inTools = trimmed == "[tools]"
			continue
		}
		if !inTools {
			continue
		}
		parts := strings.SplitN(trimmed, "=", 2)
		if len(parts) == 2 && strings.TrimSpace(parts[0]) == name {
			value, err := strconv.Unquote(strings.TrimSpace(parts[1]))
			if err == nil {
				return value
			}
		}
	}
	return ""
}

func runFoundationCommand(t *testing.T, directory, name string, arguments ...string) {
	t.Helper()
	command := exec.Command(name, arguments...)
	command.Dir = directory
	command.Env = append(os.Environ(), "GOTOOLCHAIN=local")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("%s %s failed: %v\n%s", name, strings.Join(arguments, " "), err, output)
	}
	if len(bytes.TrimSpace(output)) != 0 && arguments[len(arguments)-1] == "-diff" {
		t.Fatalf("%s %s reported module drift:\n%s", name, strings.Join(arguments, " "), output)
	}
}

func integerConstant(t *testing.T, root, name string) int {
	t.Helper()
	path := filepath.Join(root, "internal", "parser", "limits.go")
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, path, nil, 0)
	if err != nil {
		t.Fatalf("parse limits.go: %v", err)
	}
	for _, declaration := range file.Decls {
		general, ok := declaration.(*ast.GenDecl)
		if !ok || general.Tok != token.CONST {
			continue
		}
		for _, specification := range general.Specs {
			valueSpec := specification.(*ast.ValueSpec)
			for index, identifier := range valueSpec.Names {
				if identifier.Name != name || index >= len(valueSpec.Values) {
					continue
				}
				literal, ok := valueSpec.Values[index].(*ast.BasicLit)
				if !ok || literal.Kind != token.INT {
					t.Fatalf("limit %s is not a direct integer constant", name)
				}
				value, conversionErr := strconv.Atoi(literal.Value)
				if conversionErr != nil {
					t.Fatalf("parse limit %s: %v", name, conversionErr)
				}
				return value
			}
		}
	}
	t.Fatalf("limit constant %s not found", name)
	return 0
}

func requireEvidencePath(t *testing.T, root, evidencePath string) {
	t.Helper()
	repositoryRoot := filepath.Clean(filepath.Join(root, "..", ".."))
	absolute := filepath.Join(repositoryRoot, filepath.FromSlash(evidencePath))
	if _, err := os.Stat(absolute); err == nil {
		return
	}
	matches, err := filepath.Glob(absolute)
	if err != nil || len(matches) == 0 {
		t.Fatalf("measurement source %q is not present in the repository", evidencePath)
	}
}

func equalStringMap(left, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	keys := make([]string, 0, len(left))
	for key := range left {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if left[key] != right[key] {
			return false
		}
	}
	return true
}
