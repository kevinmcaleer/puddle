# Sources

A source is data read into Puddle: a file on your computer, a file at a web address, a table on a web page, or rows pasted from the clipboard. Each source is a node on the canvas, and its data stays where it is. Puddle reads it in place each time and never copies it anywhere.

## Adding a source

**Add** in the toolbar offers four ways in under **Sources**; an empty project also has an **Add source** button on the canvas.

![The Add menu's Sources group: Choose files, From URL, From web page and Paste from clipboard](_static/screenshots/sources-menu.png)

Choose files
: Pick one or more files from your computer (shortcut: A). You can also drop files straight onto the canvas.

From URL
: Read a CSV, TSV, JSON, NDJSON or Parquet file from an https address. Puddle fetches it again each time the project opens, and **Refresh** in the inspector fetches it on demand. The site must allow browsers to read it (CORS).

From web page
: Read a table from a web page, such as a list on Wikipedia. See [Tables on a web page](#tables-on-a-web-page).

Paste from clipboard
: Paste rows copied from a spreadsheet or a web page as a new source (shortcut: Ctrl+V on the canvas). Pasted rows are the one kind of data a project keeps, because there is no file to read them from again.

Puddle reads these formats:

| Format | Extensions | Notes |
| --- | --- | --- |
| CSV and TSV | `.csv`, `.tsv`, `.tab`, `.txt` | The delimiter, header row, encoding and quoting are detected, and can be changed in the inspector. Ragged rows are padded rather than rejected. |
| Excel | `.xlsx` | Choose the sheet, the header row and an optional cell range. |
| JSON and NDJSON | `.json`, `.ndjson`, `.jsonl` | An array of objects, or one object per line. |
| Parquet | `.parquet`, `.pq` | Read directly, with its column types. |

## Tables on a web page

**From web page** reads a table from a page, the way Power Query's *From Web* does. Paste the page's address and choose **Find tables**: Puddle lists every table on the page, named by its caption or the heading above it, with its size and a preview of its first rows. The biggest table is chosen to start with, since it's usually the one the page is about. Pick the one you want and choose **Add source**.

![From web page with Wikipedia's list of James Bond films: the Eon Productions films table chosen, with its first rows](_static/screenshots/sources-web-page.png)

For example, to get every James Bond film: paste `https://en.wikipedia.org/wiki/List_of_James_Bond_films`, choose **Find tables**, pick the table of films, and add it. The columns come in typed, so the year is a number, and Puddle tidies what a table shows rather than what its HTML holds:

- A header over two rows becomes one name per column, such as *Box office Actual*.
- A cell spanning several rows (one actor across five films) is repeated in each row.
- Footnote markers such as *[12]*, hidden sort keys and edit links are dropped.
- A table with no header row takes its first row as the column names.

The source keeps the page's address and which table it reads. Like a file from a web address, the page is fetched again each time the project opens, and **Refresh** fetches it on demand; if the table changed, Puddle says so. If tables are added above it, Puddle still finds it by its name.

Puddle reads the page straight from your browser, so the site has to allow it, and most sites don't (CORS). Wikipedia's pages are read through Wikipedia's own API, which does allow it, so any Wikipedia article works. For any other site that refuses, Puddle says so and offers **Paste instead**: select the table on the page in your browser, copy it, and paste it into the box. The table's HTML comes with it, so its columns stay intact, and it's added like other pasted rows, kept in the project. Pasting the page's HTML source works too.

`puddle-run` can't read a table on a web page yet; its `check` says so.

## Read options

Select a source to see how it is read in the inspector. For a CSV file that is the delimiter, whether the first row is the header, the encoding, the quote character and which values count as empty (such as `NA` or `n/a`). Change any of them and every node after the source updates.

![A CSV source selected, with its read options in the inspector](_static/screenshots/screen-overview.png)

An Excel source shows the workbook's sheets with their sizes, the header row it detected (often below a title or a few blank rows), and the cell range being read.

A file source also has **Path to this file** under *On the runner*: where `puddle-run` finds the file when it runs the project outside the browser (see {doc}`self-hosting`). Left empty, the runner looks for the file by name beside the project file or in a `sources/` folder there.

![An Excel workbook read as a source, with its sheet, header row and cell range](_static/screenshots/sources-excel.png)

## Large files

Files are read from disk in pieces, so a source can be larger than your computer's memory. Above a row threshold (five million rows unless you change **Sample above** in the project's settings) Puddle previews, profiles and checks rules on the first rows of each large source so editing stays fast. The results say when you're looking at a sample, one click runs on the full data, and exports always read everything.

**Keep result in memory**, in the inspector of any node, stores that node's result inside DuckDB so the nodes after it read it rather than re-running everything before it. It's worth turning on after an expensive step, such as a join of two big files.

## Reopening a project

Projects save how to read each file, not the file itself. When you reopen a project in Chrome or Edge, Puddle asks once for permission and reconnects every file in one click. Firefox and Safari can't keep access to files between visits, so each source asks you to choose its file again, and Puddle checks that the file you choose has the columns the project expects.
