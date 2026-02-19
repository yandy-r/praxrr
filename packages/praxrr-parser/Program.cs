using Parser.Endpoints;
using Parser.Logging;

var builder = WebApplication.CreateBuilder(args);

// Load configuration
builder.Configuration.AddJsonFile("appsettings.json", optional: true, reloadOnChange: true);

// Get parser version from config
var parserVersion = builder.Configuration["Parser:Version"] ?? "1.0.0";

// Initialize logging
LogSettings.Initialize(builder.Configuration);
Log.Initialize(settings: LogSettings.Instance);

builder.Services.AddEndpointsApiExplorer();

var app = builder.Build();

// Get the URL the server will listen on
var urls = app.Urls.Any() ? app.Urls.First() : "http://localhost:5000";

// Log startup info
Startup.LogContainerConfig();
Startup.LogServerInfo(parserVersion, urls);

// Map endpoints
ParseEndpoints.Map(app);
MatchEndpoints.Map(app);
HealthEndpoints.Map(app, parserVersion);

app.Run();
