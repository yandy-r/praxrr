# @yandy-r/praxrr-api

OpenAPI specification and TypeScript types for the [Praxrr](https://github.com/yandy-r/praxrr) API.

## Usage

```ts
import { spec } from '@yandy-r/praxrr-api';
import type { components } from '@yandy-r/praxrr-api';

// Access the bundled OpenAPI 3.1 spec
console.log(spec.info.title); // "Praxrr API"
console.log(spec.paths);

// Use typed schemas
type Movie = components['schemas']['RadarrLibraryItem'];
type Series = components['schemas']['SonarrLibraryItem'];
type Episode = components['schemas']['SonarrEpisodeItem'];
```

## What's included

- **`spec`** — Bundled OpenAPI 3.1 specification (all `$ref`s resolved)
- **Type exports** — TypeScript interfaces for all API schemas, paths, and operations
