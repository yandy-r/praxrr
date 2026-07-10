/** Pure IP parser, CIDR, and security-classification tests for DNS-aware transport grading. */

import { assert, assertEquals } from '@std/assert';
import {
  classifyIpAddress,
  containsParsedIp,
  parseCidrToken,
  parseIpLiteral,
  type IpAddressClass,
} from '$shared/security/index.ts';

Deno.test('parseIpLiteral: parses IPv4, compressed IPv6, embedded IPv4, and brackets exactly', () => {
  assertEquals(parseIpLiteral('192.168.1.2'), { family: 4, value: 0xc0a80102n });
  assertEquals(parseIpLiteral('[2001:db8::1]')?.family, 6);
  assertEquals(parseIpLiteral('64:ff9b::1.2.3.4'), parseIpLiteral('64:ff9b::102:304'));

  // Preserve the shipped trusted-proxy contract: dotted mapped input folds to v4, while pure-hex
  // mapped input stays v6 at the parser layer (classification normalizes both forms separately).
  assertEquals(parseIpLiteral('::ffff:10.0.0.5'), { family: 4, value: 0x0a000005n });
  assertEquals(parseIpLiteral('::ffff:a00:5')?.family, 6);
});

Deno.test('parseIpLiteral: rejects malformed literals and IPv6 zone identifiers', () => {
  for (const value of [
    '',
    'not-an-ip',
    '1.2.3',
    '1.2.3.256',
    '1.2.3.-1',
    '2001:db8:::1',
    '1:2:3:4:5:6:7:8:9',
    'fe80::1%eth0',
  ]) {
    assertEquals(parseIpLiteral(value), null, value);
  }
});

Deno.test('parseCidrToken/containsParsedIp: exact IPv4 and IPv6 boundaries including /0', () => {
  const v4 = parseCidrToken('172.16.0.0/12');
  const v6 = parseCidrToken('2001:db8::/32');
  const all = parseCidrToken('0.0.0.0/0');
  assert(v4 && v6 && all);

  assert(containsParsedIp(parseIpLiteral('172.16.0.0')!, v4));
  assert(containsParsedIp(parseIpLiteral('172.31.255.255')!, v4));
  assert(!containsParsedIp(parseIpLiteral('172.32.0.0')!, v4));
  assert(containsParsedIp(parseIpLiteral('2001:db8:ffff::1')!, v6));
  assert(!containsParsedIp(parseIpLiteral('2001:db9::1')!, v6));
  assert(containsParsedIp(parseIpLiteral('255.255.255.255')!, all));
  assert(!containsParsedIp(parseIpLiteral('::1')!, all));

  for (const value of ['10.0.0.0/33', '2001:db8::/129', '10.0.0.0/', 'garbage/8']) {
    assertEquals(parseCidrToken(value), null, value);
  }
});

function assertClasses(expected: IpAddressClass, values: readonly string[]): void {
  for (const value of values) {
    assertEquals(classifyIpAddress(value), expected, value);
  }
}

Deno.test('classifyIpAddress: loopback/private/link-local prefix boundaries are exact', () => {
  assertClasses('loopback', ['127.0.0.0', '127.255.255.255', '::1', '[::1]']);
  assertClasses('private', [
    '10.0.0.0',
    '10.255.255.255',
    '172.16.0.0',
    '172.31.255.255',
    '192.168.0.0',
    '192.168.255.255',
    'fc00::',
    'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  ]);
  assertClasses('link-local', ['169.254.0.0', '169.254.255.255', 'fe80::', 'febf:ffff:ffff:ffff::1']);

  assertClasses('public', ['126.255.255.255', '128.0.0.0', '172.15.255.255', '172.32.0.0', '169.253.255.255']);
  assertEquals(classifyIpAddress('169.255.0.0'), 'public');
  assertEquals(classifyIpAddress('fec0::1'), 'special');
});

Deno.test('classifyIpAddress: reviewed IPv4 special-purpose prefixes never default public', () => {
  // One representative pins every prefix in the 2026-07-10 reviewed table.
  assertClasses('special', [
    '0.0.0.0',
    '100.64.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.31.196.1',
    '192.52.193.1',
    '192.88.99.1',
    '192.175.48.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
  ]);

  assertClasses('public', ['8.8.8.8', '100.63.255.255', '100.128.0.0', '198.17.255.255', '223.255.255.255']);
});

Deno.test('classifyIpAddress: reviewed IPv6 special-purpose prefixes and global-unicast boundary', () => {
  // One representative pins every prefix in the 2026-07-10 reviewed table.
  assertClasses('special', [
    '::',
    '64:ff9b::1',
    '64:ff9b:1::1',
    '100::1',
    '100:0:0:1::1',
    '2001::1',
    '2001:db8::1',
    '2002::1',
    '2620:4f:8000::1',
    '3fff::1',
    '5f00::1',
    'fec0::1',
    'ff02::1',
    '4000::1',
  ]);

  assertClasses('public', ['2001:4860:4860::8888', '2606:4700:4700::1111', '3fff:1000::1']);
});

Deno.test('classifyIpAddress: IPv4-mapped IPv6 uses embedded IPv4 semantics', () => {
  assertEquals(classifyIpAddress('::ffff:127.0.0.1'), 'loopback');
  assertEquals(classifyIpAddress('::ffff:7f00:1'), 'loopback');
  assertEquals(classifyIpAddress('::ffff:10.0.0.5'), 'private');
  assertEquals(classifyIpAddress('::ffff:a00:5'), 'private');
  assertEquals(classifyIpAddress('::ffff:169.254.1.2'), 'link-local');
  assertEquals(classifyIpAddress('::ffff:a9fe:102'), 'link-local');
  assertEquals(classifyIpAddress('::ffff:8.8.8.8'), 'public');
  assertEquals(classifyIpAddress('::ffff:808:808'), 'public');
  assertEquals(classifyIpAddress('::ffff:192.0.2.1'), 'special');
});

Deno.test('classifyIpAddress: malformed and unfamiliar values fail to special', () => {
  assertClasses('special', ['', 'hostname.example', '999.0.0.1', 'fe80::1%eth0', '8000::1']);
});
