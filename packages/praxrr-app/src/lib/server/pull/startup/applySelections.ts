import { arrSyncQueries, type ProfileSelection } from '$db/queries/arrSync.ts';
import { logger } from '$logger/logger.ts';
import type { StartupPullArrType, StartupPullMatchedResult, StartupPullMatchResult, StartupPullSection } from './types.ts';

export type ApplySectionReason = 'applied' | 'unchanged' | 'no_matches';

export interface ApplySectionOutcome {
	readonly written: boolean;
	readonly reason: ApplySectionReason;
	readonly count: number;
}

export interface ApplySelectionsResult {
	readonly qualityProfiles: ApplySectionOutcome;
	readonly delayProfiles: ApplySectionOutcome;
	readonly mediaManagement: ApplySectionOutcome;
	readonly metadataProfiles: ApplySectionOutcome;
}

const NO_MATCHES: ApplySectionOutcome = { written: false, reason: 'no_matches', count: 0 };

function getMatchedBySection(
	matches: readonly StartupPullMatchResult[],
	section: StartupPullSection
): StartupPullMatchedResult[] {
	return matches.filter(
		(m): m is StartupPullMatchedResult => m.section === section && m.status === 'matched'
	);
}

function selectionsEqual(a: readonly ProfileSelection[], b: readonly ProfileSelection[]): boolean {
	if (a.length !== b.length) return false;

	const sort = (x: ProfileSelection, y: ProfileSelection) => {
		if (x.databaseId !== y.databaseId) return x.databaseId - y.databaseId;
		return x.profileName.localeCompare(y.profileName);
	};

	const sortedA = [...a].sort(sort);
	const sortedB = [...b].sort(sort);

	return sortedA.every(
		(sel, i) => sel.databaseId === sortedB[i].databaseId && sel.profileName === sortedB[i].profileName
	);
}

function applyQualityProfiles(
	instanceId: number,
	matched: readonly StartupPullMatchedResult[]
): ApplySectionOutcome {
	if (matched.length === 0) return NO_MATCHES;

	const newSelections: ProfileSelection[] = matched.map((m) => ({
		databaseId: m.databaseId,
		profileName: m.matchedEntityName,
	}));

	const current = arrSyncQueries.getQualityProfilesSync(instanceId);

	if (selectionsEqual(current.selections, newSelections)) {
		return { written: false, reason: 'unchanged', count: newSelections.length };
	}

	arrSyncQueries.saveQualityProfilesSync(instanceId, newSelections, {
		trigger: current.config.trigger,
		cron: current.config.cron,
	});

	return { written: true, reason: 'applied', count: newSelections.length };
}

function applyDelayProfiles(
	instanceId: number,
	matched: readonly StartupPullMatchedResult[]
): ApplySectionOutcome {
	if (matched.length === 0) return NO_MATCHES;

	const first = matched[0];
	const current = arrSyncQueries.getDelayProfilesSync(instanceId);

	if (current.databaseId === first.databaseId && current.profileName === first.matchedEntityName) {
		return { written: false, reason: 'unchanged', count: 1 };
	}

	arrSyncQueries.saveDelayProfilesSync(instanceId, {
		databaseId: first.databaseId,
		profileName: first.matchedEntityName,
		trigger: current.trigger,
		cron: current.cron,
	});

	return { written: true, reason: 'applied', count: 1 };
}

function applyMediaManagement(
	instanceId: number,
	namingMatches: readonly StartupPullMatchedResult[],
	mediaSettingsMatches: readonly StartupPullMatchedResult[],
	qualityDefinitionsMatches: readonly StartupPullMatchedResult[]
): ApplySectionOutcome {
	const hasAny =
		namingMatches.length > 0 || mediaSettingsMatches.length > 0 || qualityDefinitionsMatches.length > 0;
	if (!hasAny) return NO_MATCHES;

	const current = arrSyncQueries.getMediaManagementSync(instanceId);

	const namingMatch = namingMatches[0];
	const mediaSettingsMatch = mediaSettingsMatches[0];
	const qualityDefinitionsMatch = qualityDefinitionsMatches[0];

	const newData = {
		namingDatabaseId: namingMatch ? namingMatch.databaseId : current.namingDatabaseId,
		namingConfigName: namingMatch ? namingMatch.matchedEntityName : current.namingConfigName,
		qualityDefinitionsDatabaseId: qualityDefinitionsMatch
			? qualityDefinitionsMatch.databaseId
			: current.qualityDefinitionsDatabaseId,
		qualityDefinitionsConfigName: qualityDefinitionsMatch
			? qualityDefinitionsMatch.matchedEntityName
			: current.qualityDefinitionsConfigName,
		mediaSettingsDatabaseId: mediaSettingsMatch
			? mediaSettingsMatch.databaseId
			: current.mediaSettingsDatabaseId,
		mediaSettingsConfigName: mediaSettingsMatch
			? mediaSettingsMatch.matchedEntityName
			: current.mediaSettingsConfigName,
		trigger: current.trigger,
		cron: current.cron,
	};

	const isUnchanged =
		newData.namingDatabaseId === current.namingDatabaseId &&
		newData.namingConfigName === current.namingConfigName &&
		newData.qualityDefinitionsDatabaseId === current.qualityDefinitionsDatabaseId &&
		newData.qualityDefinitionsConfigName === current.qualityDefinitionsConfigName &&
		newData.mediaSettingsDatabaseId === current.mediaSettingsDatabaseId &&
		newData.mediaSettingsConfigName === current.mediaSettingsConfigName;

	const count = (namingMatch ? 1 : 0) + (mediaSettingsMatch ? 1 : 0) + (qualityDefinitionsMatch ? 1 : 0);

	if (isUnchanged) {
		return { written: false, reason: 'unchanged', count };
	}

	arrSyncQueries.saveMediaManagementSync(instanceId, newData);

	return { written: true, reason: 'applied', count };
}

function applyMetadataProfiles(
	instanceId: number,
	arrType: StartupPullArrType,
	matched: readonly StartupPullMatchedResult[]
): ApplySectionOutcome {
	if (arrType !== 'lidarr') return NO_MATCHES;
	if (matched.length === 0) return NO_MATCHES;

	const first = matched[0];
	const current = arrSyncQueries.getMetadataProfilesSync(instanceId);

	if (current.databaseId === first.databaseId && current.profileName === first.matchedEntityName) {
		return { written: false, reason: 'unchanged', count: 1 };
	}

	arrSyncQueries.saveMetadataProfilesSync(instanceId, {
		databaseId: first.databaseId,
		profileName: first.matchedEntityName,
		trigger: current.trigger,
		cron: current.cron,
	});

	return { written: true, reason: 'applied', count: 1 };
}

export async function applyStartupSelections(
	instanceId: number,
	arrType: StartupPullArrType,
	matches: readonly StartupPullMatchResult[]
): Promise<ApplySelectionsResult> {
	const matchedQP = getMatchedBySection(matches, 'qualityProfiles');
	const matchedDP = getMatchedBySection(matches, 'delayProfiles');
	const matchedNaming = getMatchedBySection(matches, 'naming');
	const matchedMS = getMatchedBySection(matches, 'mediaSettings');
	const matchedQD = getMatchedBySection(matches, 'qualityDefinitions');
	const matchedMP = getMatchedBySection(matches, 'metadataProfiles');

	const qualityProfiles = applyQualityProfiles(instanceId, matchedQP);
	const delayProfiles = applyDelayProfiles(instanceId, matchedDP);
	const mediaManagement = applyMediaManagement(instanceId, matchedNaming, matchedMS, matchedQD);
	const metadataProfiles = applyMetadataProfiles(instanceId, arrType, matchedMP);

	const result: ApplySelectionsResult = {
		qualityProfiles,
		delayProfiles,
		mediaManagement,
		metadataProfiles,
	};

	await logger.debug('Startup pull selection apply result', {
		source: 'StartupPull',
		meta: {
			instanceId,
			arrType,
			qualityProfiles: `${qualityProfiles.reason} (${qualityProfiles.count})`,
			delayProfiles: `${delayProfiles.reason} (${delayProfiles.count})`,
			mediaManagement: `${mediaManagement.reason} (${mediaManagement.count})`,
			metadataProfiles: `${metadataProfiles.reason} (${metadataProfiles.count})`,
		},
	});

	return result;
}
