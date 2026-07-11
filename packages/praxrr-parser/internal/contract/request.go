// Package contract defines the parser service's JSON wire contract.
package contract

// ParseRequest is the request body accepted by POST /parse.
//
// Type is a pointer because the legacy contract accepts JSON null (and a
// missing property) at the binding boundary before endpoint validation rejects
// it.
type ParseRequest struct {
	Title string     `json:"title"`
	Type  *MediaType `json:"type"`
}

// MatchRequest is the request body accepted by POST /match.
// A nil Patterns slice represents JSON null; a non-nil empty slice represents
// JSON []. The endpoint rejects both, but their transport distinction is part
// of the captured oracle contract.
type MatchRequest struct {
	Text     string   `json:"text"`
	Patterns []string `json:"patterns"`
}

// BatchMatchRequest is the request body accepted by POST /match/batch.
// Nil and empty slices intentionally remain distinguishable during JSON
// decoding and encoding.
type BatchMatchRequest struct {
	Texts    []string `json:"texts"`
	Patterns []string `json:"patterns"`
}
