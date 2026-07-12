import type { components } from '$api/v1.d.ts';
import { getCapability } from '$shared/plugins/capabilities.ts';
import { getExtensionPoint } from '$shared/plugins/extensionPoints.ts';

type PluginRecord = components['schemas']['PluginRecord'];
type PluginListResponse = components['schemas']['PluginListResponse'];
type PluginMutationResponse = components['schemas']['PluginMutationResponse'];
type PluginReloadResponse = components['schemas']['PluginReloadResponse'];
type PluginLifecycleState = components['schemas']['PluginLifecycleState'];

const LIFECYCLE_STATES = new Set<PluginLifecycleState>([
  'discovered',
  'validated',
  'registered',
  'rejected',
  'activated',
  'failed',
  'unloaded',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPluginRecord(value: unknown): value is PluginRecord {
  if (!isRecord(value) || !isRecord(value.manifest)) return false;

  const manifest = value.manifest;
  return (
    typeof manifest.apiVersion === 'string' &&
    typeof manifest.id === 'string' &&
    typeof manifest.name === 'string' &&
    typeof manifest.version === 'string' &&
    manifest.runtime === 'wasm' &&
    typeof manifest.entry === 'string' &&
    Array.isArray(manifest.extensionPoints) &&
    manifest.extensionPoints.every((point) => typeof point === 'string' && getExtensionPoint(point) !== undefined) &&
    Array.isArray(manifest.capabilities) &&
    manifest.capabilities.every(
      (capability) => typeof capability === 'string' && getCapability(capability) !== undefined
    ) &&
    (manifest.description === undefined || typeof manifest.description === 'string') &&
    (manifest.author === undefined || typeof manifest.author === 'string') &&
    (manifest.engines === undefined ||
      (isRecord(manifest.engines) &&
        (manifest.engines.praxrr === undefined || typeof manifest.engines.praxrr === 'string'))) &&
    typeof value.enabled === 'boolean' &&
    typeof value.discovered === 'boolean' &&
    typeof value.state === 'string' &&
    LIFECYCLE_STATES.has(value.state as PluginLifecycleState) &&
    typeof value.registeredAt === 'string' &&
    (value.lastError === null || typeof value.lastError === 'string') &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

export function isPluginListResponse(value: unknown): value is PluginListResponse {
  return (
    isRecord(value) &&
    typeof value.pluginsEnabled === 'boolean' &&
    Array.isArray(value.items) &&
    value.items.every(isPluginRecord)
  );
}

export function isPluginMutationResponse(value: unknown): value is PluginMutationResponse {
  return isRecord(value) && value.pluginsEnabled === true && isPluginRecord(value.plugin);
}

export function isPluginReloadResponse(value: unknown): value is PluginReloadResponse {
  if (!isRecord(value) || typeof value.pluginsEnabled !== 'boolean' || typeof value.reloaded !== 'boolean') {
    return false;
  }

  return ['discovered', 'registered', 'rejected', 'missing'].every((field) => {
    const count = value[field];
    return typeof count === 'number' && Number.isInteger(count) && count >= 0;
  });
}
