/**
 * Custom format syncer
 * Syncs custom formats from PCD to arr instances
 *
 * This is a helper syncer used by quality profiles - custom formats must be
 * synced before quality profiles since profiles reference format IDs.
 *
 * Each database's CFs are suffixed with an invisible namespace character
 * so multiple databases can coexist in the same arr instance.
 */

import type { BaseArrClient } from '$arr/base.ts';
import { logger } from '$logger/logger.ts';
import type { SyncArrType } from '../mappings.ts';
import {
  type ArrCustomFormat,
  transformCustomFormatWithDiagnostics,
  type PcdCustomFormat,
} from './transformer.ts';

interface PreparedCustomFormat {
  readonly pcdName: string;
  readonly arrFormat: ArrCustomFormat;
}

interface PreparedCustomFormatResult {
  readonly preparedFormats: readonly PreparedCustomFormat[];
  readonly pcdFormatIdMap: Map<string, number>;
}

interface CompileCustomFormatsOptions {
  readonly includeSyntheticIds?: boolean;
}

async function buildCustomFormatPayloads(
  client: BaseArrClient,
  instanceId: number,
  instanceType: SyncArrType,
  pcdFormats: Map<string, PcdCustomFormat>,
  suffix: string,
  options: CompileCustomFormatsOptions = {}
): Promise<PreparedCustomFormatResult> {
  const existingFormats = await client.getCustomFormats();
  const existingMap = new Map(existingFormats.map((format) => [format.name, format.id!]));

  const preparedFormats: PreparedCustomFormat[] = [];
  const pcdFormatIdMap = new Map<string, number>();
  let syntheticId = -1;

  for (const [pcdName, pcdFormat] of pcdFormats) {
    const transformed = transformCustomFormatWithDiagnostics(pcdFormat, instanceType);
    const arrFormat = transformed.format;
    const suffixedName = pcdName + suffix;
    arrFormat.name = suffixedName;

    if (instanceType === 'lidarr' && transformed.skippedConditions.length > 0) {
      await logger.warn('Skipping unsupported Lidarr custom format conditions', {
        source: 'Sync:CustomFormats',
        meta: {
          instanceId,
          pcdName,
          suffixedName,
          skippedConditions: transformed.skippedConditions,
        },
      });
    }

    if (instanceType === 'lidarr' && pcdFormat.conditions.length > 0 && arrFormat.specifications.length === 0) {
      await logger.warn('Skipping Lidarr custom format with no supported conditions', {
        source: 'Sync:CustomFormats',
        meta: {
          instanceId,
          pcdName,
          suffixedName,
          conditionCount: pcdFormat.conditions.length,
        },
      });
      continue;
    }

    const existingId = existingMap.get(suffixedName);
    if (existingId !== undefined) {
      arrFormat.id = existingId;
      pcdFormatIdMap.set(pcdName, existingId);
    } else if (options.includeSyntheticIds) {
      arrFormat.id = syntheticId;
      pcdFormatIdMap.set(pcdName, syntheticId);
      syntheticId -= 1;
    }

    preparedFormats.push({
      pcdName,
      arrFormat,
    });
  }

  return { preparedFormats, pcdFormatIdMap };
}

/**
 * Prepare custom format payloads and synthetic IDs for preview generation only.
 */
export async function previewCustomFormats(
  client: BaseArrClient,
  instanceId: number,
  instanceType: SyncArrType,
  pcdFormats: Map<string, PcdCustomFormat>,
  suffix: string
): Promise<PreparedCustomFormatResult> {
  return buildCustomFormatPayloads(client, instanceId, instanceType, pcdFormats, suffix, {
    includeSyntheticIds: true,
  });
}

/**
 * Sync custom formats for a single database to an arr instance.
 *
 * @param suffix - Zero-width namespace suffix for this database
 * @returns Map of PCD format name (unsuffixed) → arr format ID.
 *          The caller uses this to resolve CF scores in quality profiles.
 */
export async function syncCustomFormats(
  client: BaseArrClient,
  instanceId: number,
  instanceType: SyncArrType,
  pcdFormats: Map<string, PcdCustomFormat>,
  suffix: string
): Promise<Map<string, number>> {
  const { preparedFormats, pcdFormatIdMap } = await buildCustomFormatPayloads(
    client,
    instanceId,
    instanceType,
    pcdFormats,
    suffix
  );

  for (const { pcdName, arrFormat } of preparedFormats) {
    await logger.debug(`Compiled custom format "${pcdName}" (suffixed)`, {
      source: 'Compile:CustomFormat',
      meta: {
        instanceId,
        pcdName,
        format: arrFormat,
      },
    });

    try {
      if (arrFormat.id !== undefined) {
        // Update existing
        await client.updateCustomFormat(arrFormat.id, arrFormat);
        pcdFormatIdMap.set(pcdName, arrFormat.id);
        await logger.debug(`Updated custom format "${pcdName}"`, {
          source: 'Sync:CustomFormats',
          meta: { instanceId, formatId: arrFormat.id, pcdName, suffixedName: arrFormat.name },
        });
      } else {
        // Create new
        const response = await client.createCustomFormat(arrFormat);
        pcdFormatIdMap.set(pcdName, response.id!);
        await logger.debug(`Created custom format "${pcdName}"`, {
          source: 'Sync:CustomFormats',
          meta: { instanceId, formatId: response.id, pcdName, suffixedName: arrFormat.name },
        });
      }
    } catch (error) {
      const errorDetails = extractErrorDetails(error);
      await logger.error(`Failed to sync custom format "${pcdName}"`, {
        source: 'Sync:CustomFormats',
        meta: {
          instanceId,
          pcdName,
          suffixedName: arrFormat.name,
          request: arrFormat,
          ...errorDetails,
        },
      });
    }
  }

  return pcdFormatIdMap;
}

/**
 * Extract error details from HTTP errors for logging
 */
function extractErrorDetails(error: unknown): Record<string, unknown> {
  const details: Record<string, unknown> = {
    error: error instanceof Error ? error.message : 'Unknown error',
  };

  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if ('status' in err) details.status = err.status;
    if ('statusText' in err) details.statusText = err.statusText;
    if ('response' in err) details.response = err.response;
    if ('body' in err) details.responseBody = err.body;
    if ('data' in err) details.responseData = err.data;
    if (err.cause) details.cause = err.cause;
  }

  return details;
}
