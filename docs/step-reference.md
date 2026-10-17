# Step reference

Every step a Transform node can hold, as the **Add step** menu groups them. Each step works on the columns you pick in its settings (it starts with the columns selected in the results), and is labelled in the step list by what it did, such as "Trimmed name, city".

## Clean

| Step | What it does |
| --- | --- |
| Trim whitespace | Removes spaces from both ends of each value. |
| Collapse spaces | Turns runs of spaces inside a value into one space. |
| Remove non-printing characters | Removes invisible characters, such as the zero-width spaces and control characters left by copying from a web page. |
| Empty text to empty value | Treats empty text (and text that is only spaces) as a missing value. |
| Parse numbers | Reads text such as `£1,234.50`, `$99`, `(12.00)` or `€ 7,5` as numbers, with the decimal mark of the project's locale or one you choose. |

## Columns

| Step | What it does |
| --- | --- |
| Rename columns | Gives columns new names. |
| Remove columns | Drops the columns you pick. |
| Move columns to the front | Moves the columns you pick to the start, in the order you pick them. |
| Change type | Converts columns to text, integer, decimal, boolean, date or timestamp. Values that don't convert become empty, or stop the step with an error. |
| Split by delimiter | Splits a column at a delimiter (a comma, a space, a tab or any text you type) into columns or into rows, at each occurrence, the left-most or the right-most. |
| Split by number of characters | Splits a column every so many characters, or once from the left or right, into columns or rows. |
| Split by position | Splits a column after the character counts you list. |
| Split by character transition | Splits a column where lower case changes to upper case (or back), or digits change to other characters (or back). |
| Merge columns | Joins columns into one with a separator, skipping empty values. |
| Add index column | Numbers the rows, from 1 or a number you choose. |
| Duplicate column | Copies a column under a new name. |
| Add column from expression | Adds a column calculated from the others with a DuckDB SQL expression, such as `price * quantity`. |

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
| Text length | Adds a column with each value's length. |

## Dates

| Step | What it does |
| --- | --- |
| Parse dates | Reads text as dates. Puddle ranks the likely formats by how many values each reads, tries them in order, and asks when a value such as `03/04/2024` could be day first or month first. Values no format reads become empty, or stop the step with an error. |
| Extract date part | Takes the year, quarter, month (number or name), week of the year, day of the month, day of the week (number or name) or hour from a date, into a new column or in place of the date. |
| Add or subtract time | Moves dates by a number of years, quarters, months, weeks, days, hours, minutes or seconds, the same for every row or taken from a column. |
| Time between dates | The whole number of years, months, days or other units between two date columns, in a new column. |
| Truncate dates | Rounds dates down to the start of their year, quarter, month, week (from Monday), day or hour. |
| Format dates as text | Writes dates as text in a format you choose, such as `%d/%m/%Y`. |

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
