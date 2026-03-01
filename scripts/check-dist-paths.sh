#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UP_ONE="$(realpath "$REPO_ROOT/..")"
PARENT_DIST="$UP_ONE/dist"

if [ -d "$PARENT_DIST" ]; then
  echo "FAIL: Unexpected dist directory outside repo: $PARENT_DIST"
  exit 1
fi

assert_pattern() {
  local pattern="$1"
  local file="$2"
  local message="$3"

  if ! rg -q --no-messages "$pattern" "$file"; then
    echo "FAIL: ${message}"
    echo "       File: ${file}"
    echo "       Pattern: ${pattern}"
    exit 1
  fi
}

check_patterns() {
  local file="$1"
  if rg -n --no-messages -e '\.\./\.\./dist' -e "APP_BASE_PATH: '\\./dist" -e "APP_BASE_PATH=\\./dist" -e "out: '\\./dist" -e "outDir: '\\./dist" "$file" >/tmp/check-dist-patterns.txt; then
    echo "FAIL: Legacy path pattern detected in $file"
    cat /tmp/check-dist-patterns.txt
    rm -f /tmp/check-dist-patterns.txt
    exit 1
  fi
  rm -f /tmp/check-dist-patterns.txt
}

check_patterns deno.json
check_patterns packages/praxrr-app/svelte.config.js
check_patterns .github/workflows/release.yml

# Ensure runtime paths are always rooted at repo root.
assert_pattern 'APP_BASE_PATH=\"\\$REPO_ROOT/dist/dev\"|APP_BASE_PATH=\\$PWD/dist/dev|APP_BASE_PATH=\\$\\{REPO_ROOT\\}/dist/dev' deno.json 'DEV APP_BASE_PATH must resolve from repo root (e.g. $REPO_ROOT/dist/dev)'
assert_pattern 'APP_BASE_PATH=\\$PWD/dist/test|APP_BASE_PATH=\"\\$REPO_ROOT/dist/test\"|APP_BASE_PATH=\\$\\{REPO_ROOT\\}/dist/test' deno.json 'TEST APP_BASE_PATH must resolve from repo root (e.g. $REPO_ROOT/dist/test)'
assert_pattern 'const APP_BASE_PATH = `\\${Deno\\.cwd\\(\\)}/dist/dev`' scripts/dev.ts 'Dev launcher must use repo-rooted dist/dev path'
assert_pattern 'APP_BASE_PATH: `\\${repoRoot}/dist/test`' scripts/test.ts 'Test launcher must use repo-rooted dist/test path'
assert_pattern 'path\\.resolve\\(Deno\\.cwd\\(\\), Deno\\.env\\.get\\(\\x27DB_PATH\\x27\\) \\|\\| \\x27dist\\/dev\\/data\\/praxrr\\.db\\x27\\)' scripts/e2e-reset.ts 'e2e-reset DB path must be repo-rooted'
assert_pattern 'path\\.resolve\\(process\\.cwd\\(\\), process\\.env\\.DB_PATH \\|\\| \\x27dist\\/dev\\/data\\/praxrr\\.db\\x27\\)' packages/praxrr-app/src/tests/e2e/env.ts 'e2e env DB path must be repo-rooted'

echo "PASS: dist path configuration remains repo-local"
