import type { components } from '$api/v1.d.ts';
import { getCapability } from '$shared/plugins/capabilities.ts';
import { getExtensionPoint } from '$shared/plugins/extensionPoints.ts';

export type PluginRecord = components['schemas']['PluginRecord'];
export type PluginListResponse = components['schemas']['PluginListResponse'];
export type PluginMutationResponse = components['schemas']['PluginMutationResponse'];
export type PluginReloadResponse = components['schemas']['PluginReloadResponse'];
export type PluginErrorResponse = components['schemas']['PluginErrorResponse'];
export type PluginLifecycleState = components['schemas']['PluginLifecycleState'];
export type PluginCapabilityId = components['schemas']['PluginCapabilityId'];
export type PluginExtensionPointId = components['schemas']['PluginExtensionPointId'];
export type PluginMutationAction = 'enable' | 'disable';

export interface LifecyclePresentation {
  label: string;
  description: string;
  tone: 'neutral' | 'info' | 'warning' | 'danger';
}

export interface DiscoveryPresentation {
  label: string;
  description: string;
  present: boolean;
}

export interface EnablementIntentPresentation {
  label: string;
  description: string;
  action: PluginMutationAction;
  actionLabel: string;
}

export interface CapabilityPresentation {
  id: PluginCapabilityId;
  label: string;
  description: string;
  mutates: false;
  touchesSecrets: false;
  compatiblePoints: readonly PluginExtensionPointId[];
}

export interface ExtensionPointPresentation {
  id: PluginExtensionPointId;
  kind: 'observe' | 'transform' | 'provider';
  wired: boolean;
  wiringLabel: 'Wired' | 'Declared, not wired';
  mutates: boolean;
  requiredCapability: PluginCapabilityId | null;
}

export interface ExecutionTelemetryPresentation {
  available: false;
  label: 'Execution telemetry unavailable in this build';
  description: string;
}

const EXECUTION_TELEMETRY: ExecutionTelemetryPresentation = {
  available: false,
  label: 'Execution telemetry unavailable in this build',
  description: 'The management API does not expose runtime availability, recent executions, results, or durations.',
};

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCaseInsensitive(left: string, right: string): number {
  return compareText(left.toLowerCase(), right.toLowerCase()) || compareText(left, right);
}

function unsupportedCatalogValue(kind: 'capability' | 'extension point', id: string): never {
  throw new Error(`Unsupported plugin ${kind}: ${id}`);
}

/**
 * Build the durable registry identity used for pending state and row replacement.
 * JSON tuple encoding keeps namespace boundaries collision-safe without changing authored values.
 */
export function pluginIdentityKey(plugin: Pick<PluginRecord, 'manifest'>): string {
  return JSON.stringify([plugin.manifest.apiVersion, plugin.manifest.id.toLowerCase()]);
}

/** Build a relative mutation URL while preserving and independently encoding both identity segments. */
export function pluginMutationUrl(plugin: Pick<PluginRecord, 'manifest'>, action: PluginMutationAction): string {
  const apiVersion = encodeURIComponent(plugin.manifest.apiVersion);
  const id = encodeURIComponent(plugin.manifest.id);
  return `/api/v1/plugins/${apiVersion}/${id}/${action}`;
}

/** Return a copy ordered by discovery, authored name, then exact namespace-qualified identity. */
export function sortPluginsForPresentation(items: readonly PluginRecord[]): PluginRecord[] {
  return [...items].sort((left, right) => {
    if (left.discovered !== right.discovered) return left.discovered ? -1 : 1;

    return (
      compareCaseInsensitive(left.manifest.name, right.manifest.name) ||
      compareText(left.manifest.apiVersion, right.manifest.apiVersion) ||
      compareCaseInsensitive(left.manifest.id, right.manifest.id)
    );
  });
}

/** Describe discovery without implying installation, activation, or execution. */
export function discoveryPresentation(plugin: Pick<PluginRecord, 'discovered'>): DiscoveryPresentation {
  return plugin.discovered
    ? {
        label: 'Present',
        description: 'Present in the latest successfully reconciled scan.',
        present: true,
      }
    : {
        label: 'Missing from latest scan',
        description: 'Retained durable intent and history for a plugin that was not rediscovered.',
        present: false,
      };
}

/** Describe persisted operator intent independently from lifecycle or runtime evidence. */
export function enablementIntentPresentation(
  plugin: Pick<PluginRecord, 'enabled' | 'discovered'>
): EnablementIntentPresentation {
  if (plugin.enabled) {
    return {
      label: plugin.discovered ? 'Enabled for future dispatch' : 'Enabled when rediscovered',
      description: plugin.discovered
        ? 'Persisted administrator intent; this does not assert activation or execution.'
        : 'Persisted administrator intent will apply when the plugin is rediscovered.',
      action: 'disable',
      actionLabel: plugin.discovered ? 'Disable plugin' : 'Disable when rediscovered',
    };
  }

  return {
    label: plugin.discovered ? 'Disabled' : 'Disabled when rediscovered',
    description: plugin.discovered
      ? 'Persisted administrator intent prevents future dispatch.'
      : 'Persisted disabled intent will apply when the plugin is rediscovered.',
    action: 'enable',
    actionLabel: plugin.discovered ? 'Enable plugin' : 'Enable when rediscovered',
  };
}

/** Map every closed lifecycle value to language that does not claim current execution health. */
export function lifecyclePresentation(state: PluginLifecycleState): LifecyclePresentation {
  switch (state) {
    case 'discovered':
      return {
        label: 'Discovered',
        description: 'The manifest was found; runtime availability and execution are not evidenced.',
        tone: 'neutral',
      };
    case 'validated':
      return {
        label: 'Validated',
        description: 'The manifest passed validation; runtime availability and execution are not evidenced.',
        tone: 'info',
      };
    case 'registered':
      return {
        label: 'Registered',
        description: 'Validated metadata is registered; this does not prove activation or execution.',
        tone: 'info',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        description: 'The last recorded lifecycle transition rejected the plugin.',
        tone: 'danger',
      };
    case 'activated':
      return {
        label: 'Activated',
        description: 'The last recorded lifecycle state is activated; current runtime status is not evidenced.',
        tone: 'info',
      };
    case 'failed':
      return {
        label: 'Failed',
        description: 'The last recorded lifecycle transition failed; this is not a recent run result.',
        tone: 'danger',
      };
    case 'unloaded':
      return {
        label: 'Unloaded',
        description: 'The plugin is not loaded; current or recent execution is not evidenced.',
        tone: 'neutral',
      };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/** Resolve grants only through the client-safe capability catalog; unknown values fail closed. */
export function capabilityPresentations(plugin: Pick<PluginRecord, 'manifest'>): CapabilityPresentation[] {
  return plugin.manifest.capabilities.map((id) => {
    const descriptor = getCapability(id);
    if (!descriptor) return unsupportedCatalogValue('capability', id);

    return {
      id: descriptor.id,
      label: descriptor.label,
      description: descriptor.description,
      mutates: descriptor.mutates,
      touchesSecrets: descriptor.touchesSecrets,
      compatiblePoints: descriptor.compatiblePoints,
    };
  });
}

/** Resolve declarations and host wiring only through the extension-point catalog. */
export function extensionPointPresentations(plugin: Pick<PluginRecord, 'manifest'>): ExtensionPointPresentation[] {
  return plugin.manifest.extensionPoints.map((id) => {
    const descriptor = getExtensionPoint(id);
    if (!descriptor) return unsupportedCatalogValue('extension point', id);

    return {
      id: descriptor.id,
      kind: descriptor.kind,
      wired: descriptor.wired,
      wiringLabel: descriptor.wired ? 'Wired' : 'Declared, not wired',
      mutates: descriptor.mutates,
      requiredCapability: descriptor.requiredCapability,
    };
  });
}

/** The current portable contract exposes no execution fields; never derive them from a record. */
export function executionTelemetryPresentation(): ExecutionTelemetryPresentation {
  return EXECUTION_TELEMETRY;
}
