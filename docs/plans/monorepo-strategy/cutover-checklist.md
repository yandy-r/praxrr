# Monorepo Cutover Checklist (Maintainers)

Run this once all monorepo migration implementation tasks are complete and before promoting mirror tags.

## Preflight

- [ ] Merge branch is on current default branch, clean, and rebased to upstream.
- [ ] Compatibility command path is green before any mirror operations.
- [ ] Compatibility and release workflows are inspectable and expected jobs exist.

**Verification commands**

- `git status --short`
- `git fetch --all --tags --prune`
- `deno task compat:check`
- `gh workflow view Compatibility\ Gates --json name,path`
- `gh workflow view Release --json name,path`

## Mirror Freeze

- [ ] Prevent direct writes to `yandy-r/praxrr-db/main` and `yandy-r/praxrr-schema/main`.
- [ ] Require PR-based changes only and attach `required_status_checks` for mirror workflows.
- [ ] Confirm mirror branches are protected for deletes and force pushes.

**Verification commands**

- `gh api repos/yandy-r/praxrr-db/branches/main/protection | jq -r '.required_pull_request_reviews.required_approving_review_count'`
- `gh api repos/yandy-r/praxrr-schema/branches/main/protection | jq -r '.required_pull_request_reviews.required_approving_review_count'`
- `gh api repos/yandy-r/praxrr-db/branches/main/protection | jq -r '.required_status_checks.strict, .required_status_checks.contexts[]'`
- `gh api repos/yandy-r/praxrr-schema/branches/main/protection | jq -r '.required_status_checks.strict, .required_status_checks.contexts[]'`

## Secrets

- [ ] `MIRROR_PAT` exists on the monorepo with access to both mirror repositories.
- [ ] Mirror token is restricted to repo write scopes and excludes user-level broad permissions.
- [ ] `MIRROR_PAT` has branch/push scope for `yandy-r/praxrr-db` and `yandy-r/praxrr-schema`.

**Verification commands**

- `gh secret list --repo yandy-r/praxrr | rg MIRROR_PAT`
- `GITHUB_TOKEN=<redacted> gh api repos/yandy-r/praxrr-db -q .full_name`
- `GITHUB_TOKEN=<redacted> gh api repos/yandy-r/praxrr-schema -q .full_name`

## Rollout

- [ ] Run dry-run publish for both mirrors before any tagged publish.
- [ ] Confirm dry-run branches are created and cleaned automatically after retention window.
- [ ] Run release validation after freeze: compatibility gate and app release both green on release tag.
- [ ] Verify release outputs are generated from the monorepo default branch artifacts.

**Pre-cutover verification (gated by compatibility/release)**

- `deno task compat:check`
- `gh workflow run publish-db.yml --ref main -f dry_run=true`
- `gh workflow run publish-schema.yml --ref main -f dry_run=true`
- `gh run list --workflow publish-db.yml --limit 5 --json conclusion,status,headBranch`
- `gh run list --workflow publish-schema.yml --limit 5 --json conclusion,status,headBranch`

**Post-cutover verification**

- `gh run list --workflow Compatibility\ Gates --limit 10 --json status,conclusion,headSha,headBranch`
- `gh run list --workflow Release --limit 10 --json status,conclusion,headSha,headBranch`
- `gh run view --json name,status,conclusion,databaseId $(gh run list --workflow Release --json databaseId --jq '.[0].databaseId')`
- `gh run list --workflow Release --json status,conclusion,headSha | jq -r '.[] | select(.conclusion=="failure" or .status=="in_progress") | .databaseId + " " + .conclusion + " " + .status'`

## Rollback

- [ ] Enable emergency freeze by pausing mirror publish workflows if compatibility or release signals fail.
- [ ] For bad mirror publish, re-run mirror workflows from last good DB/Schema tag and re-tag if required.
- [ ] For bad release, avoid app propagation and unpin problematic dependency versions until compatibility returns green.

**Rollback triggers**

- `Compatibility Gates` failure on schema/db/path updates.
- `compatibility-gate` skipped or failed in any Release workflow run.
- Release run success without expected compatibility context in artifacts.

**Rollback commands**

- `gh workflow disable publish-db.yml`
- `gh workflow disable publish-schema.yml`
- `git tag -f <last_good_db_tag> <last_good_commit> && git push origin <last_good_db_tag> --force-with-lease`
- `git tag -f <last_good_schema_tag> <last_good_commit> && git push origin <last_good_schema_tag> --force-with-lease`
- `gh run list --workflow Release --status failure --limit 10 --json databaseId,conclusion,headSha | jq -r '.[0].databaseId'`

## Ownership

- [ ] Monorepo merge + cutover coordination: maintainers with admin on `yandy-r/praxrr`.
- [ ] Workflow/CI ownership: owners responsible for `release.yml`, `compatibility.yml`, `publish-db.yml`, `publish-schema.yml`.
- [ ] Secret/permission ownership: repository admins for repository secrets and mirror PAT rotation.
- [ ] Incident ownership: designate one on-call approver for freeze/rollback decisions.

**Verification command**

- `gh api repos/yandy-r/praxrr/collaborators --paginate --json login,permissions --jq '[.[] | select(.permissions.admin or .permissions.maintain or .permissions.push) | .login] | sort | unique'`
