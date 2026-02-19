using System.Text.RegularExpressions;

namespace Parser.Parsers.Common;

public class RegexReplace
{
    private readonly Regex _regex;
    private readonly string _replacementFormat;

    public RegexReplace(string pattern, string replacement, RegexOptions regexOptions)
    {
        _regex = new Regex(pattern, regexOptions);
        _replacementFormat = replacement;
    }

    public string Replace(string input)
    {
        return _regex.Replace(input, _replacementFormat);
    }

    public bool TryReplace(ref string input)
    {
        var result = _regex.IsMatch(input);
        input = _regex.Replace(input, _replacementFormat);
        return result;
    }
}
