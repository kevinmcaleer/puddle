// Stands in for browserify-aes and create-hash in the browser build (see vite.config.ts). mdb-reader only needs
// them for databases encrypted with a password, and they pull in Node's streams, which browsers lack.
import { ENCRYPTED, AccessError } from './types';

const refuse = (): never => {
  throw new AccessError(ENCRYPTED);
};

export const createHash = refuse;
export const createDecipheriv = refuse;
export default refuse;
