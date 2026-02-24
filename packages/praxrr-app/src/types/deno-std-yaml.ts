declare module '@std/yaml' {
  export interface YamlParseOptions {
    [key: string]: unknown;
  }

  export interface YamlStringifyOptions {
    [key: string]: unknown;
  }

  export function parse(source: string, options?: YamlParseOptions): unknown;
  export function parseAll(source: string, options?: YamlParseOptions): unknown[];
  export function stringify(value: unknown, options?: YamlStringifyOptions): string;
}
