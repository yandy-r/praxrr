namespace Parser.Logging;

/// <summary>
/// Log severity levels (DEBUG -> INFO -> WARN -> ERROR)
/// </summary>
public enum LogLevel
{
    DEBUG,
    INFO,
    WARN,
    ERROR
}

/// <summary>
/// Options for a single log call
/// </summary>
public class LogOptions
{
    /// <summary>
    /// Optional source/context tag (e.g., "Parser", "Quality", "Language")
    /// </summary>
    public string? Source { get; set; }

    /// <summary>
    /// Optional metadata to include with the log
    /// </summary>
    public object? Meta { get; set; }
}

/// <summary>
/// A single log entry (used for JSON file output)
/// </summary>
public class LogEntry
{
    public required string Timestamp { get; set; }
    public required string Level { get; set; }
    public required string Message { get; set; }
    public string? Source { get; set; }
    public object? Meta { get; set; }
}

/// <summary>
/// Logger configuration
/// </summary>
public class LoggerConfig
{
    /// <summary>
    /// Directory where log files will be written
    /// </summary>
    public string LogsDir { get; set; } = "/tmp/logs";

    /// <summary>
    /// Master toggle for all logging
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Enable file logging
    /// </summary>
    public bool FileLogging { get; set; } = true;

    /// <summary>
    /// Enable console logging
    /// </summary>
    public bool ConsoleLogging { get; set; } = true;

    /// <summary>
    /// Minimum log level to output
    /// </summary>
    public LogLevel MinLevel { get; set; } = LogLevel.INFO;
}
