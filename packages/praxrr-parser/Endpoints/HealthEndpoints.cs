using Parser.Logging;

namespace Parser.Endpoints;

public static class HealthEndpoints
{
    public static void Map(WebApplication app, string version)
    {
        app.MapGet("/health", () =>
        {
            Log.Debug("Health check requested", "Health");
            return Results.Ok(new { status = "healthy", version });
        });
    }
}
