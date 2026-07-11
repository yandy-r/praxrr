package parity

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const (
	wantStaticRegexTimeoutMillis = 250
	wantRegexStackLimit          = 100000
)

func TestStaticSafetyRegexBoundaryAndStartupCompilation(t *testing.T) {
	root := moduleRoot(t)
	parserRoot := filepath.Join(root, "internal", "parser")
	regexp2Imports := []string{}
	staticConstructors := 0

	err := filepath.WalkDir(parserRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") {
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
		relative = filepath.ToSlash(relative)

		for _, imported := range file.Imports {
			importPath, unquoteErr := strconv.Unquote(imported.Path.Value)
			if unquoteErr != nil {
				return fmt.Errorf("unquote import in %s: %w", relative, unquoteErr)
			}
			switch importPath {
			case "github.com/dlclark/regexp2/v2":
				regexp2Imports = append(regexp2Imports, relative)
			case "regexp", "regexp/syntax":
				return fmt.Errorf("%s imports forbidden standard regex package %q", relative, importPath)
			}
		}

		if strings.HasSuffix(relative, "_test.go") {
			return nil
		}
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			identifier, ok := call.Fun.(*ast.Ident)
			if ok && identifier.Name == "mustCompileStaticRegex" {
				staticConstructors++
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("inspect static regex boundary: %v", err)
	}

	if got, want := regexp2Imports, []string{"internal/parser/regex.go"}; !equalStrings(got, want) {
		t.Fatalf("regexp2 imports = %v, want sole boundary %v", got, want)
	}
	if staticConstructors < 80 {
		t.Fatalf("static regex constructors = %d, want complete parser set (at least 80)", staticConstructors)
	}
	// Importing internal/parser in domain_test.go initializes every package-level
	// expression through mustCompileStaticRegex. Reaching this assertion proves
	// the complete static set compiled without a startup panic.
}

func TestStaticSafetyBudgetsAreFiniteAndMeasuredCorpusFits(t *testing.T) {
	root := moduleRoot(t)
	regexSource := readFoundationFile(t, filepath.Join(root, "internal", "parser", "regex.go"))
	if !strings.Contains(regexSource,
		fmt.Sprintf("staticRegexTimeout  = %d * time.Millisecond", wantStaticRegexTimeoutMillis)) {
		t.Fatalf("static regex timeout is not the reviewed finite %dms budget", wantStaticRegexTimeoutMillis)
	}
	if !strings.Contains(regexSource, fmt.Sprintf("regexStackLimit     = %d", wantRegexStackLimit)) {
		t.Fatalf("regex stack limit is not the reviewed finite %d-slot budget", wantRegexStackLimit)
	}

	maxTitleCharacters := integerConstant(t, root, "maxTextCharacters")
	corpus := mustLoadGolden(t)
	checked := 0
	for _, record := range corpus.Records {
		if record.Category != "domain" && record.Category != "date" && record.Category != "unicode" {
			continue
		}
		var request contractTitle
		if err := json.Unmarshal([]byte(record.Request.Body), &request); err != nil {
			t.Fatalf("%s: decode request: %v", record.ID, err)
		}
		if length := len([]rune(request.Title)); length > maxTitleCharacters {
			t.Fatalf("%s title length = %d, exceeds measured static budget %d",
				record.ID, length, maxTitleCharacters)
		}
		checked++
	}
	if checked != wantDomainRecords {
		t.Fatalf("budget-checked domain records = %d, want %d", checked, wantDomainRecords)
	}
}

type contractTitle struct {
	Title string `json:"title"`
}
