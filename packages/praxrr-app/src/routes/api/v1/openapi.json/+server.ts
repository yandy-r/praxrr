import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { parse } from '@std/yaml';

// Cache the parsed spec to avoid re-reading on every request
let cachedSpec: unknown = null;

/**
 * GET /api/v1/openapi.json
 *
 * Return the OpenAPI specification loaded from docs/api/v1/openapi.yaml.
 *
 * @returns {Promise<Response>} Cached JSON response containing the OpenAPI document.
 * @throws {Error} Throws if the YAML file cannot be read or parsed.
 */
export const GET: RequestHandler = async () => {
  if (!cachedSpec) {
    // Read and parse the OpenAPI spec
    const yamlContent = await Deno.readTextFile('docs/api/v1/openapi.yaml');
    cachedSpec = parse(yamlContent);
  }

  return json(cachedSpec);
};
