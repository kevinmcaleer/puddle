// pdf.js for the runner: the legacy build, which runs in Node and finds its worker module itself. pdfjs-dist is a
// runtime dependency of puddle-run (scripts/runner-package.mjs), not bundled.
import { readPdfPages, type PdfLibrary } from './read';
import type { PageText } from './tables';

/** The text runs of a PDF, page by page. */
export async function loadPdfPages(bytes: Uint8Array): Promise<PageText[]> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfLibrary;
  return readPdfPages(bytes, pdfjs);
}
