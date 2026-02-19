using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Parser.Logging;
using Parser.Models;

namespace Parser.Endpoints;

public static class MatchEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/match", HandleMatch);
        app.MapPost("/match/batch", HandleBatchMatch);
    }

    private static IResult HandleMatch(MatchRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Text))
        {
            Log.Debug("Match request rejected: missing text", "Match");
            return Results.BadRequest(new { error = "Text is required" });
        }

        if (request.Patterns == null || request.Patterns.Count == 0)
        {
            Log.Debug("Match request rejected: no patterns", "Match");
            return Results.BadRequest(new { error = "At least one pattern is required" });
        }

        Log.Info($"Matching {request.Patterns.Count} patterns against text", "Match");

        var results = new Dictionary<string, bool>();

        foreach (var pattern in request.Patterns)
        {
            try
            {
                var regex = new Regex(
                    pattern,
                    RegexOptions.IgnoreCase,
                    TimeSpan.FromMilliseconds(100) // Timeout to prevent ReDoS
                );
                results[pattern] = regex.IsMatch(request.Text);
            }
            catch (RegexMatchTimeoutException)
            {
                Log.Warn($"Pattern timed out: {pattern}", "Match");
                results[pattern] = false;
            }
            catch (ArgumentException ex)
            {
                Log.Debug($"Invalid regex pattern: {pattern} - {ex.Message}", "Match");
                results[pattern] = false;
            }
        }

        return Results.Ok(new MatchResponse { Results = results });
    }

    private static IResult HandleBatchMatch(BatchMatchRequest request)
    {
        if (request.Texts == null || request.Texts.Count == 0)
        {
            Log.Debug("Batch match request rejected: no texts", "Match");
            return Results.BadRequest(new { error = "At least one text is required" });
        }

        if (request.Patterns == null || request.Patterns.Count == 0)
        {
            Log.Debug("Batch match request rejected: no patterns", "Match");
            return Results.BadRequest(new { error = "At least one pattern is required" });
        }

        Log.Info($"Batch matching {request.Patterns.Count} patterns against {request.Texts.Count} texts", "Match");

        // Pre-compile all regexes once
        var compiledPatterns = new Dictionary<string, Regex?>();
        foreach (var pattern in request.Patterns)
        {
            try
            {
                compiledPatterns[pattern] = new Regex(
                    pattern,
                    RegexOptions.IgnoreCase | RegexOptions.Compiled,
                    TimeSpan.FromMilliseconds(100)
                );
            }
            catch (ArgumentException ex)
            {
                Log.Debug($"Invalid regex pattern: {pattern} - {ex.Message}", "Match");
                compiledPatterns[pattern] = null; // Invalid pattern
            }
        }

        // Process texts in parallel for better performance
        var results = new ConcurrentDictionary<string, Dictionary<string, bool>>();

        Parallel.ForEach(request.Texts, text =>
        {
            var textResults = new Dictionary<string, bool>();
            foreach (var (pattern, regex) in compiledPatterns)
            {
                if (regex == null)
                {
                    textResults[pattern] = false;
                    continue;
                }

                try
                {
                    textResults[pattern] = regex.IsMatch(text);
                }
                catch (RegexMatchTimeoutException)
                {
                    textResults[pattern] = false;
                }
            }
            results[text] = textResults;
        });

        return Results.Ok(new BatchMatchResponse { Results = results.ToDictionary(kvp => kvp.Key, kvp => kvp.Value) });
    }
}
