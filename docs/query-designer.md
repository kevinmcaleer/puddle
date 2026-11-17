# The query designer

A Query node is for those who like Microsoft Access's query designer: put tables on a design surface, drag a field onto another to join them, and build the result in a grid of fields with sorting and criteria.

To make one, select the tables on the canvas and choose **Query these** on the selection bar, or **Query** from **Add**. The designer opens in place of the canvas, and the tabs above it (**Canvas**, **Relationships**, **Query designer**) move between them, as do the keys 1, 2, 3 and 4; **Back to canvas** returns too. Selecting the Query node later and pressing Enter opens it again.

![The query designer: two tables joined on customer_id, and a grid of three fields](_static/screenshots/query-designer.png)

## Tables and joins

Each table shows its fields with their types. Drag a field onto a field of another table to join them: a line connects the two. The inspector lists the joins, and for each one which rows it keeps (matching rows only, every row of the first table, or every row of the second). Tables with no join line would pair every row with every row, and the designer warns about it. **Add table** brings in another node. As in Access, a table comes joined to the tables already there on any relationship the project has between them (see {doc}`relationships`), and so do the tables of a new Query, so a relationship is drawn once rather than again in every query.

## The grid

Drag a field into the grid, or double-click it, to add it to the result. For each field you can set:

| Row | What it does |
| --- | --- |
| Name | The column's name in the result. |
| Sort | Ascending, descending or not sorted. Fields sort from left to right. |
| Show | Whether the field is in the result. A hidden field can still sort or filter. |
| Criteria | A condition on the field, such as "More than 5". Criteria on one row must all hold; each further "or" row is an alternative. |

**Totals** adds a Total row for grouping and summarising, as in Access: each field is Group by, or a summary such as Sum, Average, Min, Max, Count, Count distinct, First, Last, StDev or Var. Where filters on a field before grouping, and Expression takes a calculation over the others. **Unique values** removes repeated rows from the result. **Top values** keeps only the first 5, 10, 25 or more rows, after sorting, as in Access; All keeps every row.

## The Pivot view

**Pivot**, beside Design and SQL, builds a pivot table from the query's tables, as a spreadsheet does. The tables' fields are listed on the left, and there are four wells to put them in. Drag a field into a well, or pick it from the well's **Add a field** list.

![The Pivot view: name in Rows, the orders' status in Columns and the sum of total in Values, giving a row per customer with a pending and a shipped column](_static/screenshots/query-pivot.png)

| Well | What it does |
| --- | --- |
| Rows | One row for each value, or each mix of values, of these fields. |
| Columns | One column for each value of this field, under every summary. It holds one field. |
| Values | What is summarised in each cell. A number starts as a Sum and anything else as a Count; change the summary on the field. |
| Filters | Leaves rows out before anything is counted. A filter starts as **Is not empty**; pick another condition and give it a value. |

The tables are joined by the query's join lines. The project's relationships draw those as each table is added (see {doc}`relationships`), so fields from related tables can be mixed freely; if two tables have no join line, a note says every row of one is paired with every row of the other.

The Pivot view is another face of the design grid, with **Totals** on: Rows are the grid's Group by fields, Values its summaries, Filters its Where fields, and the Columns field has the Total **Pivot columns**. Switch between the two views freely.

The values of the Columns field are read when you put it there and kept in the design: the query always gives those columns, whatever the data holds later, so the nodes after it never find a column gone. When the data gains a value, **Read values** on the field reads them again. With one field in Values each column is named for its value (`pending`, `shipped`); with several, for the value and the summary (`pending SumOftotal`). A field can give up to 200 columns.

## SQL view

As in Access, the designer turns the query into SQL and back again. Choose **SQL** at the top of the designer to see the design written as a DuckDB query, and **Design** to return to the grid.

![The SQL view: the same query as SQL, joined on customer_id with a criterion and a sort](_static/screenshots/query-sql-view.png)

The SQL is shown beside the query's rows at the bottom of the screen, and the tables and grid stay in view above it, each following the other as you change either. You can edit the SQL. Press Ctrl+Enter, or click away, and the design follows: tables, join lines, fields, names, sorting, criteria and totals all fill in from the SQL. Tables are read by their node's name (in double quotes when it has spaces or dots), or as input1, input2 by number. Each table can have a short name of its own, such as `FROM orders o`, and a column only needs its table when two tables have it.

The grid can show:

- `SELECT` of fields, `*`, `DISTINCT`, and new names with `AS`
- `JOIN`, `LEFT JOIN`, `RIGHT JOIN`, `FULL JOIN` and `CROSS JOIN`, on fields that are equal
- `WHERE` and `HAVING` conditions such as `total > 5`, `name ILIKE '%ada%'`, joined with `AND` and `OR`; a condition on a field the query doesn't show goes on a hidden field, as in Access
- `GROUP BY` with `sum`, `avg`, `min`, `max`, `count`, `count(DISTINCT ...)`, `first`, `last`, `stddev` and `variance`, and other calculations over them as an Expression
- `ORDER BY`
- `LIMIT` with a number of rows, as Top values

Some SQL has no place in the grid: `OFFSET`, `UNION`, subqueries, `CASE` and the like. Puddle says why, and keeps your SQL: the query runs it as written, and **Design** is unavailable until you choose **Back to the design**, which discards the SQL and brings back the design as it was. Emptying the box does the same, and stays in the SQL view.

The SQL view also takes `CREATE TABLE name AS` a query (with `OR REPLACE` if you like), alone or as a script of several, each reading the tables before it. It runs as written, the Query's rows are the last statement's, and each table gets a node of its own on the canvas, wired from the Query (see {doc}`combining`).
