import { assert, assertEquals, assertMatch, assertNotEquals, assertStringIncludes } from '@std/assert';
import {
  assessHealthDegradation,
  buildHealthDegradationSignature,
  buildHealthDegradedNotification,
  HEALTH_DEGRADATION_EMBED_FIELD_NAME_LIMIT,
  HEALTH_DEGRADATION_EMBED_FIELD_VALUE_LIMIT,
  HEALTH_DEGRADATION_EMBED_MAX_FIELDS,
  HEALTH_DEGRADATION_EMBED_TEXT_BUDGET,
  HEALTH_DEGRADATION_EMBED_TITLE_LIMIT,
  HEALTH_DEGRADATION_MAX_CONTRIBUTORS,
  HEALTH_DEGRADATION_MIN_SCORE_DROP,
  type HealthDegradationCriterionSnapshot,
  type HealthDegradationSnapshot,
  type HealthDegradedEvent,
} from '$lib/server/health/degradation.ts';

function criterion(
  id: string,
  score: number | null,
  overrides: Partial<HealthDegradationCriterionSnapshot> = {}
): HealthDegradationCriterionSnapshot {
  return {
    id,
    label: id.replace('_', ' '),
    score,
    weight: 25,
    contribution: score === null ? 0 : Math.round(score / 4),
    detail: [],
    suggestions: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<HealthDegradationSnapshot> = {}): HealthDegradationSnapshot {
  return {
    id: 10,
    arrInstanceId: 42,
    instanceName: 'Main Movies',
    arrType: 'radarr',
    engineVersion: '1',
    overallScore: 79,
    band: 'attention',
    criteriaScores: [
      criterion('completeness', 80, { contribution: 20 }),
      criterion('drift', 76, { contribution: 19 }),
      criterion('coherence', null, { contribution: 0 }),
    ],
    generatedAt: '2026-07-18T12:00:00.000Z',
    ...overrides,
  };
}

async function degradation(
  previousOverrides: Partial<HealthDegradationSnapshot>,
  currentOverrides: Partial<HealthDegradationSnapshot>
): Promise<HealthDegradedEvent> {
  const result = await assessHealthDegradation(
    snapshot(previousOverrides),
    snapshot({
      id: 11,
      generatedAt: '2026-07-18T13:00:00.000Z',
      ...currentOverrides,
    })
  );
  assertEquals(result.kind, 'degradation');
  return (result as { kind: 'degradation'; event: HealthDegradedEvent }).event;
}

function embedTextLength(event: HealthDegradedEvent): number {
  const embed = buildHealthDegradedNotification(event).embed;
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((total, field) => total + field.name.length + field.value.length, 0)
  );
}

Deno.test('health degradation: fixed five-point boundary and worse-band boundary are exact', async () => {
  assertEquals(HEALTH_DEGRADATION_MIN_SCORE_DROP, 5);

  const four = await assessHealthDegradation(snapshot({ overallScore: 79 }), snapshot({ id: 11, overallScore: 75 }));
  assertEquals(four.kind, 'quiet');

  const five = await assessHealthDegradation(snapshot({ overallScore: 79 }), snapshot({ id: 11, overallScore: 74 }));
  assertEquals(five.kind, 'degradation');
  if (five.kind === 'degradation') {
    assertEquals(five.event.kind, 'score');
    assertEquals(five.event.pointDrop, 5);
  }

  const band = await assessHealthDegradation(
    snapshot({ overallScore: 86, band: 'healthy' }),
    snapshot({ id: 11, overallScore: 84, band: 'attention' })
  );
  assertEquals(band.kind, 'degradation');
  if (band.kind === 'degradation') assertEquals(band.event.kind, 'band');
});

Deno.test('health degradation: recovery is symmetric and small movement does not accumulate', async () => {
  const fourPointGain = await assessHealthDegradation(
    snapshot({ overallScore: 70 }),
    snapshot({ id: 11, overallScore: 74 })
  );
  assertEquals(fourPointGain.kind, 'quiet');

  const fivePointGain = await assessHealthDegradation(
    snapshot({ overallScore: 70 }),
    snapshot({ id: 11, overallScore: 75 })
  );
  assertEquals(fivePointGain, { kind: 'recovery', pointGain: 5 });

  const betterBand = await assessHealthDegradation(
    snapshot({ overallScore: 84, band: 'attention' }),
    snapshot({ id: 11, overallScore: 85, band: 'healthy' })
  );
  assertEquals(betterBand, { kind: 'recovery', pointGain: 1 });

  // Adjacent comparisons are independent: 79 -> 76 -> 73 contains no five-point edge.
  assertEquals(
    (await assessHealthDegradation(snapshot({ overallScore: 79 }), snapshot({ id: 11, overallScore: 76 }))).kind,
    'quiet'
  );
  assertEquals(
    (await assessHealthDegradation(snapshot({ overallScore: 76 }), snapshot({ id: 11, overallScore: 73 }))).kind,
    'quiet'
  );
});

Deno.test(
  'health degradation: first, unknown, malformed, cross-engine, and cross-instance evidence fails closed',
  async () => {
    assertEquals(await assessHealthDegradation(undefined, snapshot()), {
      kind: 'incomparable',
      reason: 'no-baseline',
    });
    assertEquals(
      (await assessHealthDegradation(snapshot({ band: 'unknown' }), snapshot({ id: 11 }))).kind,
      'incomparable'
    );
    assertEquals(
      (await assessHealthDegradation(snapshot(), snapshot({ id: 11, overallScore: Number.NaN }))).kind,
      'incomparable'
    );
    assertEquals(
      (await assessHealthDegradation(snapshot(), snapshot({ id: 11, engineVersion: '2' }))).kind,
      'incomparable'
    );
    assertEquals(
      (await assessHealthDegradation(snapshot(), snapshot({ id: 11, arrInstanceId: 43 }))).kind,
      'incomparable'
    );
    assertEquals(
      (await assessHealthDegradation(snapshot(), snapshot({ id: 11, arrType: 'sonarr' }))).kind,
      'incomparable'
    );
    assertEquals(
      (
        await assessHealthDegradation(
          snapshot(),
          snapshot({
            id: 11,
            criteriaScores: [criterion('drift', 70), criterion('drift', 65)],
          })
        )
      ).kind,
      'incomparable'
    );
  }
);

Deno.test('health degradation: scored criterion set and every persisted weight must match', async () => {
  const changedAvailability = snapshot({
    id: 11,
    overallScore: 70,
    criteriaScores: [
      criterion('completeness', null, { contribution: 0 }),
      criterion('drift', 70),
      criterion('coherence', null, { contribution: 0 }),
    ],
  });
  assertEquals((await assessHealthDegradation(snapshot(), changedAvailability)).kind, 'incomparable');

  const changedWeight = snapshot({
    id: 11,
    overallScore: 70,
    criteriaScores: [
      criterion('completeness', 70, { weight: 30 }),
      criterion('drift', 70),
      criterion('coherence', null, { contribution: 0 }),
    ],
  });
  assertEquals((await assessHealthDegradation(snapshot(), changedWeight)).kind, 'incomparable');

  const missingCriterion = snapshot({
    id: 11,
    overallScore: 70,
    criteriaScores: [criterion('completeness', 70), criterion('drift', 70)],
  });
  assertEquals((await assessHealthDegradation(snapshot(), missingCriterion)).kind, 'incomparable');
});

Deno.test('health degradation signature uses exact canonical JSON/SHA-256 and excludes display/row data', async () => {
  const current = snapshot({ id: 11, overallScore: 74 });
  const canonical = JSON.stringify([
    'health-degraded:v1',
    42,
    '1',
    'attention',
    74,
    [
      ['completeness', 80],
      ['drift', 76],
      ['coherence', null],
    ],
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const signature = await buildHealthDegradationSignature(current);
  assertEquals(signature, expected);
  assertMatch(signature, /^[a-f0-9]{64}$/);

  assertEquals(
    await buildHealthDegradationSignature(
      snapshot({
        id: 999,
        instanceName: 'Renamed',
        generatedAt: '2026-07-19T00:00:00.000Z',
        overallScore: 74,
        criteriaScores: [...current.criteriaScores].reverse(),
      })
    ),
    signature
  );
  assertNotEquals(await buildHealthDegradationSignature(snapshot({ id: 11, overallScore: 73 })), signature);
  assertNotEquals(
    await buildHealthDegradationSignature(
      snapshot({
        id: 11,
        overallScore: 74,
        criteriaScores: [
          criterion('completeness', 79, { contribution: 20 }),
          criterion('drift', 76, { contribution: 19 }),
          criterion('coherence', null, { contribution: 0 }),
        ],
      })
    ),
    signature
  );
});

Deno.test('health degradation contributors rank by score drop, contribution drop, then canonical order', async () => {
  const before = [
    criterion('completeness', 90, { contribution: 28 }),
    criterion('drift', 90, { contribution: 30 }),
    criterion('coherence', 90, { contribution: 30 }),
    criterion('compatibility', 90, { contribution: 30 }),
  ];
  const after = [
    criterion('completeness', 80, { contribution: 25 }),
    criterion('drift', 80, { contribution: 20 }),
    criterion('coherence', 80, { contribution: 20 }),
    criterion('compatibility', 70, { contribution: 24 }),
  ];
  const event = await degradation(
    { overallScore: 79, criteriaScores: before },
    { overallScore: 74, criteriaScores: after }
  );
  assertEquals(
    event.contributors.map((item) => item.id),
    ['compatibility', 'drift', 'coherence']
  );
  assertEquals(event.contributors.length, HEALTH_DEGRADATION_MAX_CONTRIBUTORS);
});

Deno.test('health degradation fallback selects lowest current suggested context with stable tie breaks', async () => {
  const before = [
    criterion('completeness', 40, { contribution: 10 }),
    criterion('drift', 40, { contribution: 10 }),
    criterion('coherence', 70, { contribution: 18 }),
  ];
  const after = [
    criterion('completeness', 40, { contribution: 10 }),
    criterion('drift', 40, {
      contribution: 10,
      suggestions: [{ headline: 'Review drift evidence.' }],
    }),
    criterion('coherence', 70, { contribution: 18 }),
  ];
  const event = await degradation(
    { overallScore: 86, band: 'healthy', criteriaScores: before },
    { overallScore: 84, band: 'attention', criteriaScores: after }
  );
  assertEquals(event.contributors, [
    {
      id: 'drift',
      label: 'drift',
      previousScore: 40,
      currentScore: 40,
      scoreDrop: null,
      contributionDrop: null,
      kind: 'current-context',
      suggestion: 'Review drift evidence.',
    },
  ]);
});

Deno.test('health degradation event preserves explicit Radarr, Sonarr, and Lidarr identity', async () => {
  for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
    const event = await degradation({ arrType, overallScore: 79 }, { arrType, overallScore: 74 });
    assertEquals(event.arrType, arrType);
    const appField = buildHealthDegradedNotification(event).embed.fields?.find((field) => field.name === 'App');
    assertEquals(appField?.value.toLowerCase(), arrType);
  }
});

Deno.test(
  'health degradation projection strips controls, bidi, URLs, secrets, and escapes Discord Markdown',
  async () => {
    const secret = '0123456789abcdef0123456789abcdef';
    const event = await degradation(
      { overallScore: 79 },
      {
        overallScore: 74,
        instanceName: '**Main**\r\n\u202ehttps://arr.example/?apikey=bad',
        criteriaScores: [
          criterion('completeness', 70, {
            label: '[Completeness](https://evil.example)',
            contribution: 10,
            suggestions: [{ headline: `Use token=${secret}\u0000 now` }],
          }),
          criterion('drift', 76, { contribution: 19 }),
          criterion('coherence', null, { contribution: 0 }),
        ],
      }
    );
    const projection = buildHealthDegradedNotification(event);
    const serialized = JSON.stringify(projection);
    assert(!serialized.includes('\u202e'));
    assert(!serialized.includes('\u0000'));
    assert(!serialized.includes('https://'));
    assert(!serialized.includes(secret));
    assertStringIncludes(projection.title, '\\*\\*Main\\*\\*');
    assertStringIncludes(serialized, '\\\\[Completeness\\\\]');
  }
);

Deno.test('health degradation projection visibly truncates and stays below every Discord limit', async () => {
  const huge = `${'*'.repeat(3_000)} https://example.invalid ${'x'.repeat(3_000)}`;
  const event = await degradation(
    { overallScore: 79 },
    {
      overallScore: 74,
      instanceName: huge,
      criteriaScores: [
        criterion('completeness', 60, {
          label: huge,
          contribution: 10,
          suggestions: [{ headline: huge }],
        }),
        criterion('drift', 76, { contribution: 19 }),
        criterion('coherence', null, { contribution: 0 }),
      ],
    }
  );
  const projection = buildHealthDegradedNotification(event);
  assert((projection.embed.title?.length ?? 0) <= HEALTH_DEGRADATION_EMBED_TITLE_LIMIT);
  assertStringIncludes(projection.embed.title ?? '', '…');
  assert((projection.embed.fields?.length ?? 0) <= HEALTH_DEGRADATION_EMBED_MAX_FIELDS);
  for (const field of projection.embed.fields ?? []) {
    assert(field.name.length <= HEALTH_DEGRADATION_EMBED_FIELD_NAME_LIMIT);
    assert(field.value.length <= HEALTH_DEGRADATION_EMBED_FIELD_VALUE_LIMIT);
  }
  assert(embedTextLength(event) <= HEALTH_DEGRADATION_EMBED_TEXT_BUDGET);
  assert(projection.message.length <= HEALTH_DEGRADATION_EMBED_FIELD_VALUE_LIMIT);
});
