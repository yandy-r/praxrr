#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT
readonly PARSER_DIR="${REPO_ROOT}/packages/praxrr-parser"

fail() {
	printf 'check-parser-retirement: %s\n' "$1" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_command deno
require_command find
require_command rg

[[ -f "${PARSER_DIR}/go.mod" ]] || fail "Go parser module is missing"
[[ -f "${PARSER_DIR}/testdata/golden/manifest.json" ]] || fail "golden manifest is missing"

legacy_files="$({
	find "${PARSER_DIR}" -type f \( \
		-name '*.cs' -o \
		-name '*.csproj' -o \
		-name 'Directory.Build.props' -o \
		-name 'appsettings.json' \
	\) -print
} | sort)"
[[ -z "${legacy_files}" ]] || fail "legacy parser source/build files remain:\n${legacy_files}"

# These are the executable build, launch, container, and CI surfaces. Historical
# oracle provenance is intentionally retained only in the golden corpus,
# capture/measurement tooling, parity validation, and release rollback metadata.
active_inputs=(
	"${REPO_ROOT}/.github/workflows/compatibility.yml"
	"${REPO_ROOT}/.github/workflows/docker.yml"
	"${REPO_ROOT}/Dockerfile"
	"${REPO_ROOT}/Dockerfile.parser"
	"${REPO_ROOT}/compose.yml"
	"${REPO_ROOT}/compose.dev.yml"
	"${REPO_ROOT}/deno.json"
	"${REPO_ROOT}/mise.toml"
	"${REPO_ROOT}/scripts/check-parser-go.sh"
	"${REPO_ROOT}/scripts/dev.ts"
)

for input in "${active_inputs[@]}"; do
	[[ -e "${input}" ]] || continue
	if rg -n -i '(setup-dotnet|(^|[^[:alnum:]_.-])dotnet([^[:alnum:]_.-]|$)|DOTNET_|ASPNETCORE_|RuntimeIdentifiers?|dotnet_rid|Parser\.csproj|Directory\.Build\.props|Program\.cs|Endpoints/[^[:space:]]*\.cs|Models/[^[:space:]]*\.cs|Parsers/[^[:space:]]*\.cs|Logging/[^[:space:]]*\.cs)' "${input}"; then
		fail "active legacy parser input remains in ${input#"${REPO_ROOT}/"}"
	fi
done

if rg -n -i --glob '*.go' --glob '!internal/parity/**' --glob '!internal/parser/*_test.go' \
	'(DOTNET_|ASPNETCORE_|Parser\.csproj|Directory\.Build\.props|Program\.cs|Endpoints/[^[:space:]]*\.cs|Models/[^[:space:]]*\.cs|Parsers/[^[:space:]]*\.cs|Logging/[^[:space:]]*\.cs)' \
	"${PARSER_DIR}"; then
	fail 'active Go parser source retains a legacy runtime or deleted-source reference'
fi

deno run --allow-read "${REPO_ROOT}/scripts/capture-parser-goldens.ts" --validate

fixture_count="$(deno eval \
	'const m=JSON.parse(await Deno.readTextFile(Deno.args[0])); await Deno.stdout.write(new TextEncoder().encode(String(m.fixtures.length)))' \
	"${PARSER_DIR}/testdata/golden/manifest.json")"
[[ "${fixture_count}" == '114' ]] || fail "golden fixture count is ${fixture_count}; expected 114"

printf 'Parser retirement boundary passed: no active C#/.NET inputs; %s immutable fixtures validated.\n' \
	"${fixture_count}"
