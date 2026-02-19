using Parser.Logging;
using Parser.Models;
using Parser.Parsers;

namespace Parser.Endpoints;

public static class ParseEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/parse", Handle);
    }

    private static IResult Handle(ParseRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
        {
            Log.Debug("Parse request rejected: missing title", "Parse");
            return Results.BadRequest(new { error = "Title is required" });
        }

        if (string.IsNullOrWhiteSpace(request.Type) ||
            (request.Type != "movie" && request.Type != "series"))
        {
            Log.Debug($"Parse request rejected: invalid type '{request.Type}'", "Parse");
            return Results.BadRequest(new { error = "Type is required and must be 'movie' or 'series'" });
        }

        var qualityResult = QualityParser.ParseQuality(request.Title);
        var languages = LanguageParser.ParseLanguages(request.Title);
        var releaseGroup = ReleaseGroupParser.ParseReleaseGroup(request.Title);

        if (request.Type == "movie")
        {
            var titleInfo = TitleParser.ParseMovieTitle(request.Title);
            var response = new ParseResponse
            {
                Title = request.Title,
                Type = "movie",
                Source = qualityResult.Source.ToString(),
                Resolution = (int)qualityResult.Resolution,
                Modifier = qualityResult.Modifier.ToString(),
                Revision = new RevisionResponse
                {
                    Version = qualityResult.Revision.Version,
                    Real = qualityResult.Revision.Real,
                    IsRepack = qualityResult.Revision.IsRepack
                },
                Languages = languages.Select(l => l.ToString()).ToList(),
                ReleaseGroup = releaseGroup,
                MovieTitles = titleInfo?.MovieTitles ?? new List<string>(),
                Year = titleInfo?.Year ?? 0,
                Edition = titleInfo?.Edition,
                ImdbId = titleInfo?.ImdbId,
                TmdbId = titleInfo?.TmdbId ?? 0,
                HardcodedSubs = titleInfo?.HardcodedSubs,
                ReleaseHash = titleInfo?.ReleaseHash,
                Episode = null
            };

            Log.Info($"Parsed movie: {request.Title}", new LogOptions
            {
                Source = "Parse",
                Meta = new
                {
                    source = response.Source,
                    resolution = response.Resolution,
                    languages = response.Languages,
                    releaseGroup = response.ReleaseGroup,
                    year = response.Year,
                    title = titleInfo?.PrimaryMovieTitle
                }
            });

            return Results.Ok(response);
        }
        else // series
        {
            var episodeInfo = EpisodeParser.ParseTitle(request.Title);
            var response = new ParseResponse
            {
                Title = request.Title,
                Type = "series",
                Source = qualityResult.Source.ToString(),
                Resolution = (int)qualityResult.Resolution,
                Modifier = qualityResult.Modifier.ToString(),
                Revision = new RevisionResponse
                {
                    Version = qualityResult.Revision.Version,
                    Real = qualityResult.Revision.Real,
                    IsRepack = qualityResult.Revision.IsRepack
                },
                Languages = languages.Select(l => l.ToString()).ToList(),
                ReleaseGroup = releaseGroup,
                MovieTitles = new List<string>(),
                Year = 0,
                Edition = null,
                ImdbId = null,
                TmdbId = 0,
                HardcodedSubs = null,
                ReleaseHash = null,
                Episode = episodeInfo != null ? new EpisodeResponse
                {
                    SeriesTitle = episodeInfo.SeriesTitle,
                    SeasonNumber = episodeInfo.SeasonNumber,
                    EpisodeNumbers = episodeInfo.EpisodeNumbers.ToList(),
                    AbsoluteEpisodeNumbers = episodeInfo.AbsoluteEpisodeNumbers.ToList(),
                    AirDate = episodeInfo.AirDate,
                    FullSeason = episodeInfo.FullSeason,
                    IsPartialSeason = episodeInfo.IsPartialSeason,
                    IsMultiSeason = episodeInfo.IsMultiSeason,
                    IsMiniSeries = episodeInfo.IsMiniSeries,
                    Special = episodeInfo.Special,
                    ReleaseType = episodeInfo.ReleaseType.ToString()
                } : null
            };

            Log.Info($"Parsed series: {request.Title}", new LogOptions
            {
                Source = "Parse",
                Meta = new
                {
                    source = response.Source,
                    resolution = response.Resolution,
                    languages = response.Languages,
                    releaseGroup = response.ReleaseGroup,
                    series = episodeInfo?.SeriesTitle,
                    season = episodeInfo?.SeasonNumber,
                    episodes = episodeInfo?.EpisodeNumbers
                }
            });

            return Results.Ok(response);
        }
    }
}
