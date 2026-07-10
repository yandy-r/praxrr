import { db } from '../db.ts';

/**
 * Row shape of `quality_goal_bindings` — intent metadata for a goal-governed quality profile (#20).
 * `weights_json` is a serialized `GoalWeights`. The actual scores live in `pcd_ops`, never here.
 */
export interface QualityGoalBindingRow {
  database_id: number;
  profile_name: string;
  arr_type: string;
  preset_id: string;
  weights_json: string;
  engine_version: string;
  applied_at: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertQualityGoalBindingInput {
  databaseId: number;
  profileName: string;
  arrType: 'radarr' | 'sonarr' | 'lidarr';
  presetId: string;
  weightsJson: string;
  engineVersion: string;
  appliedAt: string;
}

/** Queries for `quality_goal_bindings`, keyed by (database_id, profile_name, arr_type). */
export const qualityGoalBindingQueries = {
  /** Fetch the binding for a profile, or `undefined` if none has been applied. */
  get(databaseId: number, profileName: string, arrType: string): QualityGoalBindingRow | undefined {
    return db.queryFirst<QualityGoalBindingRow>(
      `SELECT * FROM quality_goal_bindings
			 WHERE database_id = ? AND profile_name = ? AND arr_type = ?`,
      databaseId,
      profileName,
      arrType
    );
  },

  /** Insert or replace the binding for a profile; returns the persisted row. */
  upsert(input: UpsertQualityGoalBindingInput): QualityGoalBindingRow {
    db.execute(
      `INSERT INTO quality_goal_bindings
			   (database_id, profile_name, arr_type, preset_id, weights_json, engine_version, applied_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (database_id, profile_name, arr_type) DO UPDATE SET
			   preset_id = excluded.preset_id,
			   weights_json = excluded.weights_json,
			   engine_version = excluded.engine_version,
			   applied_at = excluded.applied_at,
			   updated_at = CURRENT_TIMESTAMP`,
      input.databaseId,
      input.profileName,
      input.arrType,
      input.presetId,
      input.weightsJson,
      input.engineVersion,
      input.appliedAt
    );

    const row = this.get(input.databaseId, input.profileName, input.arrType);
    if (!row) {
      throw new Error('quality_goal_bindings upsert did not persist a row');
    }
    return row;
  },

  /** Remove a profile's binding (scores are unaffected). Returns whether a row was deleted. */
  delete(databaseId: number, profileName: string, arrType: string): boolean {
    return (
      db.execute(
        `DELETE FROM quality_goal_bindings
			   WHERE database_id = ? AND profile_name = ? AND arr_type = ?`,
        databaseId,
        profileName,
        arrType
      ) > 0
    );
  },
};
