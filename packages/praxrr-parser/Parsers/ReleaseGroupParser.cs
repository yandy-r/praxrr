using System.Text.RegularExpressions;
using Parser.Parsers.Common;

namespace Parser.Parsers;

public static class ReleaseGroupParser
{
    private static readonly Regex ReleaseGroupRegex = new(
        @"-(?<releasegroup>[a-z0-9]+(?<part2>-[a-z0-9]+)?(?!.+?(?:480p|576p|720p|1080p|2160p)))(?<!(?:WEB-(DL|Rip)|Blu-Ray|480p|576p|720p|1080p|2160p|DTS-HD|DTS-X|DTS-MA|DTS-ES|-ES|-EN|-CAT|-ENG|-JAP|-GER|-FRA|-FRE|-ITA|-HDRip|\d{1,2}-bit|[ ._]\d{4}-\d{2}|-\d{2}|tmdb(id)?-(?<tmdbid>\d+)|(?<imdbid>tt\d{7,8}))(?:\k<part2>)?)(?:\b|[-._ ]|$)|[-._ ]\[(?<releasegroup>[a-z0-9]+)\]$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex InvalidReleaseGroupRegex = new(
        @"^([se]\d+|[0-9a-f]{8})$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex AnimeReleaseGroupRegex = new(
        @"^(?:\[(?<subgroup>(?!\s).+?(?<!\s))\](?:_|-|\s|\.)?)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Handle Exception Release Groups that don't follow -RlsGrp pattern
    private static readonly Regex ExceptionReleaseGroupRegexExact = new(
        @"\b(?<releasegroup>KRaLiMaRKo|E\.N\.D|D\-Z0N3|Koten_Gars|BluDragon|ZØNEHD|HQMUX|VARYG|YIFY|YTS(.(MX|LT|AG))?|TMd|Eml HDTeam|LMain|DarQ|BEN THE MEN|TAoE|QxR|126811)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Groups whose releases end with RlsGroup) or RlsGroup]
    private static readonly Regex ExceptionReleaseGroupRegex = new(
        @"(?<=[._ \[])(?<releasegroup>(Silence|afm72|Panda|Ghost|MONOLITH|Tigole|Joy|ImE|UTR|t3nzin|Anime Time|Project Angel|Hakata Ramen|HONE|GiLG|Vyndros|SEV|Garshasp|Kappa|Natty|RCVR|SAMPA|YOGI|r00t|EDGE2020|RZeroX|FreetheFish|Anna|Bandi|Qman|theincognito|HDO|DusIctv|DHD|CtrlHD|-ZR-|ADC|XZVN|RH|Kametsu)(?=\]|\)))",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly RegexReplace CleanReleaseGroupRegex = new(
        @"(-(RP|1|NZBGeek|Obfuscated|Obfuscation|Scrambled|sample|Pre|postbot|xpost|Rakuv[a-z0-9]*|WhiteRev|BUYMORE|AsRequested|AlternativeToRequested|GEROV|Z0iDS3N|Chamele0n|4P|4Planet|AlteZachen|RePACKPOST))+$",
        string.Empty,
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string? ParseReleaseGroup(string title)
    {
        title = title.Trim();
        title = ParserCommon.RemoveFileExtension(title);

        foreach (var replace in ParserCommon.PreSubstitutionRegex)
        {
            if (replace.TryReplace(ref title))
            {
                break;
            }
        }

        title = ParserCommon.WebsitePrefixRegex.Replace(title);
        title = ParserCommon.CleanTorrentSuffixRegex.Replace(title);

        // Check for anime-style release groups [SubGroup]
        var animeMatch = AnimeReleaseGroupRegex.Match(title);
        if (animeMatch.Success)
        {
            return animeMatch.Groups["subgroup"].Value;
        }

        title = CleanReleaseGroupRegex.Replace(title);

        // Check exception groups (exact match)
        var exceptionExactMatches = ExceptionReleaseGroupRegexExact.Matches(title);
        if (exceptionExactMatches.Count != 0)
        {
            return exceptionExactMatches.Last().Groups["releasegroup"].Value;
        }

        // Check exception groups (pattern match)
        var exceptionMatches = ExceptionReleaseGroupRegex.Matches(title);
        if (exceptionMatches.Count != 0)
        {
            return exceptionMatches.Last().Groups["releasegroup"].Value;
        }

        // Standard release group pattern
        var matches = ReleaseGroupRegex.Matches(title);
        if (matches.Count != 0)
        {
            var group = matches.Last().Groups["releasegroup"].Value;

            // Filter out numeric-only groups
            if (int.TryParse(group, out _))
            {
                return null;
            }

            // Filter out invalid patterns (like S01, E05, hex hashes)
            if (InvalidReleaseGroupRegex.IsMatch(group))
            {
                return null;
            }

            return group;
        }

        return null;
    }
}
