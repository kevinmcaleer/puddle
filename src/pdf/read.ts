/**
 * The text runs of a PDF, page by page, through pdf.js. The library is loaded by the caller (src/pdf/browser.ts
 * with its worker, src/pdf/node.ts for the runner), so this module stays free of it.
 */
import type { PageText } from './tables';

export class PdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfError';
  }
}

/** The part of pdf.js's API this reads with. */
export interface PdfLibrary {
  getDocument(params: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean; disableFontFace?: boolean }): { promise: Promise<PdfDocument>; destroy(): Promise<void> };
}

export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

const isTextItem = (item: unknown): item is TextItem => typeof item === 'object' && item !== null && typeof (item as TextItem).str === 'string' && Array.isArray((item as TextItem).transform);

export const NO_TEXT = 'This PDF has no text to read: it is a scan, or its text is drawn as shapes. Puddle doesn’t read pictures of tables; export the table from the program that made the PDF, or run it through OCR first.';

/** Every page's text runs. Throws a PdfError when the file isn't a PDF, needs a password, or holds no text at all. */
export async function readPdfPages(bytes: Uint8Array, pdfjs: PdfLibrary): Promise<PageText[]> {
  let doc: PdfDocument;
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true });
  try {
    doc = await task.promise;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/password/i.test(message)) throw new PdfError('This PDF needs a password to open. Remove the password in the program that made it, then add it again.');
    throw new PdfError(`This isn’t a PDF Puddle can read (${message}). Save it again as a PDF, or export the table as CSV.`);
  }
  try {
    const pages: PageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const runs = content.items.filter(isTextItem).filter((i) => i.str.trim().length > 0).map((i) => ({ text: i.str, x: i.transform[4] ?? 0, y: i.transform[5] ?? 0, width: i.width, height: i.height || Math.abs(i.transform[3] ?? 0) || Math.abs(i.transform[0] ?? 0) }));
      pages.push({ page: n, runs });
    }
    if (!pages.some((p) => p.runs.length)) throw new PdfError(NO_TEXT);
    return pages;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
