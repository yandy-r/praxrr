using System.Text.Json;

namespace Parser.Logging;

/// <summary>
/// Logger with console and file output
/// Supports configurable settings and daily rotation
/// </summary>
public class Logger
{
    private readonly LoggerConfig _config;
    private readonly LogSettingsManager? _settings;
    private static readonly object _fileLock = new();

    public Logger(LoggerConfig? config = null, LogSettingsManager? settings = null)
    {
        _settings = settings;
        _config = config ?? _settings?.Get() ?? new LoggerConfig();
    }

    private string FormatTimestamp()
    {
        var timestamp = DateTime.UtcNow.ToString("o");
        return $"{Colors.Grey}{timestamp}{Colors.Reset}";
    }

    private string FormatLevel(LogLevel level)
    {
        var color = level switch
        {
            LogLevel.DEBUG => Colors.Cyan,
            LogLevel.INFO => Colors.Green,
            LogLevel.WARN => Colors.Yellow,
            LogLevel.ERROR => Colors.Red,
            _ => Colors.Reset
        };
        return $"{color}{level.ToString().PadRight(5)}{Colors.Reset}";
    }

    private string FormatSource(string? source)
    {
        if (string.IsNullOrEmpty(source)) return "";
        return $"{Colors.Grey}[{source}]{Colors.Reset}";
    }

    private string FormatMeta(object? meta)
    {
        if (meta == null) return "";
        return $"{Colors.Grey}{JsonSerializer.Serialize(meta)}{Colors.Reset}";
    }

    /// <summary>
    /// Get log file path with daily rotation (YYYY-MM-DD.log)
    /// </summary>
    private string GetLogFilePath()
    {
        var date = DateTime.UtcNow.ToString("yyyy-MM-dd");
        return Path.Combine(_config.LogsDir, $"{date}.log");
    }

    private bool IsEnabled()
        => _settings?.IsEnabled() ?? _config.Enabled;

    private bool IsFileLoggingEnabled()
        => _settings?.IsFileLoggingEnabled() ?? _config.FileLogging;

    private bool IsConsoleLoggingEnabled()
        => _settings?.IsConsoleLoggingEnabled() ?? _config.ConsoleLogging;

    private bool ShouldLog(LogLevel level)
    {
        if (!IsEnabled()) return false;
        var minLevel = _settings?.GetMinLevel() ?? _config.MinLevel;
        return level >= minLevel;
    }

    private void Log(LogLevel level, string message, LogOptions? options = null)
    {
        if (!ShouldLog(level)) return;

        var timestamp = DateTime.UtcNow.ToString("o");

        // Console output (colored)
        if (IsConsoleLoggingEnabled())
        {
            var parts = new List<string>
            {
                FormatTimestamp(),
                FormatLevel(level),
                message
            };

            if (!string.IsNullOrEmpty(options?.Source))
                parts.Add(FormatSource(options.Source));

            if (options?.Meta != null)
                parts.Add(FormatMeta(options.Meta));

            Console.WriteLine(string.Join(" | ", parts));
        }

        // File output (JSON)
        if (IsFileLoggingEnabled())
        {
            var logEntry = new LogEntry
            {
                Timestamp = timestamp,
                Level = level.ToString(),
                Message = message,
                Source = options?.Source,
                Meta = options?.Meta
            };

            try
            {
                // Ensure logs directory exists
                Directory.CreateDirectory(_config.LogsDir);

                var filePath = GetLogFilePath();
                var json = JsonSerializer.Serialize(logEntry) + Environment.NewLine;

                // Thread-safe file write
                lock (_fileLock)
                {
                    File.AppendAllText(filePath, json);
                }
            }
            catch (Exception ex)
            {
                // If file write fails, at least we have console output
                Console.Error.WriteLine($"Failed to write to log file: {ex.Message}");
            }
        }
    }

    public void Debug(string message, LogOptions? options = null)
        => Log(LogLevel.DEBUG, message, options);

    public void Debug(string message, string source)
        => Log(LogLevel.DEBUG, message, new LogOptions { Source = source });

    public void Info(string message, LogOptions? options = null)
        => Log(LogLevel.INFO, message, options);

    public void Info(string message, string source)
        => Log(LogLevel.INFO, message, new LogOptions { Source = source });

    public void Warn(string message, LogOptions? options = null)
        => Log(LogLevel.WARN, message, options);

    public void Warn(string message, string source)
        => Log(LogLevel.WARN, message, new LogOptions { Source = source });

    public void Error(string message, LogOptions? options = null)
        => Log(LogLevel.ERROR, message, options);

    public void Error(string message, string source)
        => Log(LogLevel.ERROR, message, new LogOptions { Source = source });

    public void Error(string message, Exception ex, LogOptions? options = null)
    {
        Log(LogLevel.ERROR, message, options);

        // Print stack trace to console
        if (ex.StackTrace != null && IsConsoleLoggingEnabled())
        {
            Console.WriteLine($"{Colors.Grey}{ex.StackTrace}{Colors.Reset}");
        }

        // Write stack trace to file
        if (ex.StackTrace != null && IsFileLoggingEnabled())
        {
            var traceEntry = new LogEntry
            {
                Timestamp = DateTime.UtcNow.ToString("o"),
                Level = "ERROR",
                Message = "Stack trace",
                Meta = new { stack = ex.StackTrace }
            };

            try
            {
                var filePath = GetLogFilePath();
                var json = JsonSerializer.Serialize(traceEntry) + Environment.NewLine;

                lock (_fileLock)
                {
                    File.AppendAllText(filePath, json);
                }
            }
            catch (Exception writeEx)
            {
                Console.Error.WriteLine($"Failed to write stack trace to log file: {writeEx.Message}");
            }
        }
    }
}

/// <summary>
/// Global logger singleton for production use
/// </summary>
public static class Log
{
    private static Logger? _instance;

    public static void Initialize(LoggerConfig? config = null, LogSettingsManager? settings = null)
    {
        _instance = new Logger(config, settings);
    }

    public static Logger Instance =>
        _instance ?? throw new InvalidOperationException("Logger not initialized. Call Initialize() first.");

    // Convenience methods that delegate to the singleton
    public static void Debug(string message, LogOptions? options = null)
        => Instance.Debug(message, options);

    public static void Debug(string message, string source)
        => Instance.Debug(message, source);

    public static void Info(string message, LogOptions? options = null)
        => Instance.Info(message, options);

    public static void Info(string message, string source)
        => Instance.Info(message, source);

    public static void Warn(string message, LogOptions? options = null)
        => Instance.Warn(message, options);

    public static void Warn(string message, string source)
        => Instance.Warn(message, source);

    public static void Error(string message, LogOptions? options = null)
        => Instance.Error(message, options);

    public static void Error(string message, string source)
        => Instance.Error(message, source);

    public static void Error(string message, Exception ex, LogOptions? options = null)
        => Instance.Error(message, ex, options);
}
