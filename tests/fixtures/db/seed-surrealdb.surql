-- The shop, as the SurrealDB tests seed a server (a SurrealDB container in CI, the surreal binary locally): the same
-- rows as shop.sqlite, with what SurrealDB can say about itself (a schemafull table with typed fields, a comment, a
-- default, a unique index, a schemaless table with one declared record link, decimals, datetimes, arrays and an
-- object). Run as one request, in order.
REMOVE TABLE IF EXISTS orders;
REMOVE TABLE IF EXISTS customers;
DEFINE TABLE customers SCHEMAFULL COMMENT "People who have ordered";
DEFINE FIELD name ON customers TYPE string;
DEFINE FIELD email ON customers TYPE option<string> COMMENT "Lower case";
DEFINE FIELD signed_up ON customers TYPE datetime;
DEFINE FIELD active ON customers TYPE bool DEFAULT true;
DEFINE INDEX customers_email ON customers FIELDS email UNIQUE;
DEFINE TABLE orders SCHEMALESS;
DEFINE FIELD customer ON orders TYPE record<customers>;
DEFINE FIELD total ON orders TYPE decimal;
DEFINE FIELD placed_at ON orders TYPE datetime;
CREATE customers:1 SET name = "Ada Lovelace", email = "ada@example.com", signed_up = d"2024-01-15T00:00:00Z";
CREATE customers:2 SET name = "Grace Hopper", email = "grace@example.com", signed_up = d"2024-02-20T00:00:00Z";
CREATE customers:3 SET name = "Alan Turing", signed_up = d"2024-03-05T00:00:00Z", active = false;
CREATE orders:101 SET customer = customers:1, total = 19.99dec, placed_at = d"2024-04-01T09:30:00Z", status = "shipped", notes = "Gift wrap", tags = ["gift", "express"], shipping = { city: "London", postcode: "N1" };
CREATE orders:102 SET customer = customers:1, total = 5.5dec, placed_at = d"2024-04-02T14:00:00Z", status = "placed", tags = [];
CREATE orders:103 SET customer = customers:2, total = 120dec, placed_at = d"2024-04-03T11:15:00Z", status = "returned", tags = ["bulk"], shipping = { city: "New York" };
CREATE orders:104 SET customer = customers:3, total = 42.25dec, placed_at = d"2024-04-04T16:45:00Z", status = "placed", tags = [];
