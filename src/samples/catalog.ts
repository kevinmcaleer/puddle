// The onboarding samples: small, deliberately messy datasets shipped in public/samples (written by
// scripts/make-samples.mjs), served with the app and precached by the service worker so they work offline.
// The taxi tutorial's files are too big to ship; Puddle's server passes them through from the TLC (deploy/nginx.conf).

export interface SampleFile {
  /** The file under public/samples, or the file's name when it is served from `path`. */
  file: string;
  /** Where it is served beside the app, when it isn't shipped in public/samples. */
  path?: string;
  /** The rows the file reads as, when that isn't one per line after the header (a banner, a footer, blank lines). */
  rows?: number;
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
  /** The project's name, when it isn't "Sample: <title>". */
  projectName?: string;
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
  {
    id: 'crm',
    title: 'CRM export',
    projectName: 'Sample: CRM export',
    blurb: 'A text export with comment lines, a footer, a header pasted in twice and ragged rows.',
    files: [{ file: 'messy.txt', rows: 45 }],
    note: `## CRM export (sample)

A customer list exported from a CRM, then pasted together with a second export and edited by hand. What’s wrong with it:

- **Comment lines** above the header and a **row count** after the table. Puddle skips both when it reads the file (see Read options in the inspector).
- **The header pasted in again** half way down, where the second export was added.
- **Duplicate rows**: four customers appear twice.
- **Ragged rows**: one row is two cells short, one has an extra cell.
- **Untidy text**: stray and doubled spaces, mixed capitals, non-printing characters, empty values written five ways, dates in three formats and amounts as text.

Try it: with the source selected, use **Fix all** on the Issues panel. It drops the repeated header and the duplicates and tidies the text in one go; the date and number issues it leaves are suggestions, one click each.

This is a sample project. Delete it from the projects list when you’re done.`,
  },
  {
    id: 'sap',
    title: 'SAP extract',
    projectName: 'Sample: SAP extract',
    blurb: 'A report printed to text: banners, separator lines, a page break and a total row.',
    files: [{ file: 'sap-extract.txt', rows: 61 }],
    note: `## SAP extract (sample)

Vendor line items printed from SAP to a text file, as a report rather than a table. Puddle reads it as a pipe table: the rows between the pipes, with the banner, the separator lines, the page break with its header printed again, and the footer left out, and the padding trimmed. What’s wrong with it once read:

- **A total row** at the end, marked with an asterisk, read as a row of the table.
- **Amounts in German notation** (7.625,43) with a trailing minus for a negative, which read as text.

Try it: **Fix all** on the Issues panel parses the amounts with a comma for the decimal mark. Tick the total row's suggestion to remove it too, and the amounts sum to 192,474.66.

This is a sample project. Delete it from the projects list when you’re done.`,
  },
  {
    id: 'skewed',
    title: 'Skewed invoices',
    projectName: 'Sample: skewed invoices',
    blurb: 'A spreadsheet where a cell was deleted part way down, so the rows below sit a column over.',
    files: [{ file: 'skewed.xlsx', rows: 36 }],
    note: `## Skewed invoices (sample)

An invoice list kept in a spreadsheet. Someone deleted a cell in the Customer column on the 18th row, and every cell from there on moved a column to the left: the dates sit under Customer, the amounts under the dates, and the last column is empty from that row down. What’s wrong with it:

- **Rows shifted one column left** from Customer, from the 18th row on. The Issues panel lists the shift as one issue, with **Realign rows** as its fix.
- **Dates and amounts read as text** in the shifted rows, since the columns hold two kinds of value.

Try it: with the source selected, use **Fix all** on the Issues panel. Realign rows moves the cells back, and the steps after it give the dates and amounts their types.

This is a sample project. Delete it from the projects list when you’re done.`,
  },
  {
    id: 'merged',
    title: 'Merged report',
    projectName: 'Sample: merged report',
    blurb: 'A report sheet: a title, a two-row header, regions merged down their stores, subtotals and footnotes.',
    files: [{ file: 'merged.xlsx', rows: 16 }],
    note: `## Merged report (sample)

A regional sales report laid out for reading, not for data: a title across the top, quarters merged over their months in a two-row header, each region merged down the stores it covers, a subtotal row per region and a grand total, an empty spacer column, and a table of footnotes under the main one. Puddle reads the report table on its own (the footnotes are listed under **Table** in the read options, to add as a source of their own), joins the two header rows into names such as Q1 Jan, and fills each region down its stores. What’s wrong with it once read:

- **Total rows inside the data**: one per region and a grand total, which would count every figure twice.
- **An empty column**: the spacer between the figures and the notes.

Try it: with the source selected, open **Choose fixes** on the Issues panel, tick the total rows (a suggestion, since a total may be wanted) and apply: 11 stores remain, the spacer column gone.

This is a sample project. Delete it from the projects list when you’re done.`,
  },
] as const satisfies readonly Sample[];

/** Where the user guide is served, beside the app (the image builds it from docs/; see the Dockerfile). */
export const GUIDE_PATH = 'docs/';

/** The user guide's page for the taxi tutorial. */
export const TAXI_TUTORIAL_PAGE = `${GUIDE_PATH}tutorial-taxi.html`;

/**
 * The user guide's taxi tutorial as a project: a month of New York's yellow cab trips and the zone lookup, read
 * through Puddle's server from the TLC (whose own host doesn't let browsers read its files), not shipped.
 */
export const TAXI_TUTORIAL = {
  id: 'taxi',
  title: 'Taxi trips tutorial',
  blurb: 'Three million New York taxi trips, for the user guide’s tutorial.',
  projectName: 'Tutorial: three million taxi trips',
  files: [
    { file: 'yellow_tripdata_2024-01.parquet', path: 'tutorial-data/trip-data/yellow_tripdata_2024-01.parquet' },
    { file: 'taxi_zone_lookup.csv', path: 'tutorial-data/misc/taxi_zone_lookup.csv' },
  ],
  note: `## Tutorial: three million taxi trips

Every yellow cab trip in New York in January 2024 (2,964,624 rows), and the borough and name of each of the 265 zones they start and end in. The New York City Taxi and Limousine Commission (TLC) publishes them as open data; Puddle reads them from its site, and nothing is uploaded.

Both files are added already, so skip the tutorial’s first step and follow it from **Look before you clean**: [the taxi tutorial in the user guide](${TAXI_TUTORIAL_PAGE}).

This is a tutorial project. Delete it from the projects list when you’re done.`,
} as const satisfies Sample;

export type SampleId = (typeof SAMPLES)[number]['id'] | typeof TAXI_TUTORIAL.id;

const ALL: readonly Sample[] = [...SAMPLES, TAXI_TUTORIAL];

export const sampleById = (id: string): Sample | undefined => ALL.find((s) => s.id === id);

/** The project name for a sample: labelled as one on the home screen. */
export const sampleProjectName = (sample: Sample) => sample.projectName ?? `Sample: ${sample.title.toLowerCase()}`;

const FILES = new Map<string, SampleFile>(ALL.flatMap((s) => s.files.map((f): [string, SampleFile] => [f.file, f])));

/** True for a file Puddle ships or serves as a sample; anything else in a project's `url.sample` is ignored. */
export const isSampleFile = (file: string | undefined): file is string => file != null && FILES.has(file);

/** True for a sample file shipped in public/samples (small, and precached for offline use). */
export const isShippedFile = (file: string | undefined): file is string => isSampleFile(file) && FILES.get(file)!.path == null;

const servedPath = (file: string) => FILES.get(file)?.path ?? `samples/${encodeURIComponent(file)}`;

/** Where a sample file is served: next to the app, wherever it is hosted. */
export const sampleAddress = (file: string, base: string) => new URL(servedPath(file), base);

/** Where the app was served when a sample file was read from this address: the address minus the file's path. */
export const sampleBase = (file: string, href: string) => {
  const path = servedPath(file);
  return href.endsWith(path) ? href.slice(0, -path.length) : new URL('..', href).href;
};
