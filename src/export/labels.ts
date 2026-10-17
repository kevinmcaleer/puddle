import { EXPORT_FORMATS, type ExportFormat } from '../compiler';
import type { OutputNode } from '../model';

/** A format's name in menus, e.g. "Parquet"; the clipboard isn't a file, so it says what it does. */
export const formatName = (format: ExportFormat) => (format === 'clipboard' ? 'Copy to clipboard' : EXPORT_FORMATS[format].label);

/** What the export button says for an Output node's format, e.g. "Export CSV". */
export const exportLabel = (node: OutputNode) => (node.outputSpec.format === 'clipboard' ? 'Copy to clipboard' : `Export ${EXPORT_FORMATS[node.outputSpec.format].label}`);

/** The export menu's choices: every format, files first, with the node's own ticked. */
export const exportChoices = (node: OutputNode) =>
  (Object.keys(EXPORT_FORMATS) as ExportFormat[])
    .sort((a, b) => Number(a === 'clipboard') - Number(b === 'clipboard'))
    .map((format) => ({
      format,
      label: formatName(format),
      hint: format === 'clipboard' ? undefined : `.${EXPORT_FORMATS[format].ext}`,
      checked: node.outputSpec.format === format,
    }));
