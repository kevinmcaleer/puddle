import { describe, expect, it } from 'vitest';
import { isAllowed, isLoopback, normaliseIpv6, parseAllow } from './allow';

describe('the allowlist', () => {
  it('reads host names, suffix patterns, addresses and CIDR ranges, and says what it can’t read', () => {
    const { rules, errors } = parseAllow('db.local, *.example.com 10.0.0.0/8\n192.168.1.20 ::1 fe80::1');
    expect(rules).toEqual([
      { kind: 'host', name: 'db.local' },
      { kind: 'suffix', suffix: '.example.com' },
      { kind: 'ipv4', base: 10 << 24, bits: 8 },
      { kind: 'ipv4', base: ((192 << 24) | (168 << 16) | (1 << 8) | 20) >>> 0, bits: 32 },
      { kind: 'ipv6', address: '0000:0000:0000:0000:0000:0000:0000:0001' },
      { kind: 'ipv6', address: 'fe80:0000:0000:0000:0000:0000:0000:0001' },
    ]);
    expect(errors).toEqual([]);
    expect(parseAllow('10.0.0.0/33 *.bad_host what?').errors).toHaveLength(3);
    expect(parseAllow(undefined)).toEqual({ rules: [], errors: [] });
  });

  it('matches a host against the rules; an empty list allows nothing', () => {
    const { rules } = parseAllow('db.local, *.example.com, 10.0.0.0/8, 192.168.1.20, ::1');
    expect(isAllowed('db.local', rules)).toBe(true);
    expect(isAllowed('DB.LOCAL.', rules)).toBe(true);
    expect(isAllowed('db.local.evil', rules)).toBe(false);
    expect(isAllowed('a.example.com', rules)).toBe(true);
    expect(isAllowed('deep.a.example.com', rules)).toBe(true);
    expect(isAllowed('example.com', rules)).toBe(false);
    expect(isAllowed('notexample.com', rules)).toBe(false);
    expect(isAllowed('10.20.30.40', rules)).toBe(true);
    expect(isAllowed('11.0.0.1', rules)).toBe(false);
    expect(isAllowed('192.168.1.20', rules)).toBe(true);
    expect(isAllowed('192.168.1.21', rules)).toBe(false);
    expect(isAllowed('[::1]', rules)).toBe(true);
    expect(isAllowed('0:0:0:0:0:0:0:1', rules)).toBe(true);
    expect(isAllowed('', rules)).toBe(false);
    expect(isAllowed('db.local', [])).toBe(false);
  });

  it('never implies loopback or a private network', () => {
    const { rules } = parseAllow('db.local, 10.0.0.0/8');
    expect(isAllowed('localhost', rules)).toBe(false);
    expect(isAllowed('127.0.0.1', rules)).toBe(false);
    expect(isAllowed('192.168.0.1', rules)).toBe(false);
    expect(isAllowed('169.254.169.254', rules)).toBe(false);
    // Only when listed.
    expect(isAllowed('127.0.0.1', parseAllow('127.0.0.1').rules)).toBe(true);
    expect(isAllowed('anything', parseAllow('0.0.0.0/0').rules)).toBe(false);
    expect(isAllowed('8.8.8.8', parseAllow('0.0.0.0/0').rules)).toBe(true);
  });

  it('knows loopback from everything else', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', 'app.localhost', '::1', '[::1]', '::ffff:127.0.0.1']) expect(isLoopback(h), h).toBe(true);
    for (const h of ['0.0.0.0', '10.0.0.1', 'db.local', '::', 'localhost.evil.com', '']) expect(isLoopback(h), h).toBe(false);
  });

  it('writes IPv6 addresses out in full', () => {
    expect(normaliseIpv6('::1')).toBe('0000:0000:0000:0000:0000:0000:0000:0001');
    expect(normaliseIpv6('2001:DB8::8a2e:370:7334')).toBe('2001:0db8:0000:0000:0000:8a2e:0370:7334');
    expect(normaliseIpv6('::ffff:192.168.1.1')).toBe('0000:0000:0000:0000:0000:ffff:c0a8:0101');
    expect(normaliseIpv6('1::2::3')).toBeUndefined();
    expect(normaliseIpv6('1:2:3:4:5:6:7:8:9')).toBeUndefined();
    expect(normaliseIpv6('db.local')).toBeUndefined();
  });
});
