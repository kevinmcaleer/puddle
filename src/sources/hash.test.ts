import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashBytes, headHash, sha256 } from './hash';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const nodeSha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('sha256', () => {
  it('matches the known vectors', () => {
    expect(hex(sha256(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node crypto across block boundaries', () => {
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
      expect(hex(sha256(bytes))).toBe(nodeSha(bytes));
    }
  });
});

describe('hashBytes without a secure context', () => {
  // Regression: served over plain http on a LAN address, crypto.subtle is undefined and adding a source threw "reading 'digest'".
  it('falls back and gives the same hash as crypto.subtle', async () => {
    const bytes = new Uint8Array(readFileSync('tests/fixtures/customers.parquet'));
    const fallback = await hashBytes(bytes, null);
    expect(fallback).toBe(await hashBytes(bytes));
    expect(fallback).toBe(nodeSha(bytes));
  });

  it('headHash works when crypto.subtle is missing', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      expect(await headHash(new Blob([new TextEncoder().encode('abc')]))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, 'subtle', original);
    }
  });
});
