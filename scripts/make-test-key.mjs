// A throwaway RSA key for the stand-ins and live tests of the drivers that sign in with a key (BigQuery, Snowflake):
// an unencrypted PKCS#8 PEM and a service account's JSON key file around it, naming a token endpoint. Made fresh
// each time (CI makes one per job); never a real key, and never committed.
//
//   node scripts/make-test-key.mjs <directory> [token_uri]
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/make-test-key.mjs <directory> [token_uri]');
  process.exit(2);
}
const tokenUri = process.argv[3] ?? 'http://127.0.0.1:18090/token';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'test.p8'), pem);
writeFileSync(
  join(dir, 'bigquery-key.json'),
  JSON.stringify({ type: 'service_account', project_id: 'puddle-test', private_key_id: 'test', private_key: pem, client_email: 'puddle@puddle-test.iam.gserviceaccount.com', client_id: '0', token_uri: tokenUri }, null, 2) + '\n',
);
console.log(`Wrote ${join(dir, 'test.p8')} and ${join(dir, 'bigquery-key.json')} (token endpoint ${tokenUri}).`);
