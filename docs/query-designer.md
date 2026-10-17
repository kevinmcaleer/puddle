# The query designer

A Query node is for those who like Microsoft Access's query designer: put tables on a design surface, drag a field onto another to join them, and build the result in a grid of fields with sorting and criteria.

To make one, select the tables on the canvas and choose **Query these** on the selection bar, or **Query** from **Add node**. The designer opens in place of the canvas; **Back to canvas** returns. Selecting the Query node later and pressing Enter opens it again.

![The query designer: two tables joined on customer_id, and a grid of three fields](_static/screenshots/query-designer.png)

## Tables and joins

Each table shows its fields with their types. Drag a field onto a field of another table to join them: a line connects the two. The inspector lists the joins, and for each one which rows it keeps (matching rows only, every row of the first table, or every row of the second). Tables with no join line would pair every row with every row, and the designer warns about it. **Add table** brings in another node.

## The grid

Drag a field into the grid, or double-click it, to add it to the result. For each field you can set:

| Row | What it does |
| --- | --- |
| Name | The column's name in the result. |
| Sort | Ascending, descending or not sorted. Fields sort from left to right. |
| Show | Whether the field is in the result. A hidden field can still sort or filter. |
| Criteria | A condition on the field, such as "More than 5". Criteria on one row must all hold; each further "or" row is an alternative. |

**Totals** adds a Total row for grouping and summarising, as in Access: each field is Group by, or a summary such as Sum, Average, Min, Max, Count, Count distinct, First, Last, StDev or Var. Where filters on a field before grouping, and Expression takes a calculation over the others. **Unique values** removes repeated rows from the result.
