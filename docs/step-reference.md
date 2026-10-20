# Step reference

Every step a Transform node can hold, as the **Add** menu groups them. The same groups name the column menu's submenus, and the quick-fix bar's chips sit in the same order, so a step is found under one name wherever it is offered. Each step works on the columns you pick in its settings (it starts with the columns selected in the results), and is labelled in the step list by what it did, such as "Trimmed name, city". Steps marked **New column** in the menus add a column rather than changing one.

## Clean

| Step | What it does |
| --- | --- |
| Trim whitespace | Removes spaces from both ends of each value. |
| Collapse spaces | Turns runs of spaces inside a value into one space. |
| Remove non-printing characters | Removes invisible characters, such as the zero-width spaces and control characters left by copying from a web page. |
| Fix mangled characters | Puts back text that was saved in the wrong encoding, such as `Ã©` for `é` and `â€™` for `’`. |
| Empty text to empty value | Treats empty text (and text that is only spaces) as a missing value. |
| Replace values | Replaces whole values that match: a value you type, empty values, or blank text, with another value or with an empty value. A number or date column can be changed to text so a word such as `empty` fits. For text inside a value, use Find and replace. |

## Change type

| Step | What it does |
| --- | --- |
| Parse numbers | Reads text such as `£1,234.50`, `$99`, `(12.00)` or `€ 7,5` as numbers, with the decimal mark of the project's locale or one you choose. |
| Parse dates | Reads text as dates, even when one column mixes several formats. Puddle finds the formats the column uses, tries them in order, and settles day and month order from the values themselves, or asks. Values no format reads become empty, or stop the step with an error. See [How dates are read](#how-dates-are-read). |
| Change type | Converts columns to text, integer, decimal, boolean, date or timestamp. Values that don't convert become empty, or stop the step with an error. |

## Columns

| Step | What it does |
| --- | --- |
| Rename columns | Gives columns new names. |
| Remove columns | Drops the columns you pick. |
| Move columns to the front | Moves the columns you pick to the start, in the order you pick them. |
| Split by delimiter | Splits a column at a delimiter (a comma, a space, a tab or any text you type) into columns or into rows, at each occurrence, the left-most or the right-most. |
| Split by number of characters | Splits a column every so many characters, or once from the left or right, into columns or rows. |
| Split by position | Splits a column after the character counts you list. |
| Split by character transition | Splits a column where lower case changes to upper case (or back), or digits change to other characters (or back). |
| Merge columns | Joins columns into one with a separator, skipping empty values. |
| Add index column | Adds a new column numbering the rows, from 1 or a number you choose. |
| Duplicate column | Adds a new column: a copy of a column under a new name. |
| Add column from expression | Adds a new column calculated from the others with a DuckDB SQL expression, such as `price * quantity`. |

## Rows

| Step | What it does |
| --- | --- |
| Filter rows | Keeps (or removes) the rows that meet all, or any, of your conditions. |
| Sort rows | Sorts by one or more columns, each ascending or descending. |
| Remove top or bottom rows | Drops a number of rows from the start or the end, such as a title or a totals row. |
| Remove blank rows | Drops rows where every column is blank, or where the columns you pick are. |
| Remove duplicates | Keeps the first of each set of repeated rows, comparing whole rows or the columns you pick. It can instead keep only the rows that have duplicates, to look at them. |
| Fill down or up | Fills empty cells from the nearest value above (or below), as in a report that only names a group once. |
| Use first row as headers | Takes column names from the first row. |

## Text

| Step | What it does |
| --- | --- |
| Change case | UPPER CASE, lower case, Title Case or Sentence case. |
| Find and replace | Replaces text, optionally matching case or using a regular expression. Leave the replacement empty to remove what was found. |
| Extract text | Takes part of each value into a new column: the first or last characters, the text between two delimiters, or a regular expression group. |
| Pad text | Pads values to a length with a character at the start or end, such as leading zeros on codes. |
| Text length | Adds a new column with each value's length. |

## Dates

| Step | What it does |
| --- | --- |
| Extract date part | Adds a new column with the year, quarter, month (number or name), week of the year, day of the month, day of the week (number or name) or hour of a date, or puts it in place of the date. |
| Add or subtract time | Moves dates by a number of years, quarters, months, weeks, days, hours, minutes or seconds, the same for every row or taken from a column. |
| Time between dates | Adds a new column with the whole number of years, months, days or other units between two date columns. |
| Truncate dates | Rounds dates down to the start of their year, quarter, month, week (from Monday), day or hour. |
| Format dates as text | Writes dates as text in a format you choose, such as `%d/%m/%Y`. |

### How dates are read

When you add **Parse dates**, Puddle tries over 80 formats on a sample of the column (its first 1,000 values) and picks the fewest that together read every value it can, commonest first. A column holding `2024-05-28`, `24/01/2024`, `16 Feb 2024` and `April 28, 2024` gets all four formats, so every row is read. The form lists them with the share of values each reads; **Use the detected formats** puts them back if you've changed the list.

Puddle reads:

- ISO dates and times: `2024-01-24`, `2024-01-24 14:30`, `2024-01-24T14:30:00.250`, with `Z` or an offset such as `+01:00` (read as the time in UTC).
- Day and month as numbers, with `/`, `-` or `.` between them, four- or two-digit years, and times in 24-hour or 12-hour clock: `24/01/2024`, `24.01.24`, `01/24/2024 2:30 PM`.
- Month names, full or abbreviated and in any case, with or without the weekday: `24 January 2024`, `24-Jan-24`, `Jan. 24, 2024`, `Sept 3, 2024`, `Wednesday, 24 January 2024`.
- Ordinals: `24th January 2024`, `March 3rd, 2024`, `1st of May 2024`.
- Email, log and C-style dates: `Wed, 24 Jan 2024 14:30:00 +0000`, `24/Jan/2024:14:30:00 +0000`, `Wed Jan 24 14:30:00 2024`.
- Numbers that stand for dates: Excel serial numbers (five digits, such as `45315`), and Unix times in seconds (`1706106600`) or milliseconds (`1706106600000`). These show in the list as `excel serial`, `unix seconds` and `unix milliseconds`.
- Month and day names in the step's locale, such as `31. Dezember 2026` in German.

Two-digit years from `00` to `68` are 2000 to 2068, and `69` to `99` are 1969 to 1999. A four-digit year format never reads a short year: `24/01/24` is read by `%d/%m/%y`, not as the year 24.

**Day and month order.** A value such as `02/01/2024` could be 2 January or 1 February. Puddle never guesses:

1. If some values can only be read one way (`24/01/2024` can only be day first), that order is used for the whole column, and the form says which value settled it.
2. Otherwise a date format in the project's settings with a day and month order settles it.
3. Otherwise the step's locale does, such as English (US) for month first.
4. Otherwise the form asks you to choose. It also asks if some values only fit day first and others only month first.

**Values no format reads** stay empty (or stop the flow, if you choose that), and are never guessed at. The form says how many of the sample's values none of the formats reads, with examples, so you can add a format or fix them first. `31/02/2024` and `not a date` are two such values.

## Numbers

| Step | What it does |
| --- | --- |
| Round | Rounds to a number of decimal places (or up or down to them), or to the nearest multiple of a number such as 5 or 0.25. |
| Absolute value | Drops the minus sign from negative numbers. |
| Bucket | Groups numbers into ranges of equal width or between edges you choose, such as ages into bands, in a new column. |
| Standardise | Rescales numbers as a z-score (standard deviations from the mean) or min-max (0 for the smallest, 1 for the largest). |
| Convert units | Converts between units of length, weight, volume or temperature. |

## Reshape

| Step | What it does |
| --- | --- |
| Pivot or group by | Drag columns into Rows, Columns, Values and Filters to summarise the data, or to turn a column's values into columns. See {doc}`reshaping`. |
| Unpivot columns | Turns columns into rows of attribute and value, the usual fix for a wide table with a column per month. |
| Transpose | Swaps rows and columns, for a small table written sideways. |

## Advanced

| Step | What it does |
| --- | --- |
| Custom SQL | One DuckDB query over `input`, the data arriving at the step, for anything the other steps can't do. Ctrl+Enter applies it. |
