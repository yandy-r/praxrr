import type { JobRunStatus, ArrPullStartupRunResult } from '$jobs/queueTypes.ts';
import type {
	StartupPullCounters,
	StartupPullInstanceResult,
	StartupPullRunStatus,
	StartupPullRunSummary,
} from './types.ts';

export function aggregateCounters(instances: readonly StartupPullInstanceResult[]): StartupPullCounters {
	const counters: StartupPullCounters = {
		imported: 0,
		skipped_default: 0,
		skipped_no_match: 0,
		conflicted: 0,
		failed: 0,
	};

	for (const instance of instances) {
		counters.imported += instance.imported;
		counters.skipped_default += instance.skipped_default;
		counters.skipped_no_match += instance.skipped_no_match;
		counters.conflicted += instance.conflicted;
		counters.failed += instance.failed;
	}

	return counters;
}

export function classifyRunStatus(instances: readonly StartupPullInstanceResult[]): StartupPullRunStatus {
	if (instances.length === 0) return 'skipped';

	let hasSuccess = false;
	let hasFailure = false;

	for (const instance of instances) {
		if (instance.status === 'success') hasSuccess = true;
		if (instance.status === 'failure') hasFailure = true;
	}

	if (!hasSuccess && !hasFailure) return 'skipped';
	if (hasSuccess && hasFailure) return 'partial';
	if (hasFailure) return 'failed';
	return 'success';
}

export function toJobRunStatus(runStatus: StartupPullRunStatus): JobRunStatus {
	switch (runStatus) {
		case 'success':
			return 'success';
		case 'partial':
			return 'success';
		case 'failed':
			return 'failure';
		case 'skipped':
			return 'skipped';
		case 'disabled':
			return 'skipped';
	}
}

export function buildRunSummary(
	runId: string,
	instances: readonly StartupPullInstanceResult[],
	startedAt: string,
	finishedAt: string | null
): StartupPullRunSummary {
	const counters = aggregateCounters(instances);
	const status = classifyRunStatus(instances);

	return {
		runId,
		status,
		startedAt,
		finishedAt,
		instances,
		...counters,
	};
}

export function toArrPullStartupRunResult(summary: StartupPullRunSummary): ArrPullStartupRunResult {
	return {
		runId: summary.runId,
		status: toJobRunStatus(summary.status),
		startedAt: summary.startedAt,
		finishedAt: summary.finishedAt,
		instances: summary.instances.map((instance) => ({
			instanceId: instance.instanceId,
			instanceName: instance.instanceName,
			status: instance.status,
			imported: instance.imported,
			skipped_default: instance.skipped_default,
			skipped_no_match: instance.skipped_no_match,
			conflicted: instance.conflicted,
			failed: instance.failed,
		})),
		imported: summary.imported,
		skipped_default: summary.skipped_default,
		skipped_no_match: summary.skipped_no_match,
		conflicted: summary.conflicted,
		failed: summary.failed,
	};
}
