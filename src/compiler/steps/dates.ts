// Parse dates: text to DATE or TIMESTAMP, trying the chosen strptime formats in order.
import { z } from 'zod';
import { ident, list, str, strList } from '../sql';
import { defineStep } from './registry';

const Columns = z.array(z.string().min(1)).min(1, 'pick at least one column');

/** Whether a strptime format reads a time of day as well as a date. */
export const hasTime = (format: string) => /%[HIMSfpTXcgnz]/.test(format);

export const parseDates = defineStep({
  type: 'parseDates',
  params: z.object({
    columns: Columns,
    formats: z.array(z.string().trim().min(1)).min(1, 'choose a date format'),
    /** Values no format reads become empty, or stop the flow with an error. */
    onError: z.enum(['empty', 'fail']).default('empty'),
  }),
  label: (p) => `Parsed ${p.columns.join(', ')} as ${p.formats.some(hasTime) ? 'date and time' : 'dates'}`,
  compile: (p, { input }) => {
    const formats = p.formats.length === 1 ? str(p.formats[0]!) : strList(p.formats);
    const fn = p.onError === 'fail' ? 'strptime' : 'try_strptime';
    const as = p.formats.some(hasTime) ? 'TIMESTAMP' : 'DATE';
    return `SELECT * REPLACE (${list(p.columns.map((c) => `CAST(${fn}(trim(CAST(${ident(c)} AS VARCHAR)), ${formats}) AS ${as}) AS ${ident(c)}`))}) FROM ${input}`;
  },
});
