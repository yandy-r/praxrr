using System.Text.RegularExpressions;
using Parser.Parsers.Common;

namespace Parser.Parsers;

public class ParsedMovieInfo
{
    public List<string> MovieTitles { get; set; } = new();
    public string PrimaryMovieTitle => MovieTitles.FirstOrDefault() ?? "";
    public int Year { get; set; }
    public string? Edition { get; set; }
    public string? ImdbId { get; set; }
    public int TmdbId { get; set; }
    public string? ReleaseHash { get; set; }
    public string? HardcodedSubs { get; set; }
}

public static class TitleParser
{
    private static readonly Regex EditionRegex = new(
        @"\(?\b(?<edition>(((Recut.|Extended.|Ultimate.)?(Director.?s|Collector.?s|Theatrical|Ultimate|Extended|Despecialized|(Special|Rouge|Final|Assembly|Imperial|Diamond|Signature|Hunter|Rekall)(?=(.(Cut|Edition|Version)))|\d{2,3}(th)?.Anniversary)(?:.(Cut|Edition|Version))?(.(Extended|Uncensored|Remastered|Unrated|Uncut|Open.?Matte|IMAX|Fan.?Edit))?|((Uncensored|Remastered|Unrated|Uncut|Open?.Matte|IMAX|Fan.?Edit|Restored|((2|3|4)in1))))))\b\)?",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex ReportEditionRegex = new(
        @"^.+?" + EditionRegex,
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex HardcodedSubsRegex = new(
        @"\b((?<hcsub>(\w+(?<!SOFT|MULTI|HORRIBLE)SUBS?))|(?<hc>(HC|SUBBED)))\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.IgnorePatternWhitespace);

    private static readonly Regex[] ReportMovieTitleRegex = new[]
    {
        // Anime [Subgroup] and Year
        new Regex(@"^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)\[!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|x|\d+|\]|\W\d+)))+.*?(?<hash>\[\w{8}\])?(?:$|\.)", RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Anime [Subgroup] no year, versioned title, hash
        new Regex(@"^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+?)((v)(?:\d{1,2})(?:([-_. ])))(\[.*)?(?:[\[(][^])])?.*?(?<hash>\[\w{8}\])(?:$|\.)", RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Anime [Subgroup] no year, info in double sets of brackets, hash
        new Regex(@"^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+?)(\[.*).*?(?<hash>\[\w{8}\])(?:$|\.)", RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Anime [Subgroup] no year, info in parentheses or brackets, hash
        new Regex(@"^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+)(?:[\[(][^])]).*?(?<hash>\[\w{8}\])(?:$|\.)", RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Some german or french tracker formats (missing year, ...) - see ParserFixture for examples and tests
        new Regex(@"^(?<title>(?![(\[]).+?)((\W|_))(" + EditionRegex + @".{1,3})?(?:(?<!(19|20)\d{2}.*?)(?<!(?:Good|The)[_ .-])(German|TrueFrench))(.+?)(?=((19|20)\d{2}|$))(?<year>(19|20)\d{2}(?!p|i|\d+|\]|\W\d+))?(\W+|_|$)(?!\\)", RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Special, Despecialized, etc. Edition Movies, e.g: Mission.Impossible.3.Special.Edition.2011
        new Regex(@"^(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)\[!]))*" + EditionRegex + @".{1,3}(?<year>(1(8|9)|20)\d{2}(?!p|i|\d+|\]|\W\d+)))+(\W+|_|$)(?!\\)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // Normal movie format, e.g: Mission.Impossible.3.2011
        new Regex(@"^(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)\[!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|(1(8|9)|20)\d{2}|\]|\W(1(8|9)|20)\d{2})))+(\W+|_|$)(?!\\)", RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // PassThePopcorn Torrent names: Star.Wars[PassThePopcorn]
        new Regex(@"^(?<title>.+?)?(?:(?:[-_\W](?<![()\[!]))*(?<year>(\[\w *\])))+(\W+|_|$)(?!\\)", RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // That did not work? Maybe some tool uses [] for years. Who would do that?
        new Regex(@"^(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|\d+|\W\d+)))+(\W+|_|$)(?!\\)", RegexOptions.IgnoreCase | RegexOptions.Compiled),

        // As a last resort for movies that have ( or [ in their title.
        new Regex(@"^(?<title>.+?)?(?:(?:[-_\W](?<![)\[!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|\d+|\]|\W\d+)))+(\W+|_|$)(?!\\)", RegexOptions.IgnoreCase | RegexOptions.Compiled)
    };

    private static readonly Regex[] ReportMovieTitleFolderRegex = new[]
    {
        // When year comes first.
        new Regex(@"^(?:(?:[-_\W](?<![)!]))*(?<year>(19|20)\d{2}(?!p|i|\d+|\W\d+)))+(\W+|_|$)(?<title>.+?)?$")
    };

    private static readonly Regex[] RejectHashedReleasesRegex = new Regex[]
    {
        // Generic match for md5 and mixed-case hashes.
        new Regex(@"^[0-9a-zA-Z]{32}", RegexOptions.Compiled),

        // Generic match for shorter lower-case hashes.
        new Regex(@"^[a-z0-9]{24}$", RegexOptions.Compiled),

        // Format seen on some NZBGeek releases
        new Regex(@"^[A-Z]{11}\d{3}$", RegexOptions.Compiled),
        new Regex(@"^[a-z]{12}\d{3}$", RegexOptions.Compiled),

        // Backup filename (Unknown origins)
        new Regex(@"^Backup_\d{5,}S\d{2}-\d{2}$", RegexOptions.Compiled),

        // 123 - Started appearing December 2014
        new Regex(@"^123$", RegexOptions.Compiled),

        // abc - Started appearing January 2015
        new Regex(@"^abc$", RegexOptions.Compiled | RegexOptions.IgnoreCase),

        // abc - Started appearing 2020
        new Regex(@"^abc[-_. ]xyz", RegexOptions.Compiled | RegexOptions.IgnoreCase),

        // b00bs - Started appearing January 2015
        new Regex(@"^b00bs$", RegexOptions.Compiled | RegexOptions.IgnoreCase)
    };

    // Regex to detect whether the title was reversed.
    private static readonly Regex ReversedTitleRegex = new(
        @"(?:^|[-._ ])(p027|p0801)[-._ ]",
        RegexOptions.Compiled);

    // Regex to split movie titles that contain `AKA`.
    private static readonly Regex AlternativeTitleRegex = new(
        @"[ ]+(?:AKA|\/)[ ]+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Regex to unbracket alternative titles.
    private static readonly Regex BracketedAlternativeTitleRegex = new(
        @"(.*) \([ ]*AKA[ ]+(.*)\)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex NormalizeAlternativeTitleRegex = new(
        @"[ ]+(?:A\.K\.A\.)[ ]+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ReportImdbId = new(
        @"(?<imdbid>tt\d{7,8})",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ReportTmdbId = new(
        @"tmdb(id)?-(?<tmdbid>\d+)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly RegexReplace SimpleTitleRegex = new(
        @"(?:(480|540|576|720|1080|2160)[ip]|[xh][\W_]?26[45]|DD\W?5\W1|[<>?*]|848x480|1280x720|1920x1080|3840x2160|4096x2160|(8|10)b(it)?|10-bit)\s*?(?![a-b0-9])",
        string.Empty,
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex SimpleReleaseTitleRegex = new(
        @"\s*(?:[<>?*|])",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex CleanQualityBracketsRegex = new(
        @"\[[a-z0-9 ._-]+\]$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex RequestInfoRegex = new(
        @"^(?:\[.+?\])+",
        RegexOptions.Compiled);

    public static ParsedMovieInfo? ParseMovieTitle(string title, bool isDir = false)
    {
        var originalTitle = title;

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

            // Trim dashes from end
            releaseTitle = releaseTitle.Trim('-', '_');

            releaseTitle = releaseTitle.Replace("【", "[").Replace("】", "]");

            foreach (var replace in ParserCommon.PreSubstitutionRegex)
            {
                if (replace.TryReplace(ref releaseTitle))
                {
                    break;
                }
            }

            var simpleTitle = SimpleTitleRegex.Replace(releaseTitle);

            // Remove website prefixes/postfixes
            simpleTitle = ParserCommon.WebsitePrefixRegex.Replace(simpleTitle);
            simpleTitle = ParserCommon.WebsitePostfixRegex.Replace(simpleTitle);
            simpleTitle = ParserCommon.CleanTorrentSuffixRegex.Replace(simpleTitle);

            // Clean quality brackets at the end
            simpleTitle = CleanQualityBracketsRegex.Replace(simpleTitle, string.Empty);

            var allRegexes = ReportMovieTitleRegex.ToList();

            if (isDir)
            {
                allRegexes.AddRange(ReportMovieTitleFolderRegex);
            }

            foreach (var regex in allRegexes)
            {
                var match = regex.Matches(simpleTitle);

                if (match.Count != 0)
                {
                    var result = ParseMovieMatchCollection(match);

                    if (result != null)
                    {
                        var simpleReleaseTitle = SimpleReleaseTitleRegex.Replace(releaseTitle, string.Empty);

                        // Parse edition if not already set
                        if (string.IsNullOrWhiteSpace(result.Edition))
                        {
                            result.Edition = ParseEdition(simpleReleaseTitle);
                        }

                        // Parse hash
                        result.ReleaseHash = GetReleaseHash(match);

                        // Parse hardcoded subs
                        result.HardcodedSubs = ParseHardcodeSubs(originalTitle);

                        // Parse IMDB/TMDB IDs
                        result.ImdbId = ParseImdbId(simpleReleaseTitle);
                        result.TmdbId = ParseTmdbId(simpleReleaseTitle);

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

    public static string? ParseImdbId(string title)
    {
        var match = ReportImdbId.Match(title);
        if (match.Success && match.Groups["imdbid"].Success)
        {
            var imdbId = match.Groups["imdbid"].Value;
            if (imdbId.Length == 9 || imdbId.Length == 10)
            {
                return imdbId;
            }
        }
        return null;
    }

    public static int ParseTmdbId(string title)
    {
        var match = ReportTmdbId.Match(title);
        if (match.Success && match.Groups["tmdbid"].Success)
        {
            if (int.TryParse(match.Groups["tmdbid"].Value, out var tmdbId))
            {
                return tmdbId;
            }
        }
        return 0;
    }

    public static string? ParseEdition(string title)
    {
        var editionMatch = ReportEditionRegex.Match(title);

        if (editionMatch.Success && editionMatch.Groups["edition"].Success &&
            !string.IsNullOrWhiteSpace(editionMatch.Groups["edition"].Value))
        {
            return editionMatch.Groups["edition"].Value.Replace(".", " ");
        }

        return null;
    }

    public static string? ParseHardcodeSubs(string title)
    {
        var subMatch = HardcodedSubsRegex.Matches(title).LastOrDefault();

        if (subMatch != null && subMatch.Success)
        {
            if (subMatch.Groups["hcsub"].Success)
            {
                return subMatch.Groups["hcsub"].Value;
            }
            else if (subMatch.Groups["hc"].Success)
            {
                return "Generic Hardcoded Subs";
            }
        }

        return null;
    }

    private static ParsedMovieInfo? ParseMovieMatchCollection(MatchCollection matchCollection)
    {
        if (!matchCollection[0].Groups["title"].Success || matchCollection[0].Groups["title"].Value == "(")
        {
            return null;
        }

        var movieName = matchCollection[0].Groups["title"].Value.Replace('_', ' ');
        movieName = NormalizeAlternativeTitleRegex.Replace(movieName, " AKA ");
        movieName = RequestInfoRegex.Replace(movieName, "").Trim(' ');

        // Handle dots in title - preserve acronyms
        var parts = movieName.Split('.');
        movieName = "";
        var n = 0;
        var previousAcronym = false;
        var nextPart = "";

        foreach (var part in parts)
        {
            if (parts.Length >= n + 2)
            {
                nextPart = parts[n + 1];
            }
            else
            {
                nextPart = "";
            }

            if (part.Length == 1 && part.ToLower() != "a" && !int.TryParse(part, out _) &&
                (previousAcronym || n < parts.Length - 1) &&
                (previousAcronym || nextPart.Length != 1 || !int.TryParse(nextPart, out _)))
            {
                movieName += part + ".";
                previousAcronym = true;
            }
            else if (part.ToLower() == "a" && (previousAcronym || nextPart.Length == 1))
            {
                movieName += part + ".";
                previousAcronym = true;
            }
            else if (part.ToLower() == "dr")
            {
                movieName += part + ".";
                previousAcronym = true;
            }
            else
            {
                if (previousAcronym)
                {
                    movieName += " ";
                    previousAcronym = false;
                }

                movieName += part + " ";
            }

            n++;
        }

        movieName = movieName.Trim(' ');

        int.TryParse(matchCollection[0].Groups["year"].Value, out var airYear);

        var result = new ParsedMovieInfo { Year = airYear };

        if (matchCollection[0].Groups["edition"].Success)
        {
            result.Edition = matchCollection[0].Groups["edition"].Value.Replace(".", " ");
        }

        var movieTitles = new List<string> { movieName };

        // Delete parentheses of the form (aka ...).
        var unbracketedName = BracketedAlternativeTitleRegex.Replace(movieName, "$1 AKA $2");

        // Split by AKA and filter out empty and duplicate names.
        var alternativeTitles = AlternativeTitleRegex
            .Split(unbracketedName)
            .Where(alternativeName => !string.IsNullOrWhiteSpace(alternativeName) && alternativeName != movieName);

        movieTitles.AddRange(alternativeTitles);

        result.MovieTitles = movieTitles;

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

    private static string? GetReleaseHash(MatchCollection matchCollection)
    {
        var hash = matchCollection[0].Groups["hash"];

        if (hash.Success)
        {
            var hashValue = hash.Value.Trim('[', ']');

            if (hashValue.Equals("1280x720"))
            {
                return null;
            }

            return hashValue;
        }

        return null;
    }
}
