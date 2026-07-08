/**
 * Anime source inference for release scoring.
 *
 * When a release title looks like an anime release (bracketed group prefix) and
 * the parser could not determine a source, infer a representative source from
 * the custom formats that match the title. Extracted verbatim from the score
 * simulator route so the impact simulator's shared scorer and the score route
 * cannot diverge.
 */

import { QualitySource, type ParseResult } from '$lib/server/utils/arr/parser/types.ts';
import { evaluateCustomFormat } from '$pcd/entities/customFormats/index.ts';
import type { CustomFormatWithConditions } from '$shared/pcd/display.ts';

function normalizeSourceToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isLikelyAnimeReleaseTitle(title: string): boolean {
  return /^\[[^\]]+\]/.test(title);
}

function isWebLikeSource(source: QualitySource): boolean {
  return source === QualitySource.TV || source === QualitySource.WebDL || source === QualitySource.WebRip;
}

function inferRepresentativeAnimeSource(customFormat: CustomFormatWithConditions): QualitySource | null {
  const hasPatternSignal = customFormat.conditions.some(
    (condition) =>
      (condition.type === 'release_title' || condition.type === 'release_group') &&
      (condition.patterns?.length ?? 0) > 0
  );
  if (!hasPatternSignal) {
    return null;
  }

  const normalizedSources = new Set(
    customFormat.conditions
      .filter((condition) => condition.type === 'source')
      .flatMap((condition) => condition.sources ?? [])
      .map(normalizeSourceToken)
      .filter((value) => value.length > 0)
  );

  if (normalizedSources.size === 0) {
    return null;
  }

  const hasBluray = normalizedSources.has('bluray');
  const hasDvd = normalizedSources.has('dvd');
  const hasWebDl = normalizedSources.has('webdl');
  const hasWebRip = normalizedSources.has('webrip');
  const hasTelevision = normalizedSources.has('television') || normalizedSources.has('tv');
  const hasGenericWeb = normalizedSources.has('web');
  const hasWebLike = hasWebDl || hasWebRip || hasTelevision || hasGenericWeb;

  if (hasBluray && !hasWebLike && !hasDvd) {
    return QualitySource.Bluray;
  }

  if (hasWebLike && !hasBluray && !hasDvd) {
    if (hasWebDl || hasGenericWeb) {
      return QualitySource.WebDL;
    }
    if (hasWebRip) {
      return QualitySource.WebRip;
    }
    return QualitySource.TV;
  }

  if (hasDvd && !hasBluray && !hasWebLike) {
    return QualitySource.DVD;
  }

  return null;
}

/**
 * Infer a concrete source for an anime release whose parsed source is Unknown,
 * using the sources declared by the custom formats that actually match it.
 * Returns the (possibly source-overridden) parse result, or the input unchanged.
 */
export function inferAnimeSourceFromFormats(
  parsed: ParseResult | null,
  title: string,
  formats: readonly CustomFormatWithConditions[],
  patternMatches?: Map<string, boolean>
): ParseResult | null {
  if (parsed === null || parsed.source !== QualitySource.Unknown || !isLikelyAnimeReleaseTitle(title)) {
    return parsed;
  }

  const inferredSources = new Set<QualitySource>();

  for (const customFormat of formats) {
    const candidateSource = inferRepresentativeAnimeSource(customFormat);
    if (candidateSource === null) {
      continue;
    }

    const evaluation = evaluateCustomFormat(
      customFormat.conditions,
      {
        ...parsed,
        source: candidateSource,
      },
      title,
      patternMatches
    );

    if (evaluation.matches) {
      inferredSources.add(candidateSource);
    }
  }

  if (inferredSources.size === 0) {
    return parsed;
  }

  const inferredSourceList = [...inferredSources];
  const inferredFamilies = new Set(
    inferredSourceList.map((source) => (isWebLikeSource(source) ? 'web' : String(source)))
  );

  if (inferredFamilies.size !== 1) {
    return parsed;
  }

  const resolvedSource = inferredFamilies.has('web')
    ? inferredSourceList.includes(QualitySource.WebDL)
      ? QualitySource.WebDL
      : inferredSourceList.includes(QualitySource.WebRip)
        ? QualitySource.WebRip
        : QualitySource.TV
    : inferredSourceList[0];

  return {
    ...parsed,
    source: resolvedSource,
  };
}
