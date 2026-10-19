# DBML in Puddle

The Schema view reads [DBML](https://dbml.dbdiagram.io/docs), the language dbdiagram.io uses, so a file from there can be pasted in as it is. This page is a short primer on what Puddle reads; the DBML docs have the full detail. See {doc}`schema` for the view itself.

Keywords such as `Table` and `Ref` can be written in any case. A name with spaces or other odd characters goes in double quotes, and `//` starts a comment to the end of the line. Elements can refer to ones written later in the text.

## Tables and columns

A table is a name and one column per line: the column's name, its type, and its settings in square brackets.

```text
Table customers {
  id integer [pk, increment]
  email varchar(255) [not null, unique]
  country char(2) [default: 'GB', note: 'ISO country code']
  created_at timestamp [default: `now()`]
  Note: 'Everyone who has signed up'
}
```

Types are written as the database would, such as `integer`, `varchar(255)`, `decimal(10,2)` or `timestamp`. Puddle passes them through, and turns them into each database's own words when it exports SQL.

| Column setting | Means |
| --- | --- |
| `pk` or `primary key` | The column is the primary key. |
| `increment` | The database numbers new rows itself. |
| `unique` | No two rows have the same value. |
| `not null`, `null` | A value is required, or may be left empty. |
| `default: ...` | The value a new row gets: a number, `true`, `false`, `null`, `'text'`, or an expression in backticks such as `` `now()` ``. |
| `check: ...` | A condition every row must meet, in backticks, such as `` `total >= 0` ``. |
| `note: '...'` | A note, shown when you hover over the column. |
| `ref: > other.id` | An inline ref (see [Refs](#refs)). |

A table can also have:

- `Note: '...'`, a note on the table,
- an `indexes { ... }` block: one index per line, a column or a list in brackets such as `(customer_id, ordered_at)`, with settings `pk`, `unique`, `name: '...'`, `type: ...` and `note: '...'`; a composite primary key is written as an index with `[pk]`,
- a `checks { ... }` block: one condition per line in backticks, with an optional `[name: '...']`,
- table settings after its name: `[headercolor: #3498DB]` colours its header, `[note: '...']` gives it a note,
- a schema before its name, as in `Table billing.invoices`, and an alias after it, as in `Table customers as C`, which refs can use.

## Refs

A ref joins a column to a column of another table. The sign between them says how many rows match at each end.

| Sign | Means |
| --- | --- |
| `>` | Many to one: many orders, one customer. |
| `<` | One to many. |
| `-` | One to one. |
| `<>` | Many to many. |

```text
// Long form, on its own line
Ref: orders.customer_id > customers.id [delete: cascade]

// Inline, on the column
Table orders {
  customer_id integer [ref: > customers.id]
}

// Composite, several columns at each end
Ref: periods.(merchant_id, country) > merchants.(id, country)
```

`delete:` and `update:` take `cascade`, `restrict`, `set null`, `set default` or `no action`, and are written into the SQL export as the foreign key's actions. `color:` colours the line. A `?` beside the sign, as in `?>`, says that end may have no match.

## Enums

An enum lists the values a column of its type may hold. Use its name as a column's type.

```text
Enum order_status {
  pending
  paid
  shipped [note: 'Left the warehouse']
}

Table orders {
  status order_status [default: 'pending']
}
```

## Groups, notes and the project

```text
Project shop {
  database_type: 'PostgreSQL'
  Note: 'Customers, their orders and what they bought'
}

TableGroup sales [color: #79AD51] {
  orders
  order_items
}

Note about {
  'Prices are in pounds'
}
```

A `TableGroup` draws a frame around its tables. A `Note` with a name is a sticky note on the diagram. There can be one `Project`, which names the schema and its database.

## Partials

A `TablePartial` is a set of columns, indexes and settings that several tables share. A table takes one in with `~` and its name, at the place its columns should go. A column the table writes itself wins over one of the same name from a partial, and a later partial wins over an earlier one.

```text
TablePartial timestamps {
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]
}

Table users {
  id integer [pk]
  ~timestamps
}
```

## Records

`records` writes rows into the DBML. They load into the table's Schema table node, show in the data sample, and can go into the SQL export as `INSERT` statements. They can be written inside the table, or outside it with the table's name and columns.

```text
records customers(id, email, country) {
  1, 'ada@example.com', 'GB'
  2, 'grace@example.com', 'US'
}
```

`records customers(...) [example] { ... }` marks the rows as example records: they load and show like any others but are left out of SQL exports. **Fill with sample data** writes either kind for you.

## What Puddle leaves out

- `DiagramView` blocks are read without complaint but not drawn; make views with the strip above the diagram instead (see {doc}`schema`).
- `use` to bring in another DBML file isn't supported: paste that file's DBML into the same text.
- When there is more than one `Project`, the last one is used.
