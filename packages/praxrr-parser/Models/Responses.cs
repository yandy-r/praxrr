namespace Parser.Models;

public record ParseResponse
{
    public string Title { get; init; } = "";
    public string Type { get; init; } = "";
    public string Source { get; init; } = "";
    public int Resolution { get; init; }
    public string Modifier { get; init; } = "";
    public RevisionResponse Revision { get; init; } = new();
    public List<string> Languages { get; init; } = new();
    public string? ReleaseGroup { get; init; }
    public List<string> MovieTitles { get; init; } = new();
    public int Year { get; init; }
    public string? Edition { get; init; }
    public string? ImdbId { get; init; }
    public int TmdbId { get; init; }
    public string? HardcodedSubs { get; init; }
    public string? ReleaseHash { get; init; }
    public EpisodeResponse? Episode { get; init; }
}

public record RevisionResponse
{
    public int Version { get; init; } = 1;
    public int Real { get; init; }
    public bool IsRepack { get; init; }
}

public record EpisodeResponse
{
    public string? SeriesTitle { get; init; }
    public int SeasonNumber { get; init; }
    public List<int> EpisodeNumbers { get; init; } = new();
    public List<int> AbsoluteEpisodeNumbers { get; init; } = new();
    public string? AirDate { get; init; }
    public bool FullSeason { get; init; }
    public bool IsPartialSeason { get; init; }
    public bool IsMultiSeason { get; init; }
    public bool IsMiniSeries { get; init; }
    public bool Special { get; init; }
    public string ReleaseType { get; init; } = "Unknown";
}

public record MatchResponse
{
    public Dictionary<string, bool> Results { get; init; } = new();
}

public record BatchMatchResponse
{
    public Dictionary<string, Dictionary<string, bool>> Results { get; init; } = new();
}
