// The onboarding samples: small, deliberately messy datasets shipped in public/samples (written by
// scripts/make-samples.mjs), served with the app and precached by the service worker so they work offline.

export interface SampleFile {
  /** The file under public/samples. */
  file: string;
}

export interface Sample {
  id: string;
  /** The card's title; the project is named after it. */
  title: string;
  /** One line on the card: what is wrong with it. */
  blurb: string;
  files: SampleFile[];
  /** The project note (Markdown): what is wrong with the data, and where to start. */
  note: string;
}

export const SAMPLES = [
  {
    id: 'contacts',
    title: 'Contact list',
    blurb: 'Stray spaces, mixed capitals, blank emails and duplicate rows.',
    files: [{ file: 'contacts.csv' }],
    note: `## Contact list (sample)

A contact list typed in by hand and pasted together from two exports. What’s wrong with it:

- **Stray spaces** at either end of \`name\`, \`email\` and \`city\`, and doubled spaces inside some names.
- **Mixed capitals**: “DEV JONES”, “alice patel” and “Bob Nguyen” in one column; “MANCHESTER” and “manchester” in another.
- **Blank emails** on a few rows.
- **Duplicate rows**: five contacts appear twice.

Try it: select \`name\` and \`city\` in the results and use **Trim**, **Collapse spaces** and **Case** on the quick-fix bar, then **Remove duplicates**. The Rules section in the inspector suggests rules that hold once it’s clean.

This is a sample project. Delete it from the projects list when you’re done.`,
  },
  {
    id: 'sales',
    title: 'Sales',
    blurb: 'Dates in four formats, amounts with currency symbols, untidy regions.',
    files: [{ file: 'sales.csv' }],
    note: `## Sales (sample)

A year of orders from three shops, each writing things its own way. What’s wrong with it:

- **Mixed date formats** in \`order_date\`: 2024-05-28, 24/01/2024, 16 Feb 2024 and “April 28, 2024”.
- **Amounts stored as text** in \`amount\`: currency symbols (£1530.44), thousands separators, and codes after the number (496.63 EUR).
- **Untidy currencies**: \`currency\` has “GBP”, “gbp” and “ GBP”.
- **Regions** in mixed case, with stray spaces, “n/a” and blanks.

Try it: select \`order_date\` and use **Parse dates**, select \`amount\` and use **Parse numbers**, then tidy \`currency\` and \`region\` with **Trim** and **Case**.

This is a sample project. Delete it from the projects list when you’re done.`,
  },
  {
    id: 'orders',
    title: 'Orders and customers',
    blurb: 'Two tables to join, with customer ids that don’t quite match.',
    files: [{ file: 'orders.csv' }, { file: 'customers.csv' }],
    note: `## Orders and customers (sample)

Orders from the shop, and the customer list they belong to. What’s wrong with it:

- **Ids that don’t match**: \`customer_id\` in orders has stray spaces (“C004 ”) and lower case (“c017”), so a join on it misses rows.
- **Orphan orders**: two orders name customers (C099, C120) who aren’t in the customer list.

Try it: add a Transform after orders.csv, **Trim** and upper-case \`customer_id\`, then select it and customers.csv and **Join** them on \`customer_id\`.

This is a sample project. Delete it from the projects list when you’re done.`,
  },
  {
    id: 'monthly',
    title: 'Monthly sales',
    blurb: 'A wide table to unpivot, with gaps written three ways.',
    files: [{ file: 'monthly-sales.csv' }],
    note: `## Monthly sales (sample)

Takings per store, laid out like a spreadsheet report. What’s wrong with it:

- **Wide, not long**: one column per month (\`jan_2024\` to \`dec_2024\`), so it can’t be filtered or charted by month.
- **Gaps written three ways**: “n/a”, “-” and blank.
- **Numbers stored as text**: some have thousands separators (“28,512”).

Try it: add a Transform, use **Unpivot columns** to turn the month columns into \`month\` and \`sales\`, then **Parse numbers** on \`sales\`.

This is a sample project. Delete it from the projects list when you’re done.`,
  },
] as const satisfies readonly Sample[];

export type SampleId = (typeof SAMPLES)[number]['id'];

export const sampleById = (id: string): Sample | undefined => SAMPLES.find((s) => s.id === id);

/** The project name for a sample: labelled as one on the home screen. */
export const sampleProjectName = (sample: Sample) => `Sample: ${sample.title.toLowerCase()}`;

const FILES = new Set<string>(SAMPLES.flatMap((s) => s.files.map((f) => f.file)));

/** True for a file Puddle ships as a sample; anything else in a project's `url.sample` is ignored. */
export const isSampleFile = (file: string | undefined): file is string => file != null && FILES.has(file);

/** Where a sample file is served: next to the app, wherever it is hosted. */
export const sampleAddress = (file: string, base: string) => new URL(`samples/${encodeURIComponent(file)}`, base);
