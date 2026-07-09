import { db } from '../db.ts';
import { sqliteUtcToIso } from '$lib/server/timeline/time.ts';
import type { TimelineAnnotation, TimelineSource } from '$lib/server/timeline/types.ts';

/**
 * Query module for timeline_annotations (issue #27) — the only persisted timeline state.
 *
 * Annotations hold a SOFT (event_source, event_id) reference into one of the four source tables;
 * there is no cross-table FK, so a note is never cascaded away when its source event is
 * retention-pruned. `pruneOrphans` exists for completeness but is intentionally not wired into
 * any cleanup job: preserving the "why" of a pruned event is the point of an archaeology
 * timeline, and the read path only hydrates notes for events currently in the feed, so orphans
 * are invisible by construction.
 *
 * Raw SQL (mirrors syncHistoryQueries): `db.query`/`db.queryFirst`/`db.execute`.
 */

interface TimelineAnnotationRow {
  id: number;
  event_source: string;
  event_id: number;
  body: string;
  author_user_id: number | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAnnotationInput {
  eventSource: TimelineSource;
  eventId: number;
  body: string;
  authorUserId: number | null;
  authorName: string | null;
}

function toAnnotation(row: TimelineAnnotationRow): TimelineAnnotation {
  return {
    id: row.id,
    source: row.event_source as TimelineSource,
    eventId: row.event_id,
    body: row.body,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    createdAt: sqliteUtcToIso(row.created_at),
    updatedAt: sqliteUtcToIso(row.updated_at),
  };
}

/** Group key used to bucket hydrated annotations back onto their events. */
export function annotationKey(source: TimelineSource, eventId: number): string {
  return `${source}:${eventId}`;
}

export const timelineAnnotationQueries = {
  /** Insert a note; returns the persisted row. */
  create(input: CreateAnnotationInput): TimelineAnnotation {
    db.execute(
      `INSERT INTO timeline_annotations (event_source, event_id, body, author_user_id, author_name)
			 VALUES (?, ?, ?, ?, ?)`,
      input.eventSource,
      input.eventId,
      input.body,
      input.authorUserId,
      input.authorName
    );
    const row = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() AS id');
    const created = row ? this.getById(row.id) : undefined;
    if (!created) {
      throw new Error('Failed to read back created annotation');
    }
    return created;
  },

  getById(id: number): TimelineAnnotation | undefined {
    const row = db.queryFirst<TimelineAnnotationRow>('SELECT * FROM timeline_annotations WHERE id = ?', id);
    return row ? toAnnotation(row) : undefined;
  },

  /** All notes for one event, oldest first (a thread). */
  listForEvent(source: TimelineSource, eventId: number): TimelineAnnotation[] {
    const rows = db.query<TimelineAnnotationRow>(
      `SELECT * FROM timeline_annotations
			 WHERE event_source = ? AND event_id = ?
			 ORDER BY created_at ASC, id ASC`,
      source,
      eventId
    );
    return rows.map(toAnnotation);
  },

  /**
   * Batch-hydrate notes for a page of events. Grouped by source so the composite index
   * `(event_source, event_id)` is used (equality + IN). Returns a Map keyed `${source}:${id}`.
   */
  listForEvents(refs: { source: TimelineSource; eventId: number }[]): Map<string, TimelineAnnotation[]> {
    const grouped = new Map<string, TimelineAnnotation[]>();
    if (refs.length === 0) return grouped;

    const bySource = new Map<TimelineSource, Set<number>>();
    for (const ref of refs) {
      const ids = bySource.get(ref.source) ?? new Set<number>();
      ids.add(ref.eventId);
      bySource.set(ref.source, ids);
    }

    const groups: string[] = [];
    const params: (string | number)[] = [];
    for (const [source, ids] of bySource) {
      const placeholders = Array.from(ids, () => '?').join(', ');
      groups.push(`(event_source = ? AND event_id IN (${placeholders}))`);
      params.push(source, ...ids);
    }

    const rows = db.query<TimelineAnnotationRow>(
      `SELECT * FROM timeline_annotations
			 WHERE ${groups.join(' OR ')}
			 ORDER BY created_at ASC, id ASC`,
      ...params
    );
    for (const row of rows) {
      const annotation = toAnnotation(row);
      const key = annotationKey(annotation.source, annotation.eventId);
      const bucket = grouped.get(key) ?? [];
      bucket.push(annotation);
      grouped.set(key, bucket);
    }
    return grouped;
  },

  /** Update a note's body (and bump updated_at); returns the updated row or undefined if absent. */
  update(id: number, body: string): TimelineAnnotation | undefined {
    const changes = db.execute(
      `UPDATE timeline_annotations SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      body,
      id
    );
    if (changes === 0) return undefined;
    return this.getById(id);
  },

  /** Delete a note; returns the number of rows removed (0 if absent). */
  remove(id: number): number {
    return db.execute('DELETE FROM timeline_annotations WHERE id = ?', id);
  },

  /**
   * Delete annotations whose referenced source event no longer exists. NOT wired into any
   * cleanup job — orphans are preserved by default; this exists for explicit administrative use.
   */
  pruneOrphans(): number {
    return db.execute(`
			DELETE FROM timeline_annotations
			WHERE (event_source = 'sync'     AND event_id NOT IN (SELECT id FROM sync_history))
			   OR (event_source = 'canary'   AND event_id NOT IN (SELECT id FROM canary_rollouts))
			   OR (event_source = 'snapshot' AND event_id NOT IN (SELECT id FROM pcd_snapshots))
			   OR (event_source = 'rollback' AND event_id NOT IN (SELECT id FROM pcd_rollbacks))
		`);
  },
};
