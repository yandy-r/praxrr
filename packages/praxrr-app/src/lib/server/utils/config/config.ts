/**
 * Application configuration singleton
 */

export type AuthMode = 'on' | 'local' | 'off' | 'oidc';
export type PCDMigrationIngestionMode = 'sql-only' | 'hybrid';

class Config {
  private basePath: string;
  public readonly timezone: string;
  public readonly parserUrl: string;
  public readonly port: number;
  public readonly host: string;
  public readonly authMode: AuthMode;
  public readonly validateInstances: boolean;
  public readonly pullOnStart: boolean;
  public readonly pullOnStartMaxConcurrency: number | null;
  public readonly pullOnStartTimeoutMs: number | null;
  public readonly pcdMigrationIngestionMode: PCDMigrationIngestionMode;
  public readonly pcdMigrationAllowLegacyFallback: boolean;
  public readonly oidc: {
    discoveryUrl: string | null;
    clientId: string | null;
    clientSecret: string | null;
  };
  public readonly arrCredentialMasterKey: string | null;
  public readonly arrCredentialMasterKeyVersion: string | null;
  public readonly arrCredentialPreviousKeys: string | null;

  constructor() {
    // Default base path logic:
    // 1. Check environment variable
    // 2. Fall back to directory containing the executable
    const envPath = Deno.env.get('APP_BASE_PATH');
    if (envPath) {
      this.basePath = envPath;
    } else {
      // Use the directory where the executable is located
      const execPath = Deno.execPath();
      const lastSlash = Math.max(execPath.lastIndexOf('/'), execPath.lastIndexOf('\\'));
      this.basePath = lastSlash > 0 ? execPath.substring(0, lastSlash) : '.';
    }

    // Timezone configuration:
    // 1. Check TZ environment variable
    // 2. Fall back to system timezone
    this.timezone = Deno.env.get('TZ') || Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Parser service configuration
    const parserHost = Deno.env.get('PARSER_HOST') || 'localhost';
    const parserPort = Deno.env.get('PARSER_PORT') || '5000';
    this.parserUrl = `http://${parserHost}:${parserPort}`;

    // Server bind configuration
    this.port = parseInt(Deno.env.get('PORT') || '6868', 10);
    this.host = Deno.env.get('HOST') || '0.0.0.0';

    // Auth mode: 'on' (default), 'local', 'off', 'oidc'
    const auth = (Deno.env.get('AUTH') || 'on').toLowerCase();
    this.authMode = ['on', 'local', 'off', 'oidc'].includes(auth) ? (auth as AuthMode) : 'on';

    const rawValidateInstances = Deno.env.get('PRAXRR_VALIDATE_INSTANCES')?.trim().toLowerCase();
    this.validateInstances = ['1', 'true', 'yes', 'on'].includes(rawValidateInstances || '');
    this.pullOnStart = Config.parseBooleanEnv(Deno.env.get('PULL_ON_START'));
    this.pullOnStartMaxConcurrency = Config.parsePositiveIntEnv('PULL_ON_START_MAX_CONCURRENCY');
    this.pullOnStartTimeoutMs = Config.parsePositiveIntEnv('PULL_ON_START_TIMEOUT_MS');
    this.pcdMigrationIngestionMode = Config.parsePCDMigrationMode(Deno.env.get('PRAXRR_PCD_MIGRATION_MODE'));
    this.pcdMigrationAllowLegacyFallback = Config.parseBooleanEnv(
      Deno.env.get('PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK')
    );

    // OIDC configuration (only used when AUTH=oidc)
    this.oidc = {
      discoveryUrl: Deno.env.get('OIDC_DISCOVERY_URL') || null,
      clientId: Deno.env.get('OIDC_CLIENT_ID') || null,
      clientSecret: Deno.env.get('OIDC_CLIENT_SECRET') || null,
    };

    this.arrCredentialMasterKey = Deno.env.get('ARR_CREDENTIAL_MASTER_KEY') || null;
    this.arrCredentialMasterKeyVersion = Deno.env.get('ARR_CREDENTIAL_MASTER_KEY_VERSION') || null;
    this.arrCredentialPreviousKeys =
      Deno.env.get('ARR_CREDENTIAL_PREVIOUS_KEYS') || Deno.env.get('ARR_CREDENTIAL_MASTER_KEYS') || null;
  }

  /**
   * Get the server URL for display
   */
  get serverUrl(): string {
    const displayHost = this.host === '0.0.0.0' ? 'localhost' : this.host;
    return `http://${displayHost}:${this.port}`;
  }

  private static parseBooleanEnv(value: string | null | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized || '');
  }

  private static parsePCDMigrationMode(value: string | null | undefined): PCDMigrationIngestionMode {
    const normalized = (value ?? '').trim().toLowerCase();

    if (normalized.length === 0 || normalized === 'hybrid') {
      return 'hybrid';
    }

    if (normalized === 'sql-only') {
      return 'sql-only';
    }

    throw new Error(`Invalid value for PRAXRR_PCD_MIGRATION_MODE: "${value}". Expected "sql-only" or "hybrid".`);
  }

  private static parsePositiveIntEnv(name: string): number | null {
    const raw = Deno.env.get(name);
    if (raw === undefined) {
      return null;
    }

    const normalized = raw.trim();
    if (normalized.length === 0) {
      return null;
    }

    if (!/^\d+$/.test(normalized)) {
      throw new Error(`Invalid value for ${name}: "${raw}". Expected a positive integer.`);
    }

    const parsed = Number.parseInt(normalized, 10);
    if (parsed <= 0) {
      throw new Error(`Invalid value for ${name}: "${raw}". Expected a value greater than 0.`);
    }

    return parsed;
  }

  /**
   * Initialize the configuration (create directories)
   * Must be called before using the config
   */
  async init(): Promise<void> {
    await Deno.mkdir(this.paths.logs, { recursive: true });
    await Deno.mkdir(this.paths.data, { recursive: true });
    await Deno.mkdir(this.paths.backups, { recursive: true });
    await Deno.mkdir(this.paths.databases, { recursive: true });
  }

  /**
   * Set the base path for the application
   */
  setBasePath(path: string): void {
    this.basePath = path;
  }

  /**
   * Application paths (relative to base)
   */
  readonly paths = {
    get base(): string {
      return config.basePath;
    },
    get logs(): string {
      return `${config.basePath}/logs`;
    },
    get logFile(): string {
      return `${config.basePath}/logs/app.log`;
    },
    get data(): string {
      return `${config.basePath}/data`;
    },
    get database(): string {
      return `${config.basePath}/data/praxrr.db`;
    },
    get databases(): string {
      return `${config.basePath}/data/databases`;
    },
    get backups(): string {
      return `${config.basePath}/backups`;
    },
  };
}

export const config = new Config();
