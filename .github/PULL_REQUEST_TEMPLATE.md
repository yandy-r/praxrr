## Summary

<!-- What does this PR do and why? (1-3 sentences) -->

## Related Issues

<!-- Link issues this PR addresses. Use closing keywords where appropriate. -->

- Closes #
- Relates to #

## Changes

<!-- Bulleted list of what changed. -->

-

## Type of Change

- Bug fix (`fix:`)
- New feature (`feat:`)
- Refactor (`refactor:`)
- Documentation (`docs:`)
- Chore / tooling (`chore:`)
- Breaking change

## Labels

<!-- Check the labels that apply. Reviewer should apply them to the PR. -->

**Area:**

- `area:api`
- `area:arr`
- `area:sync`
- `area:ui`
- `area:auth`

**Priority:**

- `priority:critical`
- `priority:high`
- `priority:medium`
- `priority:low`

## How to Test

<!-- Steps for reviewers to verify the changes. -->

1.
2.
3.

## Checklist

- Code follows project conventions
- Self-reviewed
- Tests added/updated (or not applicable)
- No new warnings introduced
- Correct labels applied

### Arr-Touching Changes

<!-- Remove this section if the PR does not touch Arr integration code. -->

- API semantics verified per Arr app involved
- Schema/field mappings validated per Arr app involved
- Read/write/sync dispatch resolves by explicit `arr_type` (no implicit sibling fallback)
- Migration/import/export mappings defined per Arr app and fail-fast on ambiguity
