// Package httpserver adapts the parser service to its private HTTP contract.
package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
	parserdomain "github.com/yandy-r/praxrr/packages/praxrr-parser/internal/parser"
)

const (
	contentTypeJSON = "application/json; charset=utf-8"
	retryAfterBusy  = "1"
)

type parseService interface {
	Parse(string, contract.MediaType) contract.ParseResponse
}

type matchService interface {
	MatchPatterns(string, []string) (contract.MatchResponse, error)
	MatchPatternsBatch([]string, []string) (contract.BatchMatchResponse, error)
}

// Logger is the narrow structured-logging surface used by handlers. A
// *slog.Logger satisfies it directly.
type Logger interface {
	Log(context.Context, slog.Level, string, ...any)
}

// Handler serves the four legacy parser routes without owning listener or
// process lifecycle policy.
type Handler struct {
	version string
	parser  parseService
	matcher matchService
	logger  Logger
}

// NewHandler constructs a handler with process-wide parser and matcher
// services. Passing a nil logger disables request logging.
func NewHandler(version string, logger Logger) *Handler {
	return newHandler(version, parserdomain.NewService(), parserdomain.NewMatcher(), logger)
}

// NewHandlerWithClock constructs the production wire handler with an explicit
// parser clock. Differential gates use it to replay time-bound oracle records
// deterministically; normal listeners should use NewHandler.
func NewHandlerWithClock(version string, now func() time.Time, logger Logger) *Handler {
	return newHandler(version, parserdomain.NewServiceWithClock(now), parserdomain.NewMatcher(), logger)
}

func newHandler(version string, parser parseService, matcher matchService, logger Logger) *Handler {
	return &Handler{
		version: version,
		parser:  parser,
		matcher: matcher,
		logger:  logger,
	}
}

func (handler *Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	started := time.Now()
	outcome := handler.serveHTTP(writer, request)
	if handler.logger == nil {
		return
	}

	handler.logger.Log(
		request.Context(),
		slog.LevelInfo,
		"parser request",
		slog.String("route", outcome.route),
		slog.Int("status", outcome.status),
		slog.String("outcome", outcome.kind),
		slog.Int64("duration_ms", time.Since(started).Milliseconds()),
		slog.Int("text_count", outcome.textCount),
		slog.Int("pattern_count", outcome.patternCount),
		slog.String("error_class", outcome.errorClass),
	)
}

type requestOutcome struct {
	route        string
	kind         string
	errorClass   string
	status       int
	textCount    int
	patternCount int
}

func success(route string, status int) requestOutcome {
	return requestOutcome{route: route, kind: "success", status: status}
}

func rejected(route string, status int, class string) requestOutcome {
	return requestOutcome{route: route, kind: "rejected", errorClass: class, status: status}
}

func (handler *Handler) serveHTTP(writer http.ResponseWriter, request *http.Request) requestOutcome {
	switch request.URL.Path {
	case "/health":
		return handler.handleHealth(writer, request)
	case "/parse":
		return handler.handleParse(writer, request)
	case "/match":
		return handler.handleMatch(writer, request)
	case "/match/batch":
		return handler.handleBatchMatch(writer, request)
	default:
		writeEmpty(writer, http.StatusNotFound)
		return rejected("unknown", http.StatusNotFound, "unknown_route")
	}
}

func (handler *Handler) handleHealth(writer http.ResponseWriter, request *http.Request) requestOutcome {
	const route = "/health"
	if request.Method != http.MethodGet {
		writeMethodNotAllowed(writer, http.MethodGet)
		return rejected(route, http.StatusMethodNotAllowed, "method_not_allowed")
	}

	writeJSON(writer, http.StatusOK, contract.HealthResponse{
		Status:  contract.HealthStatusHealthy,
		Version: handler.version,
	})
	return success(route, http.StatusOK)
}

func (handler *Handler) handleParse(writer http.ResponseWriter, request *http.Request) requestOutcome {
	const route = "/parse"
	if request.Method != http.MethodPost {
		writeMethodNotAllowed(writer, http.MethodPost)
		return rejected(route, http.StatusMethodNotAllowed, "method_not_allowed")
	}
	if !acceptsJSON(request.Header.Get("Content-Type")) {
		writeEmpty(writer, http.StatusUnsupportedMediaType)
		return rejected(route, http.StatusUnsupportedMediaType, "unsupported_media_type")
	}

	var payload contract.ParseRequest
	if status, class := decodeRequest(request.Body, &payload); status != 0 {
		writeEmpty(writer, status)
		return rejected(route, status, class)
	}
	outcome := success(route, http.StatusOK)
	outcome.textCount = 1

	if strings.TrimSpace(payload.Title) == "" {
		writeJSON(writer, http.StatusBadRequest, contract.ErrorResponse{Error: contract.ErrorTitleRequired})
		return rejectedWithCounts(outcome, http.StatusBadRequest, "title_required")
	}
	if payload.Type == nil || (*payload.Type != contract.MediaTypeMovie && *payload.Type != contract.MediaTypeSeries) {
		writeJSON(writer, http.StatusBadRequest, contract.ErrorResponse{Error: contract.ErrorTypeRequired})
		return rejectedWithCounts(outcome, http.StatusBadRequest, "type_required")
	}
	if err := parserdomain.ValidateParseTitle(payload.Title); err != nil {
		writeEmpty(writer, http.StatusRequestEntityTooLarge)
		return rejectedWithCounts(outcome, http.StatusRequestEntityTooLarge, "request_limit")
	}

	writeJSON(writer, http.StatusOK, handler.parser.Parse(payload.Title, *payload.Type))
	return outcome
}

func (handler *Handler) handleMatch(writer http.ResponseWriter, request *http.Request) requestOutcome {
	const route = "/match"
	if request.Method != http.MethodPost {
		writeMethodNotAllowed(writer, http.MethodPost)
		return rejected(route, http.StatusMethodNotAllowed, "method_not_allowed")
	}
	if !acceptsJSON(request.Header.Get("Content-Type")) {
		writeEmpty(writer, http.StatusUnsupportedMediaType)
		return rejected(route, http.StatusUnsupportedMediaType, "unsupported_media_type")
	}

	var payload contract.MatchRequest
	if status, class := decodeRequest(request.Body, &payload); status != 0 {
		writeEmpty(writer, status)
		return rejected(route, status, class)
	}
	outcome := success(route, http.StatusOK)
	outcome.textCount = 1
	outcome.patternCount = len(payload.Patterns)

	if strings.TrimSpace(payload.Text) == "" {
		writeJSON(writer, http.StatusBadRequest, contract.ErrorResponse{Error: contract.ErrorTextRequired})
		return rejectedWithCounts(outcome, http.StatusBadRequest, "text_required")
	}
	if len(payload.Patterns) == 0 {
		writeJSON(writer, http.StatusBadRequest, contract.ErrorResponse{Error: contract.ErrorPatternRequired})
		return rejectedWithCounts(outcome, http.StatusBadRequest, "patterns_required")
	}

	response, err := handler.matcher.MatchPatterns(payload.Text, payload.Patterns)
	if err != nil {
		return handler.writeMatcherError(writer, outcome, err)
	}
	writeJSON(writer, http.StatusOK, response)
	return outcome
}

func (handler *Handler) handleBatchMatch(writer http.ResponseWriter, request *http.Request) requestOutcome {
	const route = "/match/batch"
	if request.Method != http.MethodPost {
		writeMethodNotAllowed(writer, http.MethodPost)
		return rejected(route, http.StatusMethodNotAllowed, "method_not_allowed")
	}
	if !acceptsJSON(request.Header.Get("Content-Type")) {
		writeEmpty(writer, http.StatusUnsupportedMediaType)
		return rejected(route, http.StatusUnsupportedMediaType, "unsupported_media_type")
	}

	var payload contract.BatchMatchRequest
	if status, class := decodeRequest(request.Body, &payload); status != 0 {
		writeEmpty(writer, status)
		return rejected(route, status, class)
	}
	outcome := success(route, http.StatusOK)
	outcome.textCount = len(payload.Texts)
	outcome.patternCount = len(payload.Patterns)

	if len(payload.Texts) == 0 {
		writeJSON(writer, http.StatusBadRequest, contract.ErrorResponse{Error: contract.ErrorTextsRequired})
		return rejectedWithCounts(outcome, http.StatusBadRequest, "texts_required")
	}
	if len(payload.Patterns) == 0 {
		writeJSON(writer, http.StatusBadRequest, contract.ErrorResponse{Error: contract.ErrorPatternRequired})
		return rejectedWithCounts(outcome, http.StatusBadRequest, "patterns_required")
	}

	response, err := handler.matcher.MatchPatternsBatch(payload.Texts, payload.Patterns)
	if err != nil {
		return handler.writeMatcherError(writer, outcome, err)
	}
	writeJSON(writer, http.StatusOK, response)
	return outcome
}

func rejectedWithCounts(outcome requestOutcome, status int, class string) requestOutcome {
	outcome.kind = "rejected"
	outcome.status = status
	outcome.errorClass = class
	return outcome
}

func (handler *Handler) writeMatcherError(
	writer http.ResponseWriter,
	outcome requestOutcome,
	err error,
) requestOutcome {
	if errors.Is(err, parserdomain.ErrMatcherAtCapacity) {
		writer.Header().Set("Retry-After", retryAfterBusy)
		writeEmpty(writer, http.StatusServiceUnavailable)
		return rejectedWithCounts(outcome, http.StatusServiceUnavailable, "matcher_capacity")
	}
	if parserdomain.IsLimitError(err) {
		writeEmpty(writer, http.StatusRequestEntityTooLarge)
		return rejectedWithCounts(outcome, http.StatusRequestEntityTooLarge, "request_limit")
	}

	writeEmpty(writer, http.StatusInternalServerError)
	outcome.kind = "error"
	outcome.status = http.StatusInternalServerError
	outcome.errorClass = "internal"
	return outcome
}

func acceptsJSON(value string) bool {
	if value == "" {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(value)
	if err != nil {
		return false
	}
	mediaType = strings.ToLower(mediaType)
	return mediaType == "application/json" ||
		(strings.HasPrefix(mediaType, "application/") && strings.HasSuffix(mediaType, "+json"))
}

func decodeRequest(body io.Reader, target any) (int, string) {
	limit := parserdomain.RequestBodyLimit()
	limited := &io.LimitedReader{R: body, N: limit + 1}
	data, err := io.ReadAll(limited)
	if err != nil {
		return http.StatusBadRequest, "malformed_json"
	}
	if int64(len(data)) > limit {
		return http.StatusRequestEntityTooLarge, "body_limit"
	}

	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" {
		return http.StatusBadRequest, "malformed_json"
	}
	if err := json.Unmarshal(data, target); err != nil {
		return http.StatusBadRequest, "malformed_json"
	}
	return 0, ""
}

func writeMethodNotAllowed(writer http.ResponseWriter, allow string) {
	writer.Header().Set("Allow", allow)
	writeEmpty(writer, http.StatusMethodNotAllowed)
}

func writeEmpty(writer http.ResponseWriter, status int) {
	writer.WriteHeader(status)
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		writeEmpty(writer, http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", contentTypeJSON)
	writer.WriteHeader(status)
	_, _ = writer.Write(body)
}
