# Legacy parser golden capture

This directory documents the one-way capture boundary for the temporary C#
oracle. The capture tool sends only the requests declared in
`testdata/golden/manifest.json` to an explicitly supplied legacy listener. It
does not start a parser, call a Go implementation, infer expected values, or
invent responses when the oracle is unavailable.

## Pin the oracle

Before adding the first fixture, replace the manifest's `oracle: null` with all
of the following values observed from the listener's actual build and runtime:

- `sourceCommit`: the full commit containing the C# source used to build the
  listener
- `dotnetRuntime`: exact .NET runtime patch version
- `container`: immutable image name and digest, or `none (host process)`
- `os`: distribution/version and architecture
- `culture`: effective .NET current/default culture
- `globalizationMode`: invariant/ICU mode and ICU version when applicable
- `timeZone`: effective time-zone identifier
- `configuration`: parser configuration, including parser version and relevant
  environment values
- `invocation`: the exact container or process command used to start the
  listener

Do not copy guessed values into these fields. Keep the pinned service private
and bind it to a dedicated address/port so `--base-url` cannot accidentally
select a Go development server.

## Add and capture cases

Add fixture request definitions to the manifest with a unique `id`, a stable
`category`, notes, the raw method/path/headers/body, and `response: null`. Paths
must be origin-relative. Request header names must be lowercase. Then capture
against the pinned listener:

```bash
deno run --allow-net --allow-read --allow-write scripts/capture-parser-goldens.ts \
  --base-url http://127.0.0.1:5000
```

Use `--categories parse,match` to update only named categories. The tool records
status, selected stable response headers, the exact response body, and a decoded
JSON value when the body is JSON. Redirects are not followed.
Transport-generated headers listed in `excludedResponseHeaders` are documented
exclusions and are never evidence.

Output is canonical JSON: object keys, configured header lists, and fixtures are
sorted, and the file has one trailing newline. No capture timestamp is stored
because it would make identical oracle runs differ.

## Validate and prove recapture

Schema and canonical formatting validation is offline:

```bash
deno run --allow-read scripts/capture-parser-goldens.ts --validate
```

After committing a capture, repeat it without writing and compare every selected
record byte-for-byte after canonicalization:

```bash
deno run --allow-net --allow-read scripts/capture-parser-goldens.ts \
  --base-url http://127.0.0.1:5000 --verify-recapture
```

A mismatch or unavailable oracle is a hard failure. Investigate environment
drift or nondeterminism; never repair a golden by deriving the answer from Go.
