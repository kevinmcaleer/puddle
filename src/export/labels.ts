import { EXPORT_FORMATS } from '../compiler';
import type { OutputNode } from '../model';

/** What the export button says for an Output node's format, e.g. "Export CSV". */
export const exportLabel = (node: OutputNode) => (node.outputSpec.format === 'clipboard' ? 'Copy to clipboard' : `Export ${EXPORT_FORMATS[node.outputSpec.format].label}`);
