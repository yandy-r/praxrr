import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { parse } from 'yaml';

// Cache the parsed spec to avoid re-reading on every request
let cachedSpec: unknown = null;

export const GET: RequestHandler = async () => {
  if (!cachedSpec) {
    // Read and parse the OpenAPI spec
    const yamlContent = await Deno.readTextFile('docs/api/v1/openapi.yaml');
    cachedSpec = parse(yamlContent);
  }

  return json(cachedSpec);
};
