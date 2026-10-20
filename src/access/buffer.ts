// mdb-reader's browser build reads with Node's Buffer, which browsers lack: give it the buffer package's.
import { Buffer } from 'buffer';

(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
