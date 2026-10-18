/** The example the Schema view offers: two tables, an enum and a ref, with comments on what each line does. */
export const EXAMPLE_DBML = `// A table: a name, then one column per line as name and type, with settings in brackets.
Table customers {
  id integer [pk, increment]
  email varchar(255) [not null, unique]
  name varchar
  created_at timestamp [default: \`now()\`]
}

// An enum: the values a column of this type may hold.
Enum order_status {
  pending
  paid
  shipped
}

Table orders {
  id integer [pk, increment]
  // An inline ref: each order belongs to one customer (> is many-to-one).
  customer_id integer [not null, ref: > customers.id]
  status order_status [default: 'pending']
  total decimal(10,2)
}
`;
