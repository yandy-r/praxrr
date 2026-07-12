// Package main is a minimal, observe-only example plugin for Praxrr's WASM
// plugin system. It targets the `sync.previewComputed.observe` extension point
// and is compiled to WebAssembly with the Extism Go PDK
// (https://github.com/extism/go-pdk) via TinyGo.
//
// -----------------------------------------------------------------------------
// PROVISIONAL HOST<->GUEST ABI — READ BEFORE COPYING.
//
// Praxrr does NOT invoke this function yet. In Phase-1 the plugin host has no
// WebAssembly runtime: the default executor rejects every dispatch with
// "wasm runtime not yet available", so a valid plugin is discovered, validated,
// and registered but NEVER executed. The Phase-2 runtime is a documented NO-GO
// for the evaluated Extism JavaScript SDK on Deno (issue #262) and stays
// deferred until a compliant backend lands.
//
// The exported function name below (`observe_sync_preview`) and the exact
// argument/return byte-encoding are therefore FORWARD-LOOKING and are NOT a
// stable Praxrr contract. They will be finalized when the runtime lands; treat
// this signature as illustrative only.
//
// What IS stable today: the `praxrr.plugin.json` manifest contract, and the
// JSON *shape* an observer would eventually receive for this point — the
// four-field projection {arrType, instanceId, summary, sections} decoded below.
// See https://docs.praxrr.dev/plugins/observe-snapshot/.
// -----------------------------------------------------------------------------
package main

import (
	"encoding/json"

	"github.com/extism/go-pdk"
)

// syncPreviewSnapshot mirrors the least-privilege projection Praxrr would pass
// to a `read:sync-preview` observer. Only these four top-level fields are
// present; every other field of the internal preview result is dropped at the
// host boundary. `summary` and `sections` are kept as raw JSON because an
// observer only needs to read them, not reconstruct Praxrr's internal types.
type syncPreviewSnapshot struct {
	ArrType    string          `json:"arrType"`
	InstanceID int64           `json:"instanceId"`
	Summary    json.RawMessage `json:"summary"`
	Sections   json.RawMessage `json:"sections"`
}

// observe_sync_preview is the illustrative guest entry point (see the
// PROVISIONAL ABI note above). It reads the JSON snapshot Extism hands the guest
// via the PDK, decodes the stable four-field shape, and — because observe points
// are read-only and fire-and-forget — returns a small acknowledgement that the
// host would discard. It performs no host I/O and mutates nothing.
//
//go:export observe_sync_preview
func observe_sync_preview() int32 {
	var snapshot syncPreviewSnapshot
	if err := pdk.InputJSON(&snapshot); err != nil {
		pdk.SetError(err)
		return 1
	}

	// A real observer might record a metric, append to an audit log, or emit a
	// notification here. This example just echoes a tiny acknowledgement.
	if err := pdk.OutputJSON(map[string]any{
		"observed":   "sync.previewComputed.observe",
		"arrType":    snapshot.ArrType,
		"instanceId": snapshot.InstanceID,
	}); err != nil {
		pdk.SetError(err)
		return 1
	}
	return 0
}

func main() {}
