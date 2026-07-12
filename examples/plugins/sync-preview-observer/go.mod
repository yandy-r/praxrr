// Standalone Go module for the example plugin. It is intentionally NOT part of
// any go.work workspace so the repository's Go tooling (the praxrr-parser
// microservice) never builds it and its dependency never affects that
// toolchain. Build it with TinyGo — see README.md.
module github.com/yandy-r/praxrr/examples/plugins/sync-preview-observer

go 1.22

require github.com/extism/go-pdk v1.1.3
