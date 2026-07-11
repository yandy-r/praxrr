package parser

import (
	"time"

	"github.com/yandy-r/praxrr/packages/praxrr-parser/internal/contract"
)

// DomainSnapshotForParity exposes the smallest composed domain result needed
// by the cross-package golden gate. The individual parser entry points remain
// private; production callers should use Service once the HTTP-independent
// orchestration layer is available.
//
// The clock is supplied because the legacy daily parser accepts dates through
// tomorrow, making its result time-dependent.
func DomainSnapshotForParity(
	title string,
	mediaType contract.MediaType,
	now time.Time,
) contract.ParseResponse {
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
		if movie := parseMovieTitle(title, false); movie != nil {
			result.MovieTitles = movie.MovieTitles
			result.Year = movie.Year
			result.Edition = movie.Edition
			result.ImdbID = movie.ImdbID
			result.TmdbID = movie.TmdbID
			result.HardcodedSubs = movie.HardcodedSubs
			result.ReleaseHash = movie.ReleaseHash
		}
	case contract.MediaTypeSeries:
		if episode := parseEpisodeAt(title, now); episode != nil {
			seriesTitle := episode.SeriesTitle
			result.Episode = &contract.EpisodeResponse{
				SeriesTitle:            &seriesTitle,
				SeasonNumber:           episode.SeasonNumber,
				EpisodeNumbers:         append([]int{}, episode.EpisodeNumbers...),
				AbsoluteEpisodeNumbers: append([]int{}, episode.AbsoluteEpisodeNumbers...),
				AirDate:                parityStringPointer(episode.AirDate),
				FullSeason:             episode.FullSeason,
				IsPartialSeason:        episode.IsPartialSeason,
				IsMultiSeason:          episode.IsMultiSeason,
				IsMiniSeries:           episode.IsMiniSeries,
				Special:                episode.Special,
				ReleaseType:            episode.releaseType(),
			}
		}
	}

	return result
}

func parityStringPointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
