## Issue Creation Template - Multiple

Go through the @docs/plans/score-simulator plan and lets create github issues to track the feature
implementation.

- group tasks together that logically fit (no need for an issue per task)
- Make sure the issues are properly labeled
- Labels must include feat:{feature-name} additive of the other labels
- make sure the issues are properly prioritized
- make them detailed and include which tasks they cover in title and/or body.
- the task must include the numbers, such as 1.1, 1.2, 2.1 - 2.4, etc.
- this will be read by AI agents so make it consumable and actionable for them to execute
- no relative http(s) links, as those break inside the issue pointing to /issue/{#}/{link}
- only relative directory links to files
  - such as
    [@docs/plans/{feature-name}/parallel-plan.md](file://docs/plans/{feature-name}/parallel-plan.md)

## Issue Creation Template - Single

Go through the @docs/plans/progressive-disclosure plan and lets create a github issue to track the
feature implementation.

- Make sure the issue is properly labeled
- Labels must include feat:{feature-name} additive of any other labels
- make sure the issue is properly prioritized
- make it detailed and include tasks details the body
- the task must include the numbers, such as 1.1, 1.2, 2.1 - 2.4, etc.
- this will be read by AI agents so make it consumable and actionable for them to execute
- no relative http(s) links, as those break inside the issue pointing to /issue/{#}/{link}
- only relative directory links to files
  - such as
    [@docs/plans/{feature-name}/parallel-plan.md](file://docs/plans/{feature-name}/parallel-plan.md)

## PR Review Correction

Let's validate and fix suggestion issues 8-18

- file: [@pr-170-review.md](file://docs/pr-reviews/pr-170-review.md)
- validate before implementing
- run targeted tests
- update doc when complete ([@pr-170-review.md](file://docs/pr-reviews/pr-170-review.md))
- when confirmed fix, commit progress
