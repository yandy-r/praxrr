import type { ArrAppType } from '$shared/arr/capabilities.ts';
import type { EntityType } from '$shared/pcd/portable.ts';

export const QUALITY_DEFINITIONS_MISSING_NAME_ERROR = 'Missing quality definitions config name';

const SUPPORTED_QUALITY_DEFINITION_ARR_TYPES = ['radarr', 'sonarr', 'lidarr'] as const satisfies readonly ArrAppType[];

export function isSupportedQualityDefinitionsArrType(arrType: string): arrType is ArrAppType {
	return SUPPORTED_QUALITY_DEFINITION_ARR_TYPES.includes(arrType as ArrAppType);
}

export function resolveQualityDefinitionsEntityType(arrType: string): EntityType | null {
	if (!isSupportedQualityDefinitionsArrType(arrType)) {
		return null;
	}

	return `${arrType}_quality_definitions` as EntityType;
}

export function formatUnknownQualityDefinitionsTypeError(arrTypeLabel: string): string {
	return `Unknown quality definitions type "${arrTypeLabel}"`;
}

type QualityDefinitionsActionValidationSuccess = {
	ok: true;
	name: string;
	arrType: ArrAppType;
	entityType: EntityType;
};

type QualityDefinitionsActionValidationFailure = {
	ok: false;
	error: string;
};

export type QualityDefinitionsActionValidationResult =
	| QualityDefinitionsActionValidationSuccess
	| QualityDefinitionsActionValidationFailure;

export function validateQualityDefinitionsActionInput(input: {
	name: string | null | undefined;
	arrType: string;
	arrTypeLabel: string;
}): QualityDefinitionsActionValidationResult {
	const name = input.name?.trim() ?? '';
	if (!name) {
		return { ok: false, error: QUALITY_DEFINITIONS_MISSING_NAME_ERROR };
	}

	if (!isSupportedQualityDefinitionsArrType(input.arrType)) {
		return { ok: false, error: formatUnknownQualityDefinitionsTypeError(input.arrTypeLabel) };
	}

	const entityType = resolveQualityDefinitionsEntityType(input.arrType);
	if (!entityType) {
		return { ok: false, error: formatUnknownQualityDefinitionsTypeError(input.arrTypeLabel) };
	}

	return {
		ok: true,
		name,
		arrType: input.arrType,
		entityType
	};
}
