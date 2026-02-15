/**
 * Update a regular expression operation
 */

import type { PCDCache } from '$pcd/index.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import type { RegularExpressionWithTags } from '$shared/pcd/display.ts';
import { uuid } from '$shared/utils/uuid.ts';
import { logger } from '$logger/logger.ts';
import type { CompiledQuery } from 'kysely';

interface UpdateRegularExpressionInput {
  name: string;
  pattern: string;
  tags: string[];
  description: string | null;
  regex101Id: string | null;
}

interface UpdateRegularExpressionOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  /** The current regular expression data (for value guards) */
  current: RegularExpressionWithTags;
  /** The new values */
  input: UpdateRegularExpressionInput;
}

/**
 * Escape a string for SQL
 */
function esc(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Update a regular expression by writing an operation to the specified layer
 * Uses value guards to detect conflicts with upstream changes
 */
export async function update(options: UpdateRegularExpressionOptions) {
  const { databaseId, cache, layer, current, input } = options;
  const db = cache.kb;
  const isRename = input.name !== current.name;
  const groupId = isRename ? uuid() : undefined;

  const queries = [];

  const dependentOps: Array<{
    formatName: string;
    queries: CompiledQuery[];
    updatedConditions: Array<{
      name: string;
      base: {
        from: { type?: string; arrType?: string; negate: boolean; required: boolean };
        to: { type?: string; arrType?: string; negate: boolean; required: boolean };
      };
      values: {
        from: { patterns: Array<{ name: string; pattern: string }> };
        to: { patterns: Array<{ name: string; pattern: string }> };
      };
    }>;
  }> = [];

  if (isRename) {
    const dependentConditions = await db
      .selectFrom('condition_patterns as cp')
      .innerJoin('custom_format_conditions as cfc', (join) =>
        join.onRef('cfc.custom_format_name', '=', 'cp.custom_format_name').onRef('cfc.name', '=', 'cp.condition_name')
      )
      .select(['cp.custom_format_name', 'cp.condition_name', 'cfc.type', 'cfc.arr_type', 'cfc.negate', 'cfc.required'])
      .where('cp.regular_expression_name', '=', current.name)
      .orderBy('cp.custom_format_name')
      .orderBy('cp.condition_name')
      .execute();

    const conditionsByFormat = new Map<
      string,
      Array<{
        custom_format_name: string;
        condition_name: string;
        type?: string;
        arr_type?: string;
        negate?: number;
        required?: number;
      }>
    >();

    for (const condition of dependentConditions) {
      if (!conditionsByFormat.has(condition.custom_format_name)) {
        conditionsByFormat.set(condition.custom_format_name, []);
      }
      conditionsByFormat.get(condition.custom_format_name)!.push(condition);
    }

    for (const [formatName, conditions] of conditionsByFormat.entries()) {
      const conditionQueries = conditions.map((condition) =>
        db
          .updateTable('condition_patterns')
          .set({ regular_expression_name: input.name })
          .where('custom_format_name', '=', condition.custom_format_name)
          .where('condition_name', '=', condition.condition_name)
          .where('regular_expression_name', '=', current.name)
          .compile()
      );

      const updatedConditions = conditions.map((condition) => ({
        name: condition.condition_name,
        base: {
          from: {
            type: condition.type,
            arrType: condition.arr_type,
            negate: !!condition.negate,
            required: !!condition.required,
          },
          to: {
            type: condition.type,
            arrType: condition.arr_type,
            negate: !!condition.negate,
            required: !!condition.required,
          },
        },
        values: {
          from: {
            patterns: [
              {
                name: current.name,
                pattern: current.pattern,
              },
            ],
          },
          to: {
            patterns: [
              {
                name: input.name,
                pattern: input.pattern,
              },
            ],
          },
        },
      }));

      if (conditionQueries.length > 0) {
        dependentOps.push({ formatName, queries: conditionQueries, updatedConditions });
      }
    }
  }

  if (input.name !== current.name) {
    const existing = await db
      .selectFrom('regular_expressions')
      .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
      .select('name')
      .executeTakeFirst();

    if (existing) {
      await logger.warn(`Duplicate regular expression name "${input.name}"`, {
        source: 'RegularExpression',
        meta: { databaseId, name: input.name },
      });
      throw new Error(`A regular expression with name "${input.name}" already exists`);
    }
  }

  const rawCurrentDescription = current.description;
  const normalizedCurrentDescription = rawCurrentDescription?.trim() ?? '';
  const normalizedNextDescription = input.description?.trim() ?? '';
  const rawCurrentRegex101Id = current.regex101_id;
  const normalizedCurrentRegex101Id = rawCurrentRegex101Id?.trim() ?? '';
  const normalizedNextRegex101Id = input.regex101Id?.trim() ?? '';
  const descriptionChanged = normalizedCurrentDescription !== normalizedNextDescription;
  const regex101Changed = normalizedCurrentRegex101Id !== normalizedNextRegex101Id;

  // 1. Update the regular expression with value guards
  const setValues: Record<string, unknown> = {};

  if (current.name !== input.name) {
    setValues.name = input.name;
  }
  if (current.pattern !== input.pattern) {
    setValues.pattern = input.pattern;
  }
  if (descriptionChanged) {
    setValues.description = normalizedNextDescription === '' ? null : normalizedNextDescription;
  }
  if (regex101Changed) {
    setValues.regex101_id = normalizedNextRegex101Id === '' ? null : normalizedNextRegex101Id;
  }

  let updateRegex = db
    .updateTable('regular_expressions')
    .set(setValues)
    // Value guard - ensure this is the regex we expect
    .where('name', '=', current.name);

  if (current.pattern !== input.pattern) {
    updateRegex = updateRegex.where('pattern', '=', current.pattern);
  }
  if (descriptionChanged) {
    if (rawCurrentDescription === null) {
      updateRegex = updateRegex.where('description', 'is', null);
    } else {
      updateRegex = updateRegex.where('description', '=', rawCurrentDescription);
    }
  }
  if (regex101Changed) {
    if (rawCurrentRegex101Id === null) {
      updateRegex = updateRegex.where('regex101_id', 'is', null);
    } else {
      updateRegex = updateRegex.where('regex101_id', '=', rawCurrentRegex101Id);
    }
  }

  if (Object.keys(setValues).length > 0) {
    const updateRegexQuery = updateRegex.compile();
    queries.push(updateRegexQuery);
  }

  // 2. Handle tag changes
  const currentTagNames = current.tags.map((t) => t.name);
  const newTagNames = Array.from(new Set(input.tags.map((tag) => tag.trim()).filter(Boolean)));
  const tagParentNames = Array.from(new Set([current.name, input.name]));
  const tagParentInClause = tagParentNames.map((name) => `'${esc(name)}'`).join(', ');

  // Tags to remove
  const tagsToRemove = currentTagNames.filter((t) => !newTagNames.includes(t));
  for (const tagName of tagsToRemove) {
    const removeTag = {
      sql: `DELETE FROM regular_expression_tags WHERE regular_expression_name IN (${tagParentInClause}) AND tag_name = '${esc(tagName)}'`,
      parameters: [],
      query: {} as never,
    };
    queries.push(removeTag);
  }

  // Tags to add
  const tagsToAdd = newTagNames.filter((t) => !currentTagNames.includes(t));
  for (const tagName of tagsToAdd) {
    // Insert tag if not exists
    const insertTag = db
      .insertInto('tags')
      .values({ name: tagName })
      .onConflict((oc) => oc.column('name').doNothing())
      .compile();

    queries.push(insertTag);

    // Link tag to regular expression
    const linkTag = {
      sql: `INSERT INTO regular_expression_tags (regular_expression_name, tag_name)
SELECT name, '${esc(tagName)}' FROM regular_expressions WHERE name IN (${tagParentInClause}) LIMIT 1`,
      parameters: [],
      query: {} as never,
    };

    queries.push(linkTag);
  }

  if (queries.length === 0) {
    return { success: true };
  }

  // Log what's being changed (before the write)
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (current.name !== input.name) {
    changes.name = { from: current.name, to: input.name };
  }
  if (current.pattern !== input.pattern) {
    changes.pattern = { from: current.pattern, to: input.pattern };
  }
  if (descriptionChanged) {
    changes.description = {
      from: rawCurrentDescription ?? null,
      to: normalizedNextDescription === '' ? null : normalizedNextDescription,
    };
  }
  if (regex101Changed) {
    changes.regex101Id = {
      from: rawCurrentRegex101Id ?? null,
      to: normalizedNextRegex101Id === '' ? null : normalizedNextRegex101Id,
    };
  }
  if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
    changes.tags = { from: currentTagNames, to: newTagNames };
  }

  await logger.info(`Save regular expression "${input.name}"`, {
    source: 'RegularExpression',
    meta: {
      id: current.id,
      changes,
    },
  });

  // Write the operation with metadata
  // Include previousName if this is a rename
  const changedFields = Object.keys(changes);
  const desiredState: Record<string, unknown> = {};
  if (changes.name) {
    desiredState.name = { from: current.name, to: input.name };
  }
  if (changes.pattern) {
    desiredState.pattern = { from: current.pattern, to: input.pattern };
  }
  if (changes.description) {
    desiredState.description = {
      from: rawCurrentDescription ?? null,
      to: normalizedNextDescription === '' ? null : normalizedNextDescription,
    };
  }
  if (changes.regex101Id) {
    desiredState.regex101_id = {
      from: rawCurrentRegex101Id ?? null,
      to: normalizedNextRegex101Id === '' ? null : normalizedNextRegex101Id,
    };
  }
  if (changes.tags) {
    desiredState.tags = { add: tagsToAdd, remove: tagsToRemove };
  }

  const result = await writeOperation({
    databaseId,
    layer,
    description: `update-regular-expression-${input.name}`,
    queries,
    desiredState,
    metadata: {
      operation: 'update',
      entity: 'regular_expression',
      name: input.name,
      ...(isRename && { previousName: current.name }),
      stableKey: { key: 'regular_expression_name', value: current.name },
      ...(groupId && { groupId }),
      changedFields,
      summary: 'Update regular expression',
      title: `Update regular expression "${input.name}"`,
    },
  });

  if (!result.success || !isRename || !groupId) {
    return result;
  }
  if (dependentOps.length === 0) {
    return result;
  }

  for (const op of dependentOps) {
    const conditionResult = await writeOperation({
      databaseId,
      layer,
      description: `update-conditions-${op.formatName}`,
      queries: op.queries,
      desiredState: {
        conditions: {
          updated: op.updatedConditions,
        },
      },
      metadata: {
        operation: 'update',
        entity: 'custom_format',
        name: op.formatName,
        stableKey: { key: 'custom_format_name', value: op.formatName },
        groupId,
        generated: true,
        dependsOn: [
          {
            entity: 'regular_expression',
            key: 'regular_expression_name',
            value: input.name,
          },
        ],
        changedFields: ['conditions'],
        summary: 'Update custom format conditions',
        title: `Update conditions for custom format "${op.formatName}"`,
      },
    });

    if (!conditionResult.success) {
      return conditionResult;
    }
  }

  return result;
}
