import { assertEquals } from '@std/assert';
import { config } from '$config';

const PARSER_ENV_KEYS = ['PARSER_HOST', 'PARSER_PORT'] as const;

function withParserEnv(values: Partial<Record<(typeof PARSER_ENV_KEYS)[number], string>>, run: () => void): void {
  const saved = Object.fromEntries(PARSER_ENV_KEYS.map((key) => [key, Deno.env.get(key)]));

  try {
    for (const key of PARSER_ENV_KEYS) {
      const value = values[key];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    run();
  } finally {
    for (const key of PARSER_ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test('Config parser URL defaults to localhost port 5000', () => {
  withParserEnv({}, () => {
    assertEquals(config.parserUrl, 'http://localhost:5000');
  });
});

Deno.test('Config parser URL honors an explicit external parser', () => {
  withParserEnv({ PARSER_HOST: 'parser.example.test', PARSER_PORT: '5500' }, () => {
    assertEquals(config.parserUrl, 'http://parser.example.test:5500');
  });
});

Deno.test('Config parser URL observes late standalone spawn configuration', () => {
  withParserEnv({}, () => {
    assertEquals(config.parserUrl, 'http://localhost:5000');
    Deno.env.set('PARSER_HOST', '127.0.0.1');
    Deno.env.set('PARSER_PORT', '42123');
    assertEquals(config.parserUrl, 'http://127.0.0.1:42123');
  });
});
