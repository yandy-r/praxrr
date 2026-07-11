package parity

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
	parserdomain "github.com/yandy-r/praxrr/packages/praxrr-parser/internal/parser"
)

const wantDomainRecords = 59

func TestDomainGoldenCorpusHasZeroDifferences(t *testing.T) {
	corpus := mustLoadGolden(t)
	now := time.Date(2026, time.July, 11, 18, 0, 0, 0, time.UTC)
	seen := 0

	for _, record := range corpus.Records {
		if record.Category != "domain" && record.Category != "date" && record.Category != "unicode" {
			continue
		}
		seen++
		record := record
		t.Run(record.ID, func(t *testing.T) {
			if record.Response.Status != 200 || !record.Response.HasDecodedBody {
				t.Fatalf("domain fixture status/decoded body = %d/%v; want 200/true",
					record.Response.Status, record.Response.HasDecodedBody)
			}

			var request contract.ParseRequest
			if err := json.Unmarshal([]byte(record.Request.Body), &request); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if request.Type == nil {
				t.Fatal("domain fixture has no media type")
			}

			var expected contract.ParseResponse
			if err := json.Unmarshal(record.Response.DecodedBody, &expected); err != nil {
				t.Fatalf("decode expected response: %v", err)
			}
			actual := parserdomain.DomainSnapshotForParity(request.Title, *request.Type, now)
			if !reflect.DeepEqual(actual, expected) {
				actualJSON, _ := json.Marshal(actual)
				expectedJSON, _ := json.Marshal(expected)
				t.Fatalf("domain result differs\nactual:   %s\nexpected: %s", actualJSON, expectedJSON)
			}

			body, err := json.Marshal(actual)
			if err != nil {
				t.Fatalf("marshal actual response: %v", err)
			}
			if err := corpus.Compare(record.Response, Response{
				Status:  200,
				Headers: map[string]string{"content-type": "application/json; charset=utf-8"},
				Body:    string(body),
			}); err != nil {
				t.Fatalf("golden comparison: %v", err)
			}
		})
	}

	if seen != wantDomainRecords {
		t.Fatalf("replayed domain records = %d, want %d", seen, wantDomainRecords)
	}
}
