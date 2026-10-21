// The hosts puddle-connect may connect to (plan section 4): an allowlist of host names (exact, or `*.suffix`),
// IPv4 addresses and CIDR ranges, and IPv6 addresses, read from PUDDLE_CONNECT_ALLOW. Nothing is implied: an empty
// list allows nothing, and loopback or the service's own network are reached only when listed. Pure.

export type AllowRule = { kind: 'host'; name: string } | { kind: 'suffix'; suffix: string } | { kind: 'ipv4'; base: number; bits: number } | { kind: 'ipv6'; address: string };

const ipv4 = (text: string): number | undefined => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
};

/** An IPv6 address written out in full lower case, so two spellings compare equal; undefined when it isn't one. */
export function normaliseIpv6(text: string): string | undefined {
  let t = text.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!/^[0-9a-f:.]+$/.test(t) || !t.includes(':')) return undefined;
  // A mapped IPv4 tail (::ffff:127.0.0.1) becomes two groups.
  const tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(t);
  if (tail) {
    const n = ipv4(tail[2]!);
    if (n === undefined) return undefined;
    t = `${tail[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = t.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return groups.map((g) => g.padStart(4, '0')).join(':');
}

/** The rules in a PUDDLE_CONNECT_ALLOW value: comma, space or newline separated. Anything unreadable is an error. */
export function parseAllow(text: string | undefined): { rules: AllowRule[]; errors: string[] } {
  const rules: AllowRule[] = [];
  const errors: string[] = [];
  for (const raw of (text ?? '').split(/[\s,]+/)) {
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    const cidr = /^(.+)\/(\d{1,3})$/.exec(item);
    if (cidr) {
      const base = ipv4(cidr[1]!);
      const bits = Number(cidr[2]);
      if (base === undefined || bits > 32) errors.push(`${raw} isn’t an IPv4 range like 10.0.0.0/8`);
      else rules.push({ kind: 'ipv4', base: bits === 0 ? 0 : (base & (0xffffffff << (32 - bits))) >>> 0, bits });
      continue;
    }
    const n = ipv4(item);
    if (n !== undefined) {
      rules.push({ kind: 'ipv4', base: n, bits: 32 });
      continue;
    }
    const six = normaliseIpv6(item);
    if (six) {
      rules.push({ kind: 'ipv6', address: six });
      continue;
    }
    if (item.startsWith('*.')) {
      if (!/^\*\.[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(item)) errors.push(`${raw} isn’t a host pattern like *.example.com`);
      else rules.push({ kind: 'suffix', suffix: item.slice(1) });
      continue;
    }
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.?$/.test(item)) rules.push({ kind: 'host', name: item.replace(/\.$/, '') });
    else errors.push(`${raw} isn’t a host name, address or range`);
  }
  return { rules, errors };
}

/** Whether a host (a name or an address, as typed in a connection) is on the list. Nothing is allowed by an empty list. */
export function isAllowed(host: string, rules: AllowRule[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h) return false;
  const n = ipv4(h);
  const six = normaliseIpv6(h);
  for (const r of rules) {
    if (r.kind === 'ipv4' && n !== undefined && (r.bits === 0 || ((n & (0xffffffff << (32 - r.bits))) >>> 0) === r.base)) return true;
    if (r.kind === 'ipv6' && six && six === r.address) return true;
    if (r.kind === 'host' && n === undefined && !six && h === r.name) return true;
    if (r.kind === 'suffix' && n === undefined && !six && h.endsWith(r.suffix) && h.length > r.suffix.length) return true;
  }
  return false;
}

/** A loopback address or name: where the local service binds, and the only place it may run without a token. */
export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const n = ipv4(h);
  if (n !== undefined) return n >>> 24 === 127;
  const six = normaliseIpv6(h);
  return six === '0000:0000:0000:0000:0000:0000:0000:0001' || six === '0000:0000:0000:0000:0000:ffff:7f00:0001';
}
