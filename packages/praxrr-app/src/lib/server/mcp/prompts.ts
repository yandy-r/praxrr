/**
 * MCP prompt registry.
 *
 * Prompts are argument-substituted user-message templates that steer an assistant to call the
 * read-only tools/resources in a safe order. They never instruct a write (no write tool exists).
 */

import { ERROR_CODES } from './jsonrpc.ts';
import { JsonRpcError } from './errors.ts';
import type { Prompt, PromptGetResult, PromptMessage } from './types.ts';

interface McpPrompt {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  build: (args: Record<string, string>) => PromptMessage[];
}

function userMessage(text: string): PromptMessage[] {
  return [{ role: 'user', content: { type: 'text', text } }];
}

const PROMPTS: readonly McpPrompt[] = [
  {
    name: 'diagnose_drift',
    description: 'Diagnose configuration drift and propose safe, read-only remediation steps.',
    arguments: [
      { name: 'instanceId', description: 'Optional Arr instance id to scope the diagnosis.', required: false },
    ],
    build: (args) => {
      const scope = args.instanceId ? `instance ${args.instanceId}` : 'the whole fleet';
      return userMessage(
        `Diagnose configuration drift for ${scope}. Call get_drift_status` +
          `${args.instanceId ? ` with instanceId ${args.instanceId}` : ''} (or read the praxrr://drift/summary resource), ` +
          'then use preview_sync on any drifted instance to see the exact differences. Explain what has drifted and ' +
          'why, in plain language, ordered by blast radius. Do not apply any changes.'
      );
    },
  },
  {
    name: 'review_security_posture',
    description: 'Review the deployment security posture and prioritize the highest-risk findings.',
    arguments: [],
    build: () =>
      userMessage(
        'Review this Praxrr deployment. Read the praxrr://security-posture resource and call get_config_health. ' +
          'Summarize the security shield score and the highest-risk findings first, each with a concrete remediation.'
      ),
  },
  {
    name: 'plan_sync',
    description: 'Summarize a dry-run sync plan for an instance and require explicit confirmation.',
    arguments: [{ name: 'instanceId', description: 'The Arr instance id to plan a sync for.', required: true }],
    build: (args) =>
      userMessage(
        `Plan a sync for instance ${args.instanceId}. Call preview_sync with instanceId ${args.instanceId} to get the ` +
          'dry-run diff, then summarize the planned creates, updates, and deletes grouped by section. Explicitly ask ' +
          'the user to confirm before anything is applied — no write/apply tool is available yet.'
      ),
  },
  {
    name: 'explain_pcd_entity',
    description: 'Explain a resolved PCD configuration entity in plain language.',
    arguments: [
      { name: 'databaseId', description: 'The PCD database id.', required: true },
      {
        name: 'entityType',
        description: 'The resolved entity type (e.g. customFormat, qualityProfile).',
        required: true,
      },
      { name: 'name', description: 'The entity name.', required: true },
      { name: 'arrType', description: 'Arr type, required only for per-arr entity types.', required: false },
    ],
    build: (args) =>
      userMessage(
        `Explain the resolved PCD entity "${args.name}" of type ${args.entityType} in database ${args.databaseId}` +
          `${args.arrType ? ` for ${args.arrType}` : ''}. Call get_resolved_entity with these arguments and explain its ` +
          'configuration (scoring, matching, and any notable settings) in plain language.'
      ),
  },
];

export function listPrompts(): Prompt[] {
  return PROMPTS.map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    arguments: prompt.arguments,
  }));
}

export function getPrompt(name: string, args: Record<string, unknown>): PromptGetResult {
  const prompt = PROMPTS.find((entry) => entry.name === name);
  if (!prompt) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Unknown prompt: ${name}`);
  }
  const values: Record<string, string> = {};
  for (const argument of prompt.arguments) {
    const raw = args[argument.name];
    if (raw === undefined || raw === null || raw === '') {
      if (argument.required) {
        throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Missing required prompt argument: ${argument.name}`);
      }
      continue;
    }
    values[argument.name] = String(raw);
  }
  return { description: prompt.description, messages: prompt.build(values) };
}
