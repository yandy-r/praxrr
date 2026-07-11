#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT
readonly PARSER_DIR="${REPO_ROOT}/packages/praxrr-parser"
readonly EXPECTED_GO_VERSION="go1.26.5"

section() {
	printf '\n==> %s\n' "$1"
}

fail() {
	printf 'check-parser-go: %s\n' "$1" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_command go
require_command deno

[[ -f "${PARSER_DIR}/go.mod" ]] || fail "Go parser module not found at ${PARSER_DIR}"

export GOTOOLCHAIN=local

section "Pinned Go toolchain"
actual_go_version="$(go env GOVERSION)"
[[ "${actual_go_version}" == "${EXPECTED_GO_VERSION}" ]] ||
	fail "Go toolchain is ${actual_go_version}; expected ${EXPECTED_GO_VERSION}"
printf 'Using %s\n' "${actual_go_version}"

section "Immutable oracle corpus"
unset PRAXRR_LEGACY_PARSER_URL
deno run --allow-read "${REPO_ROOT}/scripts/capture-parser-goldens.ts" --validate
printf 'Validated captured oracle corpus; live differential execution is retired.\n'

cd "${PARSER_DIR}"

section "Go format"
unformatted="$(gofmt -l .)"
[[ -z "${unformatted}" ]] || fail "gofmt is required for:\n${unformatted}"

section "Module integrity"
go mod tidy -diff
go mod verify

section "Static analysis and regex boundary"
go vet ./...

regexp2_imports="$(grep -R -l --include='*.go' '"github.com/dlclark/regexp2/v2"' internal/parser | sort || true)"
[[ "${regexp2_imports}" == 'internal/parser/regex.go' ]] ||
	fail "regexp2 must be imported only by internal/parser/regex.go"

if grep -R -n --include='*.go' '"regexp"' internal/parser; then
	fail "the parser must not import Go's standard regexp package"
fi

if grep -R -n --include='*_test.go' -E '(^|[^[:alnum:]_])t\.Skip(f|Now)?\(' .; then
	fail "parser tests must not skip required gates"
fi

section "Unit and immutable golden replay tests"
go test -count=1 -timeout=10m ./...

section "Race detector"
go test -race -count=1 -timeout=15m ./...

section "Adversarial cases and fuzz seed corpus"
go test -count=1 -timeout=5m ./internal/parity \
	-run '^(TestAdversarial|FuzzHandlerSeeds)'

section "Static cross-builds"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/praxrr-parser-cross.XXXXXX")"
trap 'rm -rf -- "${build_dir}"' EXIT
for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do
	goos="${target%/*}"
	goarch="${target#*/}"
	suffix=''
	[[ "${goos}" == 'windows' ]] && suffix='.exe'
	printf 'Building %s/%s\n' "${goos}" "${goarch}"
	CGO_ENABLED=0 GOOS="${goos}" GOARCH="${goarch}" \
		go build -trimpath -o "${build_dir}/praxrr-parser-${goos}-${goarch}${suffix}" \
		./cmd/praxrr-parser
done

cd "${REPO_ROOT}"

section "Deno parser consumers"
deno test -A packages/praxrr-app/src/tests/server/parserCacheCutover.test.ts
deno test -A packages/praxrr-app/src/tests/server/utils/config/parserUrl.test.ts
deno test -A packages/praxrr-app/src/tests/routes/entityTestingEvaluateRoute.test.ts
deno test -A packages/praxrr-app/src/tests/routes/simulateScoreRoute.test.ts
deno test -A packages/praxrr-app/src/tests/routes/impactSimulatorRoute.test.ts

section "Parser Go compatibility gates passed"
