/**
 * Public surface of the narration engine (issue #21). Consumers import preview/drift narration
 * functions, contracts, and {@link NARRATION_TEMPLATE_VERSION} from here; the template resolvers
 * stay internal (import `./templates.ts` directly when they must be exercised in isolation).
 */

export * from './types.ts';
export * from './narrate.ts';
