/**
 * Types for settings/general components
 */

export interface LogSettings {
  retention_days: number;
  min_level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  enabled: boolean;
  file_logging: boolean;
  console_logging: boolean;
}

export interface BackupSettings {
  schedule: string;
  retention_days: number;
  enabled: boolean;
  include_database: boolean;
  compression_enabled: boolean;
}

export interface AISettings {
  enabled: boolean;
  api_url: string;
  api_key: string;
  model: string;
}

export interface TMDBSettings {
  api_key: string;
}

export interface GeneralSettings {
  apply_default_delay_profiles: boolean;
}
