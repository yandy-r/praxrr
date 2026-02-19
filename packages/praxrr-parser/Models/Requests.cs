namespace Parser.Models;

public record ParseRequest(string Title, string? Type);

public record MatchRequest(string Text, List<string> Patterns);

public record BatchMatchRequest(List<string> Texts, List<string> Patterns);
