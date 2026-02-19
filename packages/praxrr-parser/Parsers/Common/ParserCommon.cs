using System.Text.RegularExpressions;

namespace Parser.Parsers.Common;

internal static class ParserCommon
{
    internal static readonly RegexReplace[] PreSubstitutionRegex = Array.Empty<RegexReplace>();

    // Valid TLDs - removes website prefixes like [www.example.com] or www.example.com -
    internal static readonly RegexReplace WebsitePrefixRegex = new(
        @"^(?:(?:\[|\()\s*)?(?:www\.)?[-a-z0-9-]{1,256}\.(?<!Naruto-Kun\.)(?:[a-z]{2,6}\.[a-z]{2,6}|xn--[a-z0-9-]{4,}|[a-z]{2,})\b(?:\s*(?:\]|\))|[ -]{2,})[ -]*",
        string.Empty,
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    internal static readonly RegexReplace WebsitePostfixRegex = new(
        @"(?:\[\s*)?(?:www\.)?[-a-z0-9-]{1,256}\.(?:xn--[a-z0-9-]{4,}|[a-z]{2,6})\b(?:\s*\])$",
        string.Empty,
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Removes torrent site suffixes like [ettv], [rartv], etc.
    internal static readonly RegexReplace CleanTorrentSuffixRegex = new(
        @"\[(?:ettv|rartv|rarbg|cttv|publichd)\]$",
        string.Empty,
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Common video file extensions
    private static readonly HashSet<string> VideoExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mkv", ".mp4", ".avi", ".wmv", ".mov", ".m4v", ".mpg", ".mpeg",
        ".m2ts", ".ts", ".flv", ".webm", ".vob", ".ogv", ".divx", ".xvid",
        ".3gp", ".asf", ".rm", ".rmvb", ".iso", ".img"
    };

    private static readonly HashSet<string> UsenetExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".par2", ".nzb"
    };

    private static readonly Regex FileExtensionRegex = new(
        @"\.[a-z0-9]{2,4}$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string RemoveFileExtension(string title)
    {
        return FileExtensionRegex.Replace(title, m =>
        {
            var extension = m.Value.ToLower();
            if (VideoExtensions.Contains(extension) || UsenetExtensions.Contains(extension))
            {
                return string.Empty;
            }
            return m.Value;
        });
    }
}
