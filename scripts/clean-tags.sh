#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/clean-tags.sh [--dry-run]

Remove all local tags, delete matching tags from origin, and remove all tags from configured mirror repos.

Options:
  --dry-run   Show actions without making changes
EOF
}

DRY_RUN=false
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  shift
fi

if [[ "${1:-}" != "" ]]; then
  usage
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required for mirror repository tag cleanup." >&2
  exit 1
fi

MIRROR_REPOS=(praxrr-db praxrr-schema)

run() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[DRY-RUN] $*"
    return
  fi
  "$@"
}

echo "Collecting local tags..."
mapfile -t TAGS < <(git tag)

if (( ${#TAGS[@]} == 0 )); then
  echo "No local tags found."
else
  for tag in "${TAGS[@]}"; do
    run git tag -d "$tag"
    run git push origin --delete "$tag"
  done
fi

for repo in "${MIRROR_REPOS[@]}"; do
  echo "Cleaning tags in mirror repo: ${repo}"
  mapfile -t MIRROR_TAGS < <(gh api repos/yandy-r/"$repo"/tags --paginate --jq '.[].name')
  for tag in "${MIRROR_TAGS[@]}"; do
    if [[ "${DRY_RUN}" == "true" ]]; then
      run gh api --method DELETE repos/yandy-r/"$repo"/git/refs/tags/"$tag"
    else
      gh api --method DELETE repos/yandy-r/"$repo"/git/refs/tags/"$tag" >/dev/null
    fi
  done
done

run git pack-refs --all --prune
echo "Tag cleanup complete."
