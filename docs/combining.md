# Combining data

Puddle has three nodes for bringing data together. Each takes its inputs from the nodes wired into it. The quickest way to make one is to select its inputs on the canvas (click the first, Shift+click the next) and choose from the selection bar or the **Add** menu. The order you select them in is the order they're wired.

![The selection bar for two selected nodes](_static/screenshots/combine-selection-bar.png)

## Join

A Join puts two inputs side by side, matching rows on key columns, like a SQL join. It has a left input and a right input.

![Orders joined to customers on customer_id](_static/screenshots/combine-join.png)

In the inspector:

- **Join type** chooses which rows to keep: a left, inner, right or full join, an anti join (left rows with no match) or a semi join (left rows with a match, without the right's columns).
- **Match on** pairs a left column with a right column. Puddle starts with the keys of a relationship between the two inputs, if the project has one (see {doc}`relationships`), else a column the two share. **Add key pair** matches on several columns at once.
- **Suffix for clashing columns** is added to a right column whose name the left already has.
- **Swap inputs** exchanges left and right.

![The Join settings in the inspector](_static/screenshots/combine-join-settings.png)

When a key repeats on the right, a left row matches more than once and the join has more rows than its left input. Puddle says so ("5 rows on the left became 6 rows"), because it's usually a sign of a duplicate you didn't expect.

## Lookup

A Lookup brings columns across from a second input onto the first, like `VLOOKUP` or `XLOOKUP` in a spreadsheet. Unlike a join it always keeps every row of the main input exactly once: when a key matches more than one lookup row, the first is used.

![The Lookup settings, with its match rate and a note on duplicate keys](_static/screenshots/combine-lookup-settings.png)

The inspector shows how many rows found a match, and explains keys that are missing from the lookup or appear in it more than once.

## Append

An Append stacks the rows of two or more inputs, one after the other, like `UNION ALL`. Columns are matched by name (or by position, if you choose). A column that only some inputs have is filled in as empty for the others, and the inspector lists where each column comes from. Optionally, Append adds a column naming each row's input.

![Two customer files appended into one](_static/screenshots/combine-append.png)

Wire more inputs into the spare numbered input on the node to append more.

## SQL

A SQL node runs DuckDB SQL you write over the nodes wired into it. Each input is readable as `input1`, `input2`... and by its node's name (in double quotes when the name has spaces or dots), and a lone input also as `input`. The SQL console under the results turns a query into a SQL node in one click.

### Reading files by name

A SQL node can read the files of the sources wired into it, by name or by a pattern, as DuckDB reads files: `read_parquet('*.parquet', union_by_name = true)`, `read_csv('users.csv')`, or `FROM 'users.parquet'` in place of a table. Wire in a file set (see {doc}`sources`) to read many files this way, or single file sources. A pattern matches only the files wired in; nothing else on your computer can be read, and the reader's options (`union_by_name`, `filename`, `header`, `delim` and the like) can only be plain values.

### Scripts

A SQL node also takes a whole script: `CREATE TABLE name AS` a query, as many as you like, each able to read the inputs, the files and the tables made before it, and optionally a last `SELECT`. `CREATE OR REPLACE`, `TEMP` and `IF NOT EXISTS` are accepted, and so is `CREATE VIEW`; anything else (`INSERT`, `DROP`, `ATTACH`, `COPY` and the like) is refused, naming the statement.

```sql
CREATE OR REPLACE TABLE log AS
SELECT DISTINCT "Document ID" AS docid, "User Name" AS user_name
FROM read_parquet('*.parquet', union_by_name = true)
WHERE "Document ID" IS NOT NULL;

CREATE OR REPLACE TABLE users AS
SELECT * FROM read_parquet('sap_users.parquet');

CREATE OR REPLACE TABLE docs AS
SELECT l.docid, count() AS steps
FROM log l LEFT JOIN users u ON upper(trim(u."User Name")) = upper(trim(l.user_name))
GROUP BY l.docid;
```

The node's own rows are the last statement's. Once a script creates two or more tables, each gets a **Script table** node of its own, wired from the SQL node and named after it (here `log`, `users` and `docs`), which you can view, check with rules, join, and export like any other node. A table renamed in the script takes its node with it; a node you delete stays deleted until the script creates a new table, and the inspector's **Tables it creates** adds one back. Nothing a script creates outlives the query: each table is worked out when a node after it needs it, as every node is.

