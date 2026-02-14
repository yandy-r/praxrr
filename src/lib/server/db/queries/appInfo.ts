import { db } from '../db.ts';

/**
 * Types for app_info table
 */
export interface AppInfo {
  id: number;
  version: string;
  created_at: string;
  updated_at: string;
}

/**
 * All queries for app_info table
 * Singleton pattern - only one record exists
 */
export const appInfoQueries = {
  /**
   * Get the app info (singleton)
   */
  get(): AppInfo | undefined {
    return db.queryFirst<AppInfo>('SELECT * FROM app_info WHERE id = 1');
  },

  /**
   * Get just the version string
   */
  getVersion(): string {
    const info = db.queryFirst<{ version: string }>('SELECT version FROM app_info WHERE id = 1');
    return info?.version ?? 'unknown';
  },
};
