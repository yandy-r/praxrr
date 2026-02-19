/**
 * Logger types and interfaces
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogOptions {
  /** Optional metadata to include with the log */
  meta?: unknown;
  /** Optional source/context tag (e.g., "database", "api") */
  source?: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
  meta?: unknown;
}

/**
 * Logger configuration
 * Allows logger to run independently without config/database dependencies
 */
export interface LoggerConfig {
  /** Directory where log files will be written (e.g., "/app/logs") */
  logsDir: string;
  /** Master toggle for all logging */
  enabled?: boolean;
  /** Enable file logging */
  fileLogging?: boolean;
  /** Enable console logging */
  consoleLogging?: boolean;
  /** Minimum log level to output */
  minLevel?: LogLevel;
}
