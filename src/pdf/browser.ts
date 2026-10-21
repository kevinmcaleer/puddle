// pdf.js in the browser: the legacy build (it runs where Promise.try isn't yet), loaded on first use so the app's
// own bundle stays small, with its worker served by Vite as an asset.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { readPdfPages, type PdfLibrary } from './read';
import type { PageText } from './tables';

let library: Promise<PdfLibrary> | undefined;

async function load(): Promise<PdfLibrary> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // In the browser pdf.js parses in its own worker; in Node (tests) it finds its worker module itself.
  if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs as unknown as PdfLibrary;
}

/** The text runs of a PDF, page by page. */
export async function loadPdfPages(bytes: Uint8Array): Promise<PageText[]> {
  return readPdfPages(bytes, await (library ??= load()));
}
