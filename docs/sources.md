# Sources

A source is data read into Puddle: a file on your computer, a file at a web address, a table on a web page, an OData feed, or rows pasted from the clipboard. Each source is a node on the canvas, and its data stays where it is. Puddle reads it in place each time and never copies it anywhere.

## Adding a source

**Add** in the toolbar offers five ways in under **Sources**; an empty project also has an **Add source** button on the canvas.

![The Add menu's Sources group: Choose files, From URL, From web page, From OData feed and Paste from clipboard](_static/screenshots/sources-menu.png)

Choose files
: Pick one or more files from your computer (shortcut: A). You can also drop files straight onto the canvas.

From URL
: Read a CSV, TSV, JSON, NDJSON, Parquet or XML file from an https address. Puddle fetches it again each time the project opens, and **Refresh** in the inspector fetches it on demand. The site must allow browsers to read it (CORS).

From web page
: Read a table from a web page, such as a list on Wikipedia. See [Tables on a web page](#tables-on-a-web-page).

From OData feed
: Read an entity set from an OData service, such as SAP, Dynamics or SharePoint lists. See [OData feeds](#odata-feeds).

Paste from clipboard
: Paste rows copied from a spreadsheet or a web page, or XML text, as a new source (shortcut: Ctrl+V on the canvas). Pasted rows are the one kind of data a project keeps, because there is no file to read them from again.

Puddle reads these formats:

| Format | Extensions | Notes |
| --- | --- | --- |
| CSV and TSV | `.csv`, `.tsv`, `.tab`, `.txt` | The delimiter, header row, encoding and quoting are detected, and can be changed in the inspector. Ragged rows are padded rather than rejected. |
| Spreadsheets | `.xlsx`, `.xlsm`, `.xls`, `.xlsb`, `.ods`, `.fods`, `.numbers`, `.dbf`, `.dif`, `.slk`, `.wk1` | Excel in every format since 97 (macros in an `.xlsm` are ignored), OpenDocument, Apple Numbers, dBase and FoxPro tables (also the data part of a Shapefile), and the old SYLK, DIF and Lotus 1-2-3 formats, all read the same way. Choose the sheet and, when it holds several tables, which one; the header row and how many rows it takes; an optional cell range; and whether merged cells are filled. |
| JSON and NDJSON | `.json`, `.ndjson`, `.jsonl` | An array of objects, or one object per line. |
| Parquet | `.parquet`, `.pq` | Read directly, with its column types. |
| XML | `.xml`, `.kml`, `.gpx` | The repeating element is read as rows (a KML file's placemarks, a GPX track's points). See [XML](#xml). |
| YAML, TOML and INI | `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg` | The list or map of records in the file is read as rows; nested fields become dotted columns. See [YAML, TOML, INI and GeoJSON](#yaml-toml-ini-and-geojson). |
| GeoJSON | `.geojson` | Each feature is a row: its properties as columns, its geometry as JSON. See [YAML, TOML, INI and GeoJSON](#yaml-toml-ini-and-geojson). |
| Log files | `.log`, `.txt` | Web server access logs, syslog, IIS logs and application logs with a timestamp and a level, each line taken apart into columns; or a custom pattern. See [Log files](#log-files). |
| Fixed width | `.txt`, `.prn`, `.dat` | Columns lined up with spaces, as mainframe and ERP reports print them. The boundaries are found from the columns of spaces and adjusted on a ruler. See [Fixed width and pipe tables](#fixed-width-and-pipe-tables). |
| Pipe table | `.txt` | Rows between `|` characters, as SAP lists and Markdown tables have them. The lines around the table are left out. See [Fixed width and pipe tables](#fixed-width-and-pipe-tables). |
| Word | `.docx` | The tables in a Word document. Choose the table; add the document's other tables as sources of their own. See [Word documents](#word-documents). |
| PDF | `.pdf` | The tables in the text of a PDF (a statement, an invoice, a published report), not scans. Choose the table; add the others as sources of their own. See [PDF files](#pdf-files). |
| Access | `.accdb`, `.mdb` | Choose the table; add the database's other tables as sources of their own. See [Access databases](#access-databases). |
| Arrow | `.arrow`, `.feather`, `.ipc` | An Arrow IPC file, read with its column types. See [Compressed files, archives and Arrow files](#compressed-files-archives-and-arrow-files). |
| Compressed files and archives | `.gz`, `.zip` | Any of the above inside a gzip file or a zip archive. A zip with several files opens to the first and offers the rest. See [Compressed files, archives and Arrow files](#compressed-files-archives-and-arrow-files). |

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

## OData feeds

**From OData feed** reads an entity set from an OData service, the way Power Query's *OData Feed* does. Paste the service's address and choose **Connect**: Puddle reads the service's `$metadata` (or, if it has none, its service document) and lists its entity sets, with their columns. Pick one and choose **Add source**. Puddle reads every page of it, following the service's next links, so a service that pages its results by a few hundred rows still comes in whole.

![From OData feed connected to TripPin: the People entity set chosen, with its columns](_static/screenshots/sources-odata.png)

For example, to try it on Microsoft's sample service: paste `https://services.odata.org/TripPinRESTierService`, choose **Connect**, and add **People**. The address of one entity set works too, as copied from a browser's address bar; Puddle finds the service above it and fills in any query options the address carries.

Three optional fields narrow what's read, and the service does the work, so less comes over the network:

Columns
: `$select`: column names separated by commas, such as `UserName, FirstName, Age`. Empty reads every column.

Filter
: `$filter`, written in OData's own filter language, such as `Age gt 30` or `startswith(LastName,'W')`. If the service can't read it, Puddle shows the service's own message.

Rows
: `$top`: read at most this many rows.

The columns come in with the types `$metadata` gives them:

| OData type | Read as |
| --- | --- |
| `Edm.String`, `Edm.Guid`, enums | Text (a Guid as DuckDB's `UUID`) |
| `Edm.Int16`, `Edm.Int32`, `Edm.Int64`, `Edm.Byte`, `Edm.SByte` | Whole numbers |
| `Edm.Decimal`, `Edm.Double`, `Edm.Single` | Decimals, with the precision and scale `$metadata` gives where it gives them |
| `Edm.Boolean` | True or false |
| `Edm.Date` | A date |
| `Edm.DateTime`, `Edm.DateTimeOffset` | A timestamp; one with an offset is converted to UTC |
| `Edm.TimeOfDay`, `Edm.Time` | A time of day |
| Complex types, collections, geography, `Edm.Duration`, `Edm.Binary` | Their text, as JSON for structured values; use a step to pull out what you need |

Both versions of OData that services still speak are read: version 4, and versions 2 and 3 (the JSON with `d` that older SAP and SharePoint services send). Navigation properties (links to other entity sets) are left out; add the other entity set as its own source and join the two.

### Signing in

If the service needs a sign-in, choose **Basic** (a user name and password) or **Bearer token** under **Sign-in** before you connect. The sign-in is kept in this browser tab only: it is never saved in the project, its `.puddle.json` file, a recipe or a sync. Reopen the project in a new tab and the source asks for it again in the inspector, under **Sign in and read**.

### Services that block other sites

Puddle reads the feed straight from your browser, with no server of its own in between, so the service has to allow other sites to read it (CORS). Some public services do; many company services don't, and then Puddle says that the service blocked it. A service that needs a sign-in must also allow the Authorization header. Ask the service's owner to allow Puddle's address, or export the data from the service as a file and add that instead.

Like a file from a web address, the feed is read again each time the project opens, and **Refresh** reads it on demand; if its rows changed, Puddle says so.

`puddle-run` reads OData feeds itself (with no CORS limits, since it runs outside a browser), except those that need a sign-in, which it can't give yet; its `check` says so.

## XML

An XML file holds its records as an element repeated under one parent, such as each `<book>` in a `<catalog>` or each `<entry>` in an Atom feed. Puddle finds the repeating elements and reads the likeliest one as rows, one row per element. Attributes and child elements become columns:

```xml
<book id="bk102">
  <title>Good Omens</title>
  <price currency="GBP">9.50</price>
  <author>Terry Pratchett</author>
  <author>Neil Gaiman</author>
</book>
```

gives the columns *id*, *title*, *price*, *price.currency* and *author*. A nested element is named by its path, such as *address.city*. Namespace prefixes are dropped. Values are typed the way a CSV's are, so *9.50* is a number and dates are dates, and text keeps its spaces for the cleaning steps.

An element that repeats inside a record, like the two authors above, stays in one column as a JSON list: `["Terry Pratchett","Neil Gaiman"]`. To give each one a row of its own instead, with the record's other values repeated, choose it under **A row for each** in the inspector.

The inspector lists every repeating element under **Record element**, with how many there are, so you can read another one as the rows (each author, say).

XML can come from a file, from a web address (Puddle recognises `.xml` addresses and servers that say they send XML, including Atom and RSS feeds), or pasted as text. Puddle reads it in your browser, a piece at a time, so a large file doesn't have to fit in memory as a document; the rows it finds do. `puddle-run` reads XML sources the same way.

## Fixed width and pipe tables

A report printed to text often has no delimiter at all: each column starts at the same character position on every line, padded with spaces. Puddle reads such a file as **fixed width**. It finds the boundaries from the columns of spaces that run down the table, cuts every line at them, trims the cells and names the columns from the first line. The inspector shows the first lines on a ruler with a marker at each boundary: click between two characters to add one, drag a marker to move it (or focus it and press the arrow keys), and click a marker (or press Delete) to remove it. Every node after the source updates as the boundaries change. The header row, lines to skip at the top and bottom, the encoding and the words that count as empty are read options as for CSV.

An SAP list, and a Markdown table, writes its rows between `|` characters, with rules of dashes between them and banners, page headers and footers around them. Puddle reads such a file as a **pipe table**: only the lines between pipes are rows, rules and a header printed again on a later page are dropped, the empty columns the edge pipes would make are left out, and every cell is trimmed. The inspector says how many lines around the table were left out. A total row at the end is kept, and listed as a suggested fix on the Issues panel, because removing data is your call.

Both are read in your browser into rows that DuckDB then types, so the amounts and dates are read as on any text file: German amounts with a trailing minus, as SAP writes them, are a Parse numbers fix away. `puddle-run` reads both the same way, with the boundaries the project saved.

## Log files

A log file has one entry per line in a shape its writer chose. Puddle knows four and reads the lines into columns, which DuckDB then types like any CSV:

| Lines | Columns |
|---|---|
| Web server access log (Apache, nginx; the combined and common formats) | `host`, `ident`, `user`, `time` (as a timestamp), `method`, `path`, `protocol`, `status`, `bytes`, `referrer`, `agent` |
| Syslog (the old `Oct 11 22:14:15 host process[pid]: message` line and RFC 5424) | `priority`, `time`, `host`, `process`, `pid`, `id`, `data`, `message` |
| IIS log (W3C extended) | The fields the `#Fields:` line at the top names |
| Application log | `time`, `level`, `message`; a line without a timestamp (a stack trace) joins the message above it |

The shape is detected from the first lines and shown as **Lines** in the inspector, where another can be chosen. **Custom pattern** takes a regular expression with a named group for each column, such as `(?<time>\S+) (?<level>\w+) (?<message>.*)`; lines that fit no pattern are left out, and the inspector says how many. A `-` in an access or IIS log reads as empty. A log written as CSV, TSV or JSON lines is read as that format. `puddle-run` reads the same lines the same way.

## YAML, TOML, INI and GeoJSON

Configuration and small data sets often come as YAML, TOML or INI rather than CSV. Puddle parses the file and looks for the records in it: a list of objects (a YAML list, a TOML `[[array of tables]]`), or a map whose entries are records (INI sections, TOML `[server.alpha]` tables), where each entry becomes a row with its name in a `key` column. The biggest list wins; the inspector lists every place records were found under **Records**, and **The whole document, as one row** reads the top-level keys as columns. Nested maps become dotted columns (`owner.email`), lists inside a record are kept as JSON text, and a YAML file of several documents (separated by `---`) reads each as a row.

A GeoJSON file reads each feature as a row: its `id` where it has one, its properties as columns and its geometry as JSON text, which a step can pull coordinates out of. KML and GPX files are XML, read with the placemarks or track points as the record element; a KMZ is a zipped KML and opens as one.

The rows are typed by DuckDB as on any CSV, so numbers, dates and booleans written as text are a Parse step away. `puddle-run` reads all of them the same way.

## Word documents

A report or a specification often holds its data as a table in a Word document. Add the `.docx` file and Puddle reads its tables: the biggest opens first, and the inspector lists every table under **Table**, named by its caption or the heading above it, with its size. A cell merged across columns is repeated across them and one merged down rows takes the value above, so every row has every column, as Word shows it. The first row is the header unless **First row is the header** is turned off, and tracked deletions are left out.

**Add the other tables** adds a source for each table not yet on the canvas, reading the same document. Old `.doc` files aren't read: open them in Word and save as `.docx`. The rows are typed by DuckDB as on any CSV, and `puddle-run` reads the same table.

## PDF files

A statement, an invoice or a published report often holds its figures as a table in a PDF. Add the file and Puddle reads the text of every page: lines of two or more pieces of text one under the other are a table, their pieces lined up into columns by where they sit on the page, so right-aligned amounts fall under their heading. The biggest table opens first; the inspector lists every table under **Table**, named by the line above it and its page, and **Add the other tables** adds the rest as sources sharing the file. The first row is the header unless **First row is the header** is turned off.

Only text PDFs are read. A scanned page is a picture, and Puddle says so rather than guessing at it: export the table from the program that made the PDF, or run the scan through OCR first and add the text that gives. A PDF that needs a password is refused with a message to remove it. The rows are typed by DuckDB as on any CSV (amounts with thousands separators are a Parse numbers step away), and `puddle-run` reads the same table.

## Access databases

An Access database (`.accdb`, or `.mdb` from Access 2003 and before) holds several tables. Add the file like any other and Puddle reads its first table; the inspector lists every table with its size under **Table**, so you can read another one instead. **Add the other tables** adds a source for each table not yet in the project, reading the same file, so you can join them on the canvas or see how they relate in the Relationships view.

![An Access database read as a source: its table picker and the button that adds its other tables](_static/screenshots/sources-access.png)

The columns keep their Access types:

| Access type | Read as |
| --- | --- |
| Short Text, Long Text, Hyperlink | Text |
| Number (Byte, Integer, Long Integer), AutoNumber | Whole numbers of the same size |
| Number (Single, Double) | Decimals |
| Currency, Number (Decimal) | Exact decimals, so no pennies are lost to rounding |
| Large Number | A big whole number |
| Date/Time | A timestamp, as written in Access (Access keeps no time zone) |
| Yes/No | True or false |
| Replication ID | Text |
| Attachment | The attached files' names |
| OLE Object, binary | Bytes (`BLOB`) |

Only the tables are read: queries, forms and reports stay in Access. Linked tables point to data elsewhere, so they are left out; add that data directly. A database encrypted with a password can't be opened: in Access, remove the password (*File › Info › Decrypt Database*), save it, and add it again. Like an Excel workbook, the database is read into memory whole, so for a very large one (Puddle warns above 200 MB) export the tables you need from Access as CSV.

Puddle reads the database in your browser; nothing is uploaded. When you open the project again, choose the database once and every table read from it connects. `puddle-run` reads Access tables the same way, with the same types.

## Compressed files, archives and Arrow files

A file inside a gzip file or a zip archive is added like any other: choose the `.gz` or `.zip`, and Puddle opens it for the file inside, which is read as what it is (a CSV, a workbook, an XML file, whatever the bytes say). The source is named for the file inside, and the canvas says where it came from ("CSV in zip").

A gzipped CSV, TSV, JSON or NDJSON file is handed to DuckDB as it is and unpacked as it is read, so a large `.csv.gz` is never unpacked whole into memory. Anything else, and every file in a zip, is unpacked in your browser first.

A zip with several files opens to its first data file. The inspector lists every file in the archive under **File inside**, so you can read another one instead, and **Add the other files** adds a source for each file not yet in the project, reading the same archive. Folders, and the `__MACOSX` and `.DS_Store` entries a Mac adds, are left out.

An Arrow IPC file (`.arrow`, `.feather`, or `.ipc`) is read with its column types: whole numbers, decimals, dates, timestamps, booleans and text keep their types, and structured values (lists, structs) are read as JSON text. Like a workbook, the file is read into memory whole.

When you open the project again, choose the archive once and every file read from it connects. `puddle-run` reads all three the same way, with the same types. Bzip2 and zstd files, and tar archives, aren't opened: unpack them, or pack the file as gzip or zip.

## Read options

Select a source to see how it is read in the inspector. For a CSV file that is the delimiter, whether the first row is the header, the encoding, the quote character and which values count as empty (such as `NA` or `n/a`). Change any of them and every node after the source updates.

![A CSV source selected, with its read options in the inspector](_static/screenshots/screen-overview.png)

An Excel source shows the workbook's sheets with their sizes, the header row it detected (often below a title or a few blank rows), and the cell range being read. A sheet with several blocks of cells, with blank rows between them, holds several tables: the largest is read, **Table** picks another, and **Add the other tables** adds a source for each of the rest, reading the same file. A header over two or three rows (quarters merged over their months) is detected from the merged cells, or set with **Header rows**, and the names are joined (`Q1 Jan`). **Fill merged cells**, on by default, gives every cell of a merged cell its value, so a region merged down its stores is on each row; switched off, the rows below the first read as empty and the Issues panel lists the merged cells. An Access source shows the database's tables (see [Access databases](#access-databases)). An XML source shows its record element and what gets a row of its own (see [XML](#xml)). A fixed-width source shows its first lines on a ruler with the column boundaries (see [Fixed width and pipe tables](#fixed-width-and-pipe-tables)).

A file source also has **Path to this file** under *On the runner*: where `puddle-run` finds the file when it runs the project outside the browser (see {doc}`self-hosting`). Left empty, the runner looks for the file by name beside the project file or in a `sources/` folder there.

![An Excel workbook read as a source, with its sheet, header row and cell range](_static/screenshots/sources-excel.png)

## Large files

Files are read from disk in pieces, so a source can be larger than your computer's memory. Above a row threshold (five million rows unless you change **Sample above** in the project's settings) Puddle previews, profiles and checks rules on the first rows of each large source so editing stays fast. The results say when you're looking at a sample, one click runs on the full data, and exports always read everything.

**Keep result in memory**, in the inspector of any node, stores that node's result inside DuckDB so the nodes after it read it rather than re-running everything before it. It's worth turning on after an expensive step, such as a join of two big files.

## Reopening a project

Projects save how to read each file, not the file itself. When you reopen a project, a note headed **Files from last time** lists the files it needs. In Chrome or Edge, Puddle asks once for permission and reconnects every file in one click. Firefox and Safari can't keep access to files between visits, so the note's button (**Choose 2 files**, say) takes them all in one go: pick every file at once, and each goes to the source with its name (a renamed file goes to the one source of its kind still waiting). You can also choose a file from its own node. Either way, Puddle checks that the file you choose is the one the project was built on.
