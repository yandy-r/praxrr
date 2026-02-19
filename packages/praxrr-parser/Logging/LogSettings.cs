using Microsoft.Extensions.Configuration;

namespace Parser.Logging;

/// <summary>
/// Log settings manager
/// Loads configuration from appsettings.json and environment variables
/// </summary>
public class LogSettingsManager
{
    private LoggerConfig _config;
    private readonly IConfiguration? _configuration;

    public LogSettingsManager(IConfiguration? configuration = null)
    {
        _configuration = configuration;
        _config = LoadConfig();
    }

    /// <summary>
    /// Load settings from configuration
    /// </summary>
    private LoggerConfig LoadConfig()
    {
        var config = new LoggerConfig();

        if (_configuration != null)
        {
            var section = _configuration.GetSection("ParserLogging");

            config.LogsDir = section["LogsDir"] ?? GetEnvOrDefault("PARSER_LOGS_DIR", "/tmp/parser-logs");
            config.Enabled = ParseBool(section["Enabled"], GetEnvBool("PARSER_LOG_ENABLED", true));
            config.FileLogging = ParseBool(section["FileLogging"], GetEnvBool("PARSER_LOG_FILE", true));
            config.ConsoleLogging = ParseBool(section["ConsoleLogging"], GetEnvBool("PARSER_LOG_CONSOLE", true));
            config.MinLevel = ParseLogLevel(section["MinLevel"], GetEnvLogLevel("PARSER_LOG_LEVEL", LogLevel.INFO));
        }
        else
        {
            // Fallback to environment variables only
            config.LogsDir = GetEnvOrDefault("PARSER_LOGS_DIR", "/tmp/parser-logs");
            config.Enabled = GetEnvBool("PARSER_LOG_ENABLED", true);
            config.FileLogging = GetEnvBool("PARSER_LOG_FILE", true);
            config.ConsoleLogging = GetEnvBool("PARSER_LOG_CONSOLE", true);
            config.MinLevel = GetEnvLogLevel("PARSER_LOG_LEVEL", LogLevel.INFO);
        }

        return config;
    }

    /// <summary>
    /// Reload settings from configuration
    /// </summary>
    public void Reload()
    {
        _config = LoadConfig();
    }

    /// <summary>
    /// Get current configuration
    /// </summary>
    public LoggerConfig Get() => _config;

    /// <summary>
    /// Check if logging is enabled
    /// </summary>
    public bool IsEnabled() => _config.Enabled;

    /// <summary>
    /// Check if file logging is enabled
    /// </summary>
    public bool IsFileLoggingEnabled() => _config.FileLogging;

    /// <summary>
    /// Check if console logging is enabled
    /// </summary>
    public bool IsConsoleLoggingEnabled() => _config.ConsoleLogging;

    /// <summary>
    /// Get minimum log level
    /// </summary>
    public LogLevel GetMinLevel() => _config.MinLevel;

    /// <summary>
    /// Check if a log level should be logged based on minimum level
    /// </summary>
    public bool ShouldLog(LogLevel level)
    {
        if (!IsEnabled()) return false;
        return level >= _config.MinLevel;
    }

    // Helper methods for parsing config values
    private static string GetEnvOrDefault(string key, string defaultValue)
        => Environment.GetEnvironmentVariable(key) ?? defaultValue;

    private static bool GetEnvBool(string key, bool defaultValue)
    {
        var value = Environment.GetEnvironmentVariable(key);
        if (string.IsNullOrEmpty(value)) return defaultValue;
        return value.Equals("true", StringComparison.OrdinalIgnoreCase) ||
               value.Equals("1", StringComparison.OrdinalIgnoreCase);
    }

    private static LogLevel GetEnvLogLevel(string key, LogLevel defaultValue)
    {
        var value = Environment.GetEnvironmentVariable(key);
        if (string.IsNullOrEmpty(value)) return defaultValue;
        return Enum.TryParse<LogLevel>(value, true, out var level) ? level : defaultValue;
    }

    private static bool ParseBool(string? value, bool defaultValue)
    {
        if (string.IsNullOrEmpty(value)) return defaultValue;
        return value.Equals("true", StringComparison.OrdinalIgnoreCase) ||
               value.Equals("1", StringComparison.OrdinalIgnoreCase);
    }

    private static LogLevel ParseLogLevel(string? value, LogLevel defaultValue)
    {
        if (string.IsNullOrEmpty(value)) return defaultValue;
        return Enum.TryParse<LogLevel>(value, true, out var level) ? level : defaultValue;
    }
}

/// <summary>
/// Singleton instance for global access
/// </summary>
public static class LogSettings
{
    private static LogSettingsManager? _instance;

    public static void Initialize(IConfiguration? configuration = null)
    {
        _instance = new LogSettingsManager(configuration);
    }

    public static LogSettingsManager Instance =>
        _instance ?? throw new InvalidOperationException("LogSettings not initialized. Call Initialize() first.");
}
