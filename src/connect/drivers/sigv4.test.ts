import { describe, expect, it } from 'vitest';
import { amzDate, canonicalParts, sha256Hex, signRequest } from './sigv4';

describe('Signature V4', () => {
  it('signs the request as AWS’s own worked example does (IAM ListUsers, 30 August 2015)', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: '',
      region: 'us-east-1',
      service: 'iam',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(headers['x-amz-date']).toBe('20150830T123600Z');
    expect(headers).not.toHaveProperty('host');
    expect(headers.Authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  });

  it('carries a session token as a signed header', async () => {
    const headers = await signRequest({ method: 'POST', url: 'http://127.0.0.1:18092/', headers: {}, body: '{}', region: 'eu-west-2', service: 'dynamodb', credentials: { accessKeyId: 'k', secretAccessKey: 's', sessionToken: 't' }, now: new Date('2026-10-21T00:00:00Z') });
    expect(headers['x-amz-security-token']).toBe('t');
    expect(headers.Authorization).toMatch(/SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/);
  });

  it('writes dates, sorts and encodes the query, and hashes the payload as the canonical request needs', async () => {
    expect(amzDate(new Date('2026-10-21T04:05:06.789Z'))).toEqual({ date: '20261021T040506Z', day: '20261021' });
    expect(canonicalParts('https://x.example:8443/a b/c?z=1&a=2&a=1')).toEqual({ host: 'x.example:8443', path: '/a%20b/c', query: 'a=1&a=2&z=1' });
    expect(canonicalParts('http://h/').path).toBe('/');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
