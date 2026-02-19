using System.Text.RegularExpressions;
using Parser.Parsers.Common;

namespace Parser.Parsers;

public enum ReleaseType
{
    Unknown = 0,
    SingleEpisode = 1,
    MultiEpisode = 2,
    SeasonPack = 3
}

public class ParsedEpisodeInfo
{
    public string? SeriesTitle { get; set; }
    public int SeasonNumber { get; set; }
    public int[] EpisodeNumbers { get; set; } = Array.Empty<int>();
    public int[] AbsoluteEpisodeNumbers { get; set; } = Array.Empty<int>();
    public string? AirDate { get; set; }
    public bool FullSeason { get; set; }
    public bool IsPartialSeason { get; set; }
    public bool IsMultiSeason { get; set; }
    public bool IsSeasonExtra { get; set; }
    public bool IsSplitEpisode { get; set; }
    public bool IsMiniSeries { get; set; }
    public bool Special { get; set; }
    public int SeasonPart { get; set; }
    public int? DailyPart { get; set; }

    public bool IsDaily => !string.IsNullOrWhiteSpace(AirDate);
    public bool IsAbsoluteNumbering => AbsoluteEpisodeNumbers.Any();

    public ReleaseType ReleaseType
    {
        get
        {
            if (EpisodeNumbers.Length > 1 || AbsoluteEpisodeNumbers.Length > 1)
            {
                return ReleaseType.MultiEpisode;
            }

            if (EpisodeNumbers.Length == 1 || AbsoluteEpisodeNumbers.Length == 1)
            {
                return ReleaseType.SingleEpisode;
            }

            if (FullSeason)
            {
                return ReleaseType.SeasonPack;
            }

            return ReleaseType.Unknown;
        }
    }
}

public static class EpisodeParser
{
    private static readonly Regex[] ReportTitleRegex = new[]
    {
        // Daily episode with year in series title and air time after date (Plex DVR format)
        new Regex(@"^^(?<title>.+?\((?<titleyear>\d{4})\))[-_. ]+(?<airyear>19[4-9]\d|20\d\d)(?<sep>[-_]?)(?<airmonth>0\d|1[0-2])\k<sep>(?<airday>[0-2]\d|3[01])[-_. ]\d{2}[-_. ]\d{2}[-_. ]\d{2}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Daily episodes without title (2018-10-12, 20181012)
        new Regex(@"^(?<airyear>19[6-9]\d|20\d\d)(?<sep>[-_]?)(?<airmonth>0\d|1[0-2])\k<sep>(?<airday>[0-2]\d|3[01])(?!\d)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Multi-Part episodes without a title (S01E05.S01E06)
        new Regex(@"^(?:\W*S(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:e{1,2}(?<episode>\d{1,3}(?!\d+)))+){2,}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Multi-Part episodes without a title (1x05.1x06)
        new Regex(@"^(?:\W*(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:x{1,2}(?<episode>\d{1,3}(?!\d+)))+){2,}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Episodes without a title, Multi (S01E04E05, 1x04x05, etc)
        new Regex(@"^(?:S?(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:(?:[-_]|[ex]){1,2}(?<episode>\d{2,3}(?!\d+))){2,})",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Split episodes (S01E05a, S01E05b, etc)
        new Regex(@"^(?<title>.+?)(?:S?(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:(?:[-_ ]?[ex])(?<episode>\d{2,3}(?!\d+))(?<splitepisode>[a-d])(?:[ _.])))",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Episodes without a title, Single (S01E05, 1x05)
        new Regex(@"^(?:S?(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:(?:[-_ ]?[ex])(?<episode>\d{2,3}(?!\d+))))",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Anime - [SubGroup] Title Absolute (Season+Episode)
        new Regex(@"^(?:\[(?<subgroup>.+?)\](?:_|-|\s|\.)?)(?<title>.+?)[-_. ]+(?<absoluteepisode>(?<!\d+)\d{2,3}(\.\d{1,2})?(?!\d+))(?:[-_. ])+\((?:S(?<season>(?<!\d+)\d{1,2}(?!\d+))(?:(?:[ex]|\W[ex]){1,2}(?<episode>\d{2}(?!\d+))))(?:v\d+)?(?:\)(?!\d+)).*?(?<hash>[(\[]\w{8}[)\]])?$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Anime - [SubGroup] Title Season+Episode
        new Regex(@"^(?:\[(?<subgroup>.+?)\](?:_|-|\s|\.)?)(?<title>.+?)(?:[-_\W](?<![()\[!]))+(?:S?(?<season>(?<!\d+)\d{1,2}(?!\d+))(?:(?:[ex]|\W[ex]){1,2}(?<episode>\d{2}(?!\d+)))+)(?:v\d+)?(?:[_. ](?!\d+)).*?(?<hash>[(\[]\w{8}[)\]])?$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Anime - [SubGroup] Title Episode Absolute Episode Number
        new Regex(@"^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>.+?)[-_. ]+?(?:Episode)(?:[-_. ]+(?<absoluteepisode>(?<!\d+)\d{2,3}(\.\d{1,2})?(?!\d+)))+.*?(?<hash>[(\[]\w{8}[)\]])?$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Anime - [SubGroup] Title with trailing number Absolute Episode Number
        new Regex(@"^\[(?<subgroup>.+?)\][-_. ]?(?<title>[^-]+?)(?:(?<![-_. ]|\b[0]\d+) - )(?:[-_. ]?(?<absoluteepisode>\d{2,3}(\.\d{1,2})?(?!\d+)))+(?:[-_. ]+(?<special>special|ova|ovd))?.*?(?<hash>[(\[]\w{8}[)\]])?(?:$|\.mkv)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Anime - [SubGroup] Title Absolute Episode Number
        new Regex(@"^\[(?<subgroup>.+?)\][-_. ]?(?<title>.+?)[-_. ]+\(?(?:[-_. ]?#?(?<absoluteepisode>\d{2,3}(\.\d{1,2})?(?!\d+|-[a-z]+)))+\)?(?:[-_. ]+(?<special>special|ova|ovd))?.*?(?<hash>[(\[]\w{8}[)\]])?(?:$|\.mkv)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Multi-episode Repeated (S01E05 - S01E06)
        new Regex(@"^(?<title>.+?)(?:(?:[-_\W](?<![()\[!]))+S(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:(?:e|[-_. ]e){1,2}(?<episode>\d{1,3}(?!\d+)))+){2,}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Multi-episode Repeated (1x05 - 1x06)
        new Regex(@"^(?<title>.+?)(?:(?:[-_\W](?<![()\[!]))+(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:x{1,2}(?<episode>\d{1,3}(?!\d+)))+){2,}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Multi-episode with title (S01E99-100, S01E05-06)
        new Regex(@"^(?<title>.+?)(?:[-_\W](?<![()\[!]))+S(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))E(?<episode>\d{2,3}(?!\d+))(?:-(?<episode>\d{2,3}(?!\d+)))+(?:[-_. ]|$)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Episodes with a title, Single episodes (S01E05, 1x05, etc) & Multi-episode (S01E05E06, S01E05-06, etc)
        new Regex(@"^(?<title>.+?)(?:(?:[-_\W](?<![()\[!]))+S?(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))(?:[ex]|\W[ex]){1,2}(?<episode>\d{2,3}(?!\d+))(?:(?:\-|[ex]|\W[ex]|_){1,2}(?<episode>\d{2,3}(?!\d+)))*)(?:[-_. ]|$)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Episodes with a title, 4 digit season number (S2016E05, etc)
        new Regex(@"^(?<title>.+?)(?:(?:[-_\W](?<![()\[!]))+S(?<season>(?<!\d+)(?:\d{4})(?!\d+))(?:e|\We|_){1,2}(?<episode>\d{2,4}(?!\d+))(?:(?:\-|e|\We|_){1,2}(?<episode>\d{2,3}(?!\d+)))*)\W?(?!\\)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Multi-season pack
        new Regex(@"^(?<title>.+?)(Complete Series)?[-_. ]+(?:S|(?:Season|Saison|Series|Stagione)[_. ])(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))(?:[-_. ]{1}|[-_. ]{3})(?:S|(?:Season|Saison|Series|Stagione)[_. ])?(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Partial season pack
        new Regex(@"^(?<title>.+?)(?:\W+S(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))\W+(?:(?:(?:Part|Vol)\W?|(?<!\d+\W+)e|p)(?<seasonpart>\d{1,2}(?!\d+)))+)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Season only releases followed by year
        new Regex(@"^(?<title>.+?)[-_. ]+?(?:S|Season|Saison|Series|Stagione)[-_. ]?(?<season>\d{1,2}(?=[-_. ]\d{4}[-_. ]+))(?<extras>EXTRAS|SUBPACK)?(?!\\)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Season only releases
        new Regex(@"^(?<title>.+?)[-_. ]+?(?:S|Season|Saison|Series|Stagione)[-_. ]?(?<season>\d{1,2}(?![-_. ]?\d+))(?:[-_. ]|$)+(?<extras>EXTRAS|SUBPACK)?(?!\\)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // 4 digit season only releases
        new Regex(@"^(?<title>.+?)[-_. ]+?(?:S|Season|Saison|Series|Stagione)[-_. ]?(?<season>\d{4}(?![-_. ]?\d+))(\W+|_|$)(?<extras>EXTRAS|SUBPACK)?(?!\\)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Mini-Series with year in title (Part01, Part 01, Part.1)
        new Regex(@"^(?<title>.+?\d{4})(?:\W+(?:(?:Part\W?|e)(?<episode>\d{1,2}(?!\d+)))+)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Mini-Series (E1-E2)
        new Regex(@"^(?<title>.+?)(?:[-._ ][e])(?<episode>\d{2,3}(?!\d+))(?:(?:\-?[e])(?<episode>\d{2,3}(?!\d+)))+",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Episodes with airdate (2018.04.28)
        new Regex(@"^(?<title>.+?)?\W*(?<airyear>\d{4})[-_. ]+(?<airmonth>[0-1][0-9])[-_. ]+(?<airday>[0-3][0-9])(?![-_. ]+[0-3][0-9])",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Episodes with airdate (04.28.2018)
        new Regex(@"^(?<title>.+?)?\W*(?<ambiguousairmonth>[0-1][0-9])[-_. ]+(?<ambiguousairday>[0-3][0-9])[-_. ]+(?<airyear>\d{4})(?!\d+)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Episodes with airdate (20180428)
        new Regex(@"^(?<title>.+?)?\W*(?<!\d+)(?<airyear>\d{4})(?<airmonth>[0-1][0-9])(?<airday>[0-3][0-9])(?!\d+)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Mini-Series (Part01, Part 01, Part.1)
        new Regex(@"^(?<title>.+?)(?:\W+(?:(?:(?<!\()Part\W?|(?<!\d+\W+)e)(?<episode>\d{1,2}(?!\d+|\))))+)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Mini-Series (Part One/Two/Three/...Nine)
        new Regex(@"^(?<title>.+?)(?:\W+(?:Part[-._ ](?<episode>One|Two|Three|Four|Five|Six|Seven|Eight|Nine)(?>[-._ ])))",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Mini-Series (XofY)
        new Regex(@"^(?<title>.+?)(?:\W+(?:(?<episode>(?<!\d+)\d{1,2}(?!\d+))of\d+)+)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Supports Season 01 Episode 03
        new Regex(@"(?:.*(?:\""|^))(?<title>.*?)(?:[-_\W](?<![()\[]))+(?:\W?Season\W?)(?<season>(?<!\d+)\d{1,2}(?!\d+))(?:\W|_)+(?:Episode\W)(?:[-_. ]?(?<episode>(?<!\d+)\d{1,2}(?!\d+)))+",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Multi-episode with single episode numbers (S6.E1-E2, S6.E1E2, S6E1E2, etc)
        new Regex(@"^(?<title>.+?)[-_. ]S(?<season>(?<!\d+)(?:\d{1,2}|\d{4})(?!\d+))(?:[-_. ]?[ex]?(?<episode>(?<!\d+)\d{1,2}(?!\d+)))+",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Single episode season or episode S1E1 or S1-E1 or S1.Ep1
        new Regex(@"(?:.*(?:\""|^))(?<title>.*?)(?:\W?|_)S(?<season>(?<!\d+)\d{1,2}(?!\d+))(?:\W|_)?Ep?[ ._]?(?<episode>(?<!\d+)\d{1,2}(?!\d+))",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Supports 103/113 naming
        new Regex(@"^(?<title>.+?)?(?:(?:[_.-](?<![()\[!]))+(?<season>(?<!\d+)[1-9])(?<episode>[1-9][0-9]|[0][1-9])(?![a-z]|\d+))+(?:[_.]|$)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Anime - Title Absolute Episode Number
        new Regex(@"^(?:\[(?<subgroup>.+?)\][-_. ]?)?(?<title>.+?)(?:[-_. ]+(?<absoluteepisode>(?<!\d+)\d{2,4}(\.\d{1,2})?(?!\d+|[ip])))+.*?(?<hash>[(\[]\w{8}[)\]])?$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Anime OVA special
        new Regex(@"^\[(?<subgroup>.+?)\][-_. ]?(?<title>.+?)(?:[-_. ]+(?<special>special|ova|ovd)).*?(?<hash>[(\[]\w{8}[)\]])?(?:$|\.mkv)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled)
    };

    private static readonly Regex[] RejectHashedReleasesRegex = new Regex[]
    {
        new Regex(@"^[0-9a-zA-Z]{32}", RegexOptions.Compiled),
        new Regex(@"^[a-z0-9]{24}$", RegexOptions.Compiled),
        new Regex(@"^[A-Z]{11}\d{3}$", RegexOptions.Compiled),
        new Regex(@"^[a-z]{12}\d{3}$", RegexOptions.Compiled),
        new Regex(@"^Backup_\d{5,}S\d{2}-\d{2}$", RegexOptions.Compiled),
        new Regex(@"^123$", RegexOptions.Compiled),
        new Regex(@"^abc$", RegexOptions.Compiled | RegexOptions.IgnoreCase),
        new Regex(@"^abc[-_. ]xyz", RegexOptions.Compiled | RegexOptions.IgnoreCase),
        new Regex(@"^b00bs$", RegexOptions.Compiled | RegexOptions.IgnoreCase)
    };

    private static readonly Regex ReversedTitleRegex = new(
        @"(?:^|[-._ ])(p027|p0801|\d{2,3}E\d{2}S)[-._ ]",
        RegexOptions.Compiled);

    private static readonly RegexReplace SimpleTitleRegex = new(
        @"(?:(480|540|576|720|1080|1440|2160)[ip]|[xh][\W_]?26[45]|DD\W?5\W1|[<>?*]|848x480|1280x720|1920x1080|3840x2160|4096x2160|(?<![a-f0-9])(8|10)[ -]?(b(?![a-z0-9])|bit))\s*?",
        string.Empty,
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex CleanQualityBracketsRegex = new(
        @"\[[a-z0-9 ._-]+\]$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex SixDigitAirDateRegex = new(
        @"(?<=[_.-])(?<airdate>(?<!\d)(?<airyear>[1-9]\d{1})(?<airmonth>[0-1][0-9])(?<airday>[0-3][0-9]))(?=[_.-])",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex RequestInfoRegex = new(
        @"^(?:\[.+?\])+",
        RegexOptions.Compiled);

    private static readonly string[] Numbers = { "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine" };

    public static ParsedEpisodeInfo? ParseTitle(string title)
    {
        try
        {
            if (!ValidateBeforeParsing(title))
            {
                return null;
            }

            if (ReversedTitleRegex.IsMatch(title))
            {
                var titleWithoutExtension = ParserCommon.RemoveFileExtension(title).ToCharArray();
                Array.Reverse(titleWithoutExtension);
                title = $"{new string(titleWithoutExtension)}{title.Substring(titleWithoutExtension.Length)}";
            }

            var releaseTitle = ParserCommon.RemoveFileExtension(title);
            releaseTitle = releaseTitle.Replace("【", "[").Replace("】", "]");

            foreach (var replace in ParserCommon.PreSubstitutionRegex)
            {
                if (replace.TryReplace(ref releaseTitle))
                {
                    break;
                }
            }

            var simpleTitle = SimpleTitleRegex.Replace(releaseTitle);
            simpleTitle = ParserCommon.WebsitePrefixRegex.Replace(simpleTitle);
            simpleTitle = ParserCommon.WebsitePostfixRegex.Replace(simpleTitle);
            simpleTitle = ParserCommon.CleanTorrentSuffixRegex.Replace(simpleTitle);
            simpleTitle = CleanQualityBracketsRegex.Replace(simpleTitle, string.Empty);

            // Handle 6-digit air dates (YYMMDD)
            var sixDigitAirDateMatch = SixDigitAirDateRegex.Match(simpleTitle);
            if (sixDigitAirDateMatch.Success)
            {
                var airYear = sixDigitAirDateMatch.Groups["airyear"].Value;
                var airMonth = sixDigitAirDateMatch.Groups["airmonth"].Value;
                var airDay = sixDigitAirDateMatch.Groups["airday"].Value;

                if (airMonth != "00" || airDay != "00")
                {
                    var fixedDate = $"20{airYear}.{airMonth}.{airDay}";
                    simpleTitle = simpleTitle.Replace(sixDigitAirDateMatch.Groups["airdate"].Value, fixedDate);
                }
            }

            foreach (var regex in ReportTitleRegex)
            {
                var match = regex.Matches(simpleTitle);

                if (match.Count != 0)
                {
                    var result = ParseMatchCollection(match, releaseTitle);
                    if (result != null)
                    {
                        if (result.FullSeason && releaseTitle.Contains("Special", StringComparison.OrdinalIgnoreCase))
                        {
                            result.FullSeason = false;
                            result.Special = true;
                        }
                        return result;
                    }
                }
            }
        }
        catch
        {
            // Parsing failed
        }

        return null;
    }

    private static ParsedEpisodeInfo? ParseMatchCollection(MatchCollection matchCollection, string releaseTitle)
    {
        var seriesName = matchCollection[0].Groups["title"].Value.Replace('.', ' ').Replace('_', ' ');
        seriesName = RequestInfoRegex.Replace(seriesName, "").Trim(' ');

        int.TryParse(matchCollection[0].Groups["airyear"].Value, out var airYear);

        ParsedEpisodeInfo result;

        if (airYear < 1900)
        {
            result = new ParsedEpisodeInfo
            {
                EpisodeNumbers = Array.Empty<int>(),
                AbsoluteEpisodeNumbers = Array.Empty<int>()
            };

            foreach (Match matchGroup in matchCollection)
            {
                var episodeCaptures = matchGroup.Groups["episode"].Captures.Cast<Capture>().ToList();
                var absoluteEpisodeCaptures = matchGroup.Groups["absoluteepisode"].Captures.Cast<Capture>().ToList();

                if (episodeCaptures.Any())
                {
                    var first = ParseNumber(episodeCaptures.First().Value);
                    var last = ParseNumber(episodeCaptures.Last().Value);

                    if (first > last)
                    {
                        return null;
                    }

                    var count = last - first + 1;
                    result.EpisodeNumbers = Enumerable.Range(first, count).ToArray();

                    if (matchGroup.Groups["special"].Success)
                    {
                        result.Special = true;
                    }

                    if (matchGroup.Groups["splitepisode"].Success)
                    {
                        result.IsSplitEpisode = true;
                    }
                }

                if (absoluteEpisodeCaptures.Any())
                {
                    var first = ParseDecimal(absoluteEpisodeCaptures.First().Value);
                    var last = ParseDecimal(absoluteEpisodeCaptures.Last().Value);

                    if (first > last)
                    {
                        return null;
                    }

                    if ((first % 1) != 0 || (last % 1) != 0)
                    {
                        // Special episode with decimal
                        result.Special = true;
                    }
                    else
                    {
                        var count = last - first + 1;
                        result.AbsoluteEpisodeNumbers = Enumerable.Range((int)first, (int)count).ToArray();

                        if (matchGroup.Groups["special"].Success)
                        {
                            result.Special = true;
                        }
                    }
                }

                if (!episodeCaptures.Any() && !absoluteEpisodeCaptures.Any())
                {
                    if (!string.IsNullOrWhiteSpace(matchCollection[0].Groups["extras"].Value))
                    {
                        result.IsSeasonExtra = true;
                    }

                    var seasonPart = matchCollection[0].Groups["seasonpart"].Value;

                    if (!string.IsNullOrWhiteSpace(seasonPart))
                    {
                        result.SeasonPart = Convert.ToInt32(seasonPart);
                        result.IsPartialSeason = true;
                    }
                    else if (matchCollection[0].Groups["special"].Success)
                    {
                        result.Special = true;
                    }
                    else
                    {
                        result.FullSeason = true;
                    }
                }
            }

            var seasons = new List<int>();

            foreach (Capture seasonCapture in matchCollection[0].Groups["season"].Captures)
            {
                if (int.TryParse(seasonCapture.Value, out var parsedSeason))
                {
                    seasons.Add(parsedSeason);
                }
            }

            if (seasons.Distinct().Count() > 1)
            {
                result.IsMultiSeason = true;
            }

            if (seasons.Any())
            {
                result.SeasonNumber = seasons.First();
            }
            else if (!result.AbsoluteEpisodeNumbers.Any() && result.EpisodeNumbers.Any())
            {
                result.SeasonNumber = 1;
                result.IsMiniSeries = true;
            }
        }
        else
        {
            // Daily show with air date
            var airmonth = 0;
            var airday = 0;

            if (matchCollection[0].Groups["ambiguousairmonth"].Success &&
                matchCollection[0].Groups["ambiguousairday"].Success)
            {
                var ambiguousAirMonth = Convert.ToInt32(matchCollection[0].Groups["ambiguousairmonth"].Value);
                var ambiguousAirDay = Convert.ToInt32(matchCollection[0].Groups["ambiguousairday"].Value);

                if (ambiguousAirDay <= 12 && ambiguousAirMonth <= 12)
                {
                    // Ambiguous date
                    return null;
                }

                airmonth = ambiguousAirMonth;
                airday = ambiguousAirDay;
            }
            else
            {
                airmonth = Convert.ToInt32(matchCollection[0].Groups["airmonth"].Value);
                airday = Convert.ToInt32(matchCollection[0].Groups["airday"].Value);
            }

            // Swap day and month if month is bigger than 12
            if (airmonth > 12)
            {
                (airday, airmonth) = (airmonth, airday);
            }

            try
            {
                var airDate = new DateTime(airYear, airmonth, airday);

                if (airDate > DateTime.Now.AddDays(1).Date || airDate < new DateTime(1970, 1, 1))
                {
                    return null;
                }

                result = new ParsedEpisodeInfo
                {
                    AirDate = airDate.ToString("yyyy-MM-dd")
                };

                var partMatch = matchCollection[0].Groups["part"];
                if (partMatch.Success)
                {
                    result.DailyPart = Convert.ToInt32(partMatch.Value);
                }
            }
            catch
            {
                return null;
            }
        }

        result.SeriesTitle = seriesName;

        return result;
    }

    private static bool ValidateBeforeParsing(string title)
    {
        if (title.ToLower().Contains("password") && title.ToLower().Contains("yenc"))
        {
            return false;
        }

        if (!title.Any(char.IsLetterOrDigit))
        {
            return false;
        }

        var titleWithoutExtension = ParserCommon.RemoveFileExtension(title);

        if (RejectHashedReleasesRegex.Any(v => v.IsMatch(titleWithoutExtension)))
        {
            return false;
        }

        return true;
    }

    private static int ParseNumber(string value)
    {
        if (int.TryParse(value, out var number))
        {
            return number;
        }

        number = Array.IndexOf(Numbers, value.ToLower());

        if (number != -1)
        {
            return number;
        }

        throw new FormatException($"{value} isn't a number");
    }

    private static decimal ParseDecimal(string value)
    {
        if (decimal.TryParse(value, System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var number))
        {
            return number;
        }

        throw new FormatException($"{value} isn't a number");
    }
}
