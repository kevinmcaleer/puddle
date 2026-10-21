// A throwaway RSA key for the tests of the drivers that sign in with one (BigQuery's service account, Snowflake's
// key pair): made in the process with WebCrypto, so no key is ever kept in the repository. The recorded exchanges
// hold no signature (http.ts `redact`), so any key replays them.
import { base64url } from '../../src/connect/drivers/http';

let made: Promise<string> | undefined;

/** An unencrypted PKCS#8 PEM, the same one for the whole test run. */
export function testPrivateKeyPem(): Promise<string> {
  made ??= (async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const b64 = base64url(der).replaceAll('-', '+').replaceAll('_', '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return `-----BEGIN PRIVATE KEY-----\n${padded.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  })();
  return made;
}

/** A service account's JSON key file around the test key, as BigQuery's secret is pasted. */
export async function testServiceAccountKey(tokenUri = 'http://127.0.0.1:18090/token'): Promise<string> {
  return JSON.stringify({ type: 'service_account', project_id: 'puddle-test', private_key_id: 'test', private_key: await testPrivateKeyPem(), client_email: 'puddle@puddle-test.iam.gserviceaccount.com', client_id: '0', token_uri: tokenUri });
}

/** The settings and secret a live test's URL names: `bigquery://project/dataset?key=<path>&endpoint=…` or `snowflake://user@account/database/schema?key=<path>&url=…&warehouse=…&role=…`. */
export function keyedUrl(url: string): { url: URL; keyPath: string | undefined } {
  const u = new URL(url);
  return { url: u, keyPath: u.searchParams.get('key') ?? undefined };
}
