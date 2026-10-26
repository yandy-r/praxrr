/**
 * Pure unit tests for the OIDC sign-in allowlist (YAN-436): parsing (trimming, empties,
 * @domain entries, invalid domains, allowAll truthy values) and evaluation (subject match,
 * verified-email match, unverified-email denial, exact domain matching, groups as string or
 * array, fail-closed not-configured, allow-all only without lists, lists authoritative).
 */

import { assertEquals, assertThrows } from '@std/assert';
import { evaluateOidcAllowlist, parseOidcAllowlist } from '$auth/oidcAllowlist.ts';
import { decodeIdToken, verifyIdToken } from '$auth/oidc.ts';

// --- parse -------------------------------------------------------------------------------------

Deno.test('parseOidcAllowlist: splits on commas/newlines, trims, drops empties, keeps inner spaces', () => {
  const policy = parseOidcAllowlist({
    subjects: ' sub-a , sub-b\n\n  ,sub-c ,, ',
    emails: null,
    groups: 'Praxrr Admins, ops',
  });
  assertEquals([...policy.subjects], ['sub-a', 'sub-b', 'sub-c']);
  assertEquals(policy.emails.size, 0);
  assertEquals([...policy.groups], ['Praxrr Admins', 'ops']);
  assertEquals(policy.configured, true);
  assertEquals(policy.invalidEntries, []);
});

Deno.test('parseOidcAllowlist: empty and unset values yield an unconfigured policy', () => {
  for (const policy of [
    parseOidcAllowlist({}),
    parseOidcAllowlist({ subjects: null, emails: null, groups: null }),
    parseOidcAllowlist({ subjects: ' , ,, \n\t', emails: '', groups: '  ' }),
  ]) {
    assertEquals(policy.configured, false);
    assertEquals(policy.subjects.size, 0);
    assertEquals(policy.emails.size, 0);
    assertEquals(policy.emailDomains.size, 0);
    assertEquals(policy.groups.size, 0);
    assertEquals(policy.invalidEntries, []);
  }
});

Deno.test('parseOidcAllowlist: emails are lowercased and @domain entries become domain matches', () => {
  const policy = parseOidcAllowlist({
    emails: 'Admin@Example.COM, @Trusted.Org, @audit.example',
  });
  assertEquals([...policy.emails], ['admin@example.com']);
  assertEquals([...policy.emailDomains], ['trusted.org', 'audit.example']);
  assertEquals(policy.invalidEntries, []);
  assertEquals(policy.configured, true);
});

Deno.test('parseOidcAllowlist: @domain without a dot is invalid and grants nothing', () => {
  const policy = parseOidcAllowlist({ emails: 'ok@example.com, @LocalHost, @, @a.b' });
  assertEquals([...policy.emails], ['ok@example.com']);
  assertEquals([...policy.emailDomains], ['a.b']);
  assertEquals(policy.invalidEntries, ['@LocalHost', '@']);
});

Deno.test('parseOidcAllowlist: groups stay exact/case-sensitive; groupsClaim defaults to groups', () => {
  const policy = parseOidcAllowlist({ groups: 'Admins, admins' });
  assertEquals([...policy.groups], ['Admins', 'admins']);
  assertEquals(policy.groupsClaim, 'groups');

  const custom = parseOidcAllowlist({ groups: 'editor', groupsClaim: 'roles' });
  assertEquals(custom.groupsClaim, 'roles');
  // Blank groupsClaim falls back to the default.
  const blank = parseOidcAllowlist({ groups: 'editor', groupsClaim: '   ' });
  assertEquals(blank.groupsClaim, 'groups');
});

Deno.test('parseOidcAllowlist: allowAll accepts 1/true/yes/on case-insensitively, rejects the rest', () => {
  for (const raw of ['1', 'true', 'TRUE', 'Yes', ' on ', 'ON']) {
    assertEquals(parseOidcAllowlist({ allowAll: raw }).allowAll, true, raw);
  }
  for (const raw of ['0', 'false', 'no', 'off', '', 'maybe', 'y', '2', null, undefined]) {
    assertEquals(parseOidcAllowlist({ allowAll: raw }).allowAll, false, String(raw));
  }
});

Deno.test('parseOidcAllowlist: never throws on hostile input', () => {
  const policy = parseOidcAllowlist({
    subjects: ',,,,',
    emails: ',@,@@,@a,',
    groups: ',',
    groupsClaim: ' \t ',
    allowAll: ',',
  });
  // Rejected tokens still configure a restrictive policy, with no usable entries.
  assertEquals(policy.configured, true);
  assertEquals(policy.usableEntryCount, 0);
  assertEquals(policy.allowAll, false);
  assertEquals(policy.groupsClaim, 'groups');
  assertEquals(policy.invalidEntries, ['@', '@@', '@a']);

  // A value that DOES carry one usable entry stays configured even alongside garbage.
  const mixed = parseOidcAllowlist({ emails: 'ok@example.com,@no-dot' });
  assertEquals(mixed.configured, true);
  assertEquals(mixed.invalidEntries, ['@no-dot']);
});

// --- evaluate ----------------------------------------------------------------------------------

Deno.test('evaluateOidcAllowlist: exact subject match allows; case-sensitive', () => {
  const policy = parseOidcAllowlist({ subjects: 'auth0|123' });
  assertEquals(evaluateOidcAllowlist({ sub: 'auth0|123' }, policy), {
    allowed: true,
    matchedBy: 'subject',
  });
  assertEquals(evaluateOidcAllowlist({ sub: 'AUTH0|123' }, policy), { allowed: false, reason: 'no-match' });
  assertEquals(evaluateOidcAllowlist({ sub: 'auth0|124' }, policy), { allowed: false, reason: 'no-match' });
});

Deno.test('evaluateOidcAllowlist: verified email matches case-insensitively', () => {
  const policy = parseOidcAllowlist({ emails: 'Admin@Example.com' });
  assertEquals(evaluateOidcAllowlist({ sub: 'x', email: 'admin@example.com', email_verified: true }, policy), {
    allowed: true,
    matchedBy: 'email',
  });
  // The string 'true' some providers send also counts.
  assertEquals(evaluateOidcAllowlist({ sub: 'x', email: 'ADMIN@EXAMPLE.COM', email_verified: 'true' }, policy), {
    allowed: true,
    matchedBy: 'email',
  });
  assertEquals(evaluateOidcAllowlist({ sub: 'x', email: 'other@example.com', email_verified: true }, policy), {
    allowed: false,
    reason: 'no-match',
  });
});

Deno.test('evaluateOidcAllowlist: unverified or non-string emails never match', () => {
  const policy = parseOidcAllowlist({ emails: 'admin@example.com, @trusted.org' });
  for (const claims of [
    { sub: 'x', email: 'admin@example.com', email_verified: false },
    { sub: 'x', email: 'admin@example.com' },
    { sub: 'x', email: 'admin@example.com', email_verified: 'false' },
    { sub: 'x', email: 'admin@example.com', email_verified: 1 },
    { sub: 'x', email_verified: true },
    { sub: 'x', email: 123, email_verified: true },
  ]) {
    assertEquals(evaluateOidcAllowlist(claims, policy), { allowed: false, reason: 'no-match' }, JSON.stringify(claims));
  }
});

Deno.test('evaluateOidcAllowlist: @domain matches exactly after the last @, never subdomains', () => {
  const policy = parseOidcAllowlist({ emails: '@example.com' });
  assertEquals(evaluateOidcAllowlist({ sub: 'x', email: 'a@example.com', email_verified: true }, policy), {
    allowed: true,
    matchedBy: 'email-domain',
  });
  for (const email of ['a@sub.example.com', 'a@notexample.com', 'a@eXample.com.phishing', 'example.com']) {
    assertEquals(
      evaluateOidcAllowlist({ sub: 'x', email, email_verified: true }, policy),
      { allowed: false, reason: 'no-match' },
      email
    );
  }
  // A plus-addressed local part must not confuse the domain split.
  assertEquals(evaluateOidcAllowlist({ sub: 'x', email: 'user+tag@example.com', email_verified: true }, policy), {
    allowed: true,
    matchedBy: 'email-domain',
  });
});

Deno.test('evaluateOidcAllowlist: groups match from string or array claims; non-strings ignored', () => {
  const policy = parseOidcAllowlist({ groups: 'praxrr-admins' });
  assertEquals(evaluateOidcAllowlist({ sub: 'x', groups: 'praxrr-admins' }, policy), {
    allowed: true,
    matchedBy: 'group',
  });
  assertEquals(evaluateOidcAllowlist({ sub: 'x', groups: ['users', 'praxrr-admins'] }, policy), {
    allowed: true,
    matchedBy: 'group',
  });
  assertEquals(evaluateOidcAllowlist({ sub: 'x', groups: ['users', 42, null] }, policy), {
    allowed: false,
    reason: 'no-match',
  });
  assertEquals(evaluateOidcAllowlist({ sub: 'x', groups: 'PRAXRR-ADMINS' }, policy), {
    allowed: false,
    reason: 'no-match',
  });
  // A missing groups claim denies.
  assertEquals(evaluateOidcAllowlist({ sub: 'x' }, policy), { allowed: false, reason: 'no-match' });
});

Deno.test('evaluateOidcAllowlist: custom groupsClaim is read', () => {
  const policy = parseOidcAllowlist({ groups: 'editors', groupsClaim: 'realm_access.roles' });
  // The claim name is used as a flat key, not a path.
  assertEquals(evaluateOidcAllowlist({ sub: 'x', 'realm_access.roles': 'editors' }, policy), {
    allowed: true,
    matchedBy: 'group',
  });
  assertEquals(evaluateOidcAllowlist({ sub: 'x', groups: 'editors' }, policy), {
    allowed: false,
    reason: 'no-match',
  });
});

Deno.test('evaluateOidcAllowlist: not-configured denies (fail closed); allowAll opt-out allows', () => {
  const empty = parseOidcAllowlist({});
  assertEquals(evaluateOidcAllowlist({ sub: 'anyone' }, empty), { allowed: false, reason: 'not-configured' });

  const optedOut = parseOidcAllowlist({ allowAll: 'true' });
  assertEquals(evaluateOidcAllowlist({ sub: 'anyone' }, optedOut), { allowed: true, matchedBy: 'allow-all' });
});

Deno.test('evaluateOidcAllowlist: lists are authoritative when allowAll is also set', () => {
  const both = parseOidcAllowlist({ subjects: 'admin-sub', allowAll: 'true' });
  assertEquals(evaluateOidcAllowlist({ sub: 'admin-sub' }, both), { allowed: true, matchedBy: 'subject' });
  assertEquals(evaluateOidcAllowlist({ sub: 'stranger' }, both), { allowed: false, reason: 'no-match' });
});

Deno.test('evaluateOidcAllowlist: allowlist precedence is subject, then verified email, then groups', () => {
  const policy = parseOidcAllowlist({
    subjects: 'sub-1',
    emails: 'a@allowed.dev',
    groups: 'grp',
  });
  assertEquals(
    evaluateOidcAllowlist({ sub: 'sub-1', email: 'a@allowed.dev', email_verified: true, groups: 'grp' }, policy),
    {
      allowed: true,
      matchedBy: 'subject',
    }
  );
  assertEquals(
    evaluateOidcAllowlist({ sub: 'other', email: 'a@allowed.dev', email_verified: true, groups: 'grp' }, policy),
    {
      allowed: true,
      matchedBy: 'email',
    }
  );
  assertEquals(evaluateOidcAllowlist({ sub: 'other', groups: 'grp' }, policy), {
    allowed: true,
    matchedBy: 'group',
  });
  assertEquals(
    evaluateOidcAllowlist({ sub: 'other', email: 'nope@x.dev', email_verified: true, groups: 'other' }, policy),
    { allowed: false, reason: 'no-match' }
  );
});

Deno.test('OIDC email entries require one separator and a domain with a dot', () => {
  for (const entry of [
    'example.com',
    'admin',
    'a@b@c',
    'user@corp',
    '@corp',
    '@@corp.example',
    '@example. com',
    '@example.com\tadmin',
  ]) {
    const policy = parseOidcAllowlist({ emails: entry, allowAll: 'true' });
    assertEquals(policy.configured, true);
    assertEquals(policy.usableEntryCount, 0);
    assertEquals(policy.invalidEntries, [entry]);
    assertEquals(evaluateOidcAllowlist({ sub: 'account' }, policy), { allowed: false, reason: 'no-match' });
  }
});

Deno.test('parseOidcAllowlist: invalid entries retain their original trimmed spelling', () => {
  const policy = parseOidcAllowlist({ emails: '  Admin  ,  @Corp , User@Local  ' });
  assertEquals(policy.invalidEntries, ['Admin', '@Corp', 'User@Local']);
  assertEquals(policy.usableEntryCount, 0);
});

Deno.test('OIDC token verification requires a non-empty subject and numeric expiration', () => {
  const valid = {
    sub: 'account',
    iss: 'https://idp.test',
    aud: 'praxrr',
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000),
  };
  const options = { issuer: 'https://idp.test', clientId: 'praxrr' };
  for (const changes of [
    { sub: undefined },
    { sub: '' },
    { sub: 3 },
    { exp: undefined },
    { exp: '123' },
    { exp: null },
  ]) {
    const claims = decodeIdToken(`header.${btoa(JSON.stringify({ ...valid, ...changes }))}.signature`);
    assertThrows(() => verifyIdToken(claims, options));
  }
  const claims = decodeIdToken(`header.${btoa(JSON.stringify(valid))}.signature`);
  verifyIdToken(claims, options);
});

// --- ASCII-only case folding and punycode domains (YAN-1601) ------------------------------------

function verifiedClaims(email: string): { sub: string; email: string; email_verified: true } {
  return { sub: 'x', email, email_verified: true };
}

Deno.test('evaluateOidcAllowlist: local parts fold ASCII case only, never Unicode lookalikes', () => {
  const policy = parseOidcAllowlist({ emails: 'kim@example.com, admin@example.com' });
  // ASCII case folding still works for both sides.
  assertEquals(evaluateOidcAllowlist(verifiedClaims('KIM@Example.COM'), policy), { allowed: true, matchedBy: 'email' });
  // U+212A KELVIN SIGN and U+0130 LATIN CAPITAL I WITH DOT ABOVE lowercase to ASCII under Unicode rules.
  for (const email of ['\u212Aim@example.com', 'adm\u0130n@example.com', 'ADM\u0130N@EXAMPLE.COM']) {
    assertEquals(evaluateOidcAllowlist(verifiedClaims(email), policy), { allowed: false, reason: 'no-match' }, email);
  }
});

Deno.test('parseOidcAllowlist: entry local parts are ASCII-lowercased only', () => {
  const policy = parseOidcAllowlist({ emails: '\u212Aim@example.com, Kim@Example.com' });
  assertEquals([...policy.emails].sort(), ['kim@example.com', '\u212Aim@example.com'].sort());
  // The Kelvin entry matches only itself, not the ASCII spelling it would fold to under toLowerCase().
  const kelvinOnly = parseOidcAllowlist({ emails: '\u212Aim@example.com' });
  assertEquals(evaluateOidcAllowlist(verifiedClaims('kim@example.com'), kelvinOnly), {
    allowed: false,
    reason: 'no-match',
  });
  assertEquals(evaluateOidcAllowlist(verifiedClaims('\u212Aim@example.com'), kelvinOnly), {
    allowed: true,
    matchedBy: 'email',
  });
});

Deno.test('evaluateOidcAllowlist: a Kelvin-sign spelling of a domain label never matches the ASCII domain', () => {
  const policy = parseOidcAllowlist({ emails: '@kexample.com, ok@kexample.com' });
  for (const email of ['a@\u212Aexample.com', 'ok@\u212Aexample.com']) {
    assertEquals(evaluateOidcAllowlist(verifiedClaims(email), policy), { allowed: false, reason: 'no-match' }, email);
  }
  // A Kelvin domain entry is rejected as unrepresentable rather than silently becoming 'kexample.com'.
  const entry = parseOidcAllowlist({ emails: '@\u212Aexample.com' });
  assertEquals(entry.invalidEntries, ['@\u212Aexample.com']);
  assertEquals(entry.usableEntryCount, 0);
});

Deno.test('toAsciiDomain: labels the UTS46 mapping rewrites never fold onto an existing IDN domain', () => {
  const folded = ['ｂücher.example', 'bü\u00ADcher.example', '\u212Aü.example', 'ｘｎ--bcher-kva.example'];
  for (const domain of folded) {
    const entry = parseOidcAllowlist({ emails: `@${domain}, ana@${domain}` });
    assertEquals(entry.invalidEntries, [`@${domain}`, `ana@${domain}`], domain);
    assertEquals(entry.usableEntryCount, 0, domain);
  }
  const policy = parseOidcAllowlist({ emails: '@bücher.example, @kü.example' });
  assertEquals([...policy.emailDomains].sort(), ['xn--bcher-kva.example', 'xn--k-eha.example']);
  for (const domain of folded) {
    assertEquals(
      evaluateOidcAllowlist(verifiedClaims(`x@${domain}`), policy),
      { allowed: false, reason: 'no-match' },
      domain
    );
  }
});

Deno.test('toAsciiDomain: genuine IDN spelling matches its punycode form in both directions', () => {
  const unicodeEntry = parseOidcAllowlist({ emails: '@bücher.example' });
  assertEquals(evaluateOidcAllowlist(verifiedClaims('x@xn--bcher-kva.example'), unicodeEntry), {
    allowed: true,
    matchedBy: 'email-domain',
  });
  const punycodeEntry = parseOidcAllowlist({ emails: '@xn--bcher-kva.example' });
  assertEquals(evaluateOidcAllowlist(verifiedClaims('x@bücher.example'), punycodeEntry), {
    allowed: true,
    matchedBy: 'email-domain',
  });
});

Deno.test('toAsciiDomain: non-ASCII uppercase labels fail closed (ASCII-only case folding)', () => {
  const entry = parseOidcAllowlist({ emails: '@BÜCHER.example' });
  assertEquals(entry.invalidEntries, ['@BÜCHER.example']);
  const policy = parseOidcAllowlist({ emails: '@bücher.example' });
  assertEquals(evaluateOidcAllowlist(verifiedClaims('x@BÜCHER.example'), policy), {
    allowed: false,
    reason: 'no-match',
  });
});

Deno.test('IDN domains compare in punycode form in both directions', () => {
  const unicodeEntry = parseOidcAllowlist({ emails: '@Bücher.Example, ana@Bücher.Example' });
  assertEquals([...unicodeEntry.emailDomains], ['xn--bcher-kva.example']);
  assertEquals([...unicodeEntry.emails], ['ana@xn--bcher-kva.example']);
  for (const email of ['x@xn--bcher-kva.example', 'x@XN--BCHER-KVA.EXAMPLE', 'x@bücher.example']) {
    assertEquals(
      evaluateOidcAllowlist(verifiedClaims(email), unicodeEntry),
      { allowed: true, matchedBy: 'email-domain' },
      email
    );
  }
  assertEquals(evaluateOidcAllowlist(verifiedClaims('ANA@bücher.example'), unicodeEntry), {
    allowed: true,
    matchedBy: 'email',
  });

  const punycodeEntry = parseOidcAllowlist({ emails: '@xn--bcher-kva.example' });
  assertEquals(evaluateOidcAllowlist(verifiedClaims('x@bücher.example'), punycodeEntry), {
    allowed: true,
    matchedBy: 'email-domain',
  });
  // Unrelated domains and subdomains of the IDN domain still do not match.
  for (const email of ['x@sub.bücher.example', 'x@buecher.example', 'x@bücher.example.evil']) {
    assertEquals(
      evaluateOidcAllowlist(verifiedClaims(email), punycodeEntry),
      { allowed: false, reason: 'no-match' },
      email
    );
  }
});

Deno.test('evaluateOidcAllowlist: claim domains that cannot be converted never match', () => {
  const policy = parseOidcAllowlist({ emails: '@example.com' });
  for (const email of ['a@', 'a@exa mple.com', 'a@example.com:8080', 'a@exa\u0000mple.com', 'a@@']) {
    assertEquals(evaluateOidcAllowlist(verifiedClaims(email), policy), { allowed: false, reason: 'no-match' }, email);
  }
});
