package parser

import (
	"time"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

// Service composes the parser domains without depending on HTTP, process
// configuration, or logging state. The clock is injected so the legacy daily
// episode boundary remains deterministic in parity tests.
type Service struct {
	now func() time.Time
}

// NewService returns a parser service using the process clock.
func NewService() *Service {
	return newServiceWithClock(time.Now)
}

// NewServiceWithClock returns a parser service with an explicit clock. It is
// used by cross-runtime parity gates so date-boundary fixtures remain pinned to
// their captured oracle instant while production continues to use NewService.
func NewServiceWithClock(now func() time.Time) *Service {
	return newServiceWithClock(now)
}

func newServiceWithClock(now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{now: now}
}

// Parse applies the legacy domain parsers in their observable orchestration
// order: quality, languages, release group, then the selected media parser.
// Request validation remains the HTTP handler's responsibility.
func (service *Service) Parse(title string, mediaType contract.MediaType) contract.ParseResponse {
	result := contract.NewParseResponse()
	result.Title = title
	result.Type = mediaType

	quality := parseQuality(title)
	result.Source = quality.Source
	result.Resolution = quality.Resolution
	result.Modifier = quality.Modifier
	result.Revision = quality.Revision
	result.Languages = parseLanguages(title)
	result.ReleaseGroup = parseReleaseGroup(title)

	switch mediaType {
	case contract.MediaTypeMovie:
		populateMovieResponse(&result, parseMovieTitle(title, false))
	case contract.MediaTypeSeries:
		now := time.Now
		if service != nil && service.now != nil {
			now = service.now
		}
		populateEpisodeResponse(&result, parseEpisodeAt(title, now()))
	}

	return result
}

func populateMovieResponse(response *contract.ParseResponse, movie *parsedMovieInfo) {
	if movie == nil {
		return
	}
	response.MovieTitles = append([]string{}, movie.MovieTitles...)
	response.Year = movie.Year
	response.Edition = movie.Edition
	response.ImdbID = movie.ImdbID
	response.TmdbID = movie.TmdbID
	response.HardcodedSubs = movie.HardcodedSubs
	response.ReleaseHash = movie.ReleaseHash
}

func populateEpisodeResponse(response *contract.ParseResponse, episode *parsedEpisodeInfo) {
	if episode == nil {
		return
	}

	seriesTitle := episode.SeriesTitle
	response.Episode = &contract.EpisodeResponse{
		SeriesTitle:            &seriesTitle,
		SeasonNumber:           episode.SeasonNumber,
		EpisodeNumbers:         append([]int{}, episode.EpisodeNumbers...),
		AbsoluteEpisodeNumbers: append([]int{}, episode.AbsoluteEpisodeNumbers...),
		AirDate:                optionalString(episode.AirDate),
		FullSeason:             episode.FullSeason,
		IsPartialSeason:        episode.IsPartialSeason,
		IsMultiSeason:          episode.IsMultiSeason,
		IsMiniSeries:           episode.IsMiniSeries,
		Special:                episode.Special,
		ReleaseType:            episode.releaseType(),
	}
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
