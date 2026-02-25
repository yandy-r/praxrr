import type { OperationLayer } from '$pcd/core/types.ts';

type OperationLayerParseResult = { value: OperationLayer } | { error: string };

function isOperationLayer(value: string): value is OperationLayer {
  return value === 'base' || value === 'user';
}

export function parseOperationLayer(rawLayer: unknown): OperationLayerParseResult {
  if (rawLayer === null || rawLayer === undefined || rawLayer === '') {
    return { value: 'user' };
  }

  if (typeof rawLayer !== 'string' || !isOperationLayer(rawLayer)) {
    return { error: 'Invalid operation layer' };
  }

  return { value: rawLayer };
}
