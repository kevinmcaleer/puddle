-- The shop as a Cassandra or ScyllaDB keyspace: the same rows as shop.sqlite, with a set, a map, a decimal, a date
-- and a timestamp, the orders clustered by id within each customer, a secondary index on each table and a
-- materialized view (where the server allows one; scripts/seed-cassandra.mjs runs each statement in turn).
CREATE KEYSPACE IF NOT EXISTS shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
DROP MATERIALIZED VIEW IF EXISTS shop.orders_by_status;
DROP TABLE IF EXISTS shop.orders;
DROP TABLE IF EXISTS shop.customers;
CREATE TABLE shop.customers (id int PRIMARY KEY, name text, email text, signed_up date, active boolean, tags set<text>) WITH comment = 'People who have ordered';
CREATE INDEX customers_email ON shop.customers (email);
CREATE TABLE shop.orders (customer_id int, id int, total decimal, placed_at timestamp, status text, notes text, shipping frozen<map<text, text>>, PRIMARY KEY (customer_id, id)) WITH CLUSTERING ORDER BY (id DESC);
CREATE INDEX orders_status ON shop.orders (status);
CREATE MATERIALIZED VIEW shop.orders_by_status AS SELECT status, customer_id, id, total FROM shop.orders WHERE status IS NOT NULL AND customer_id IS NOT NULL AND id IS NOT NULL PRIMARY KEY (status, customer_id, id);
INSERT INTO shop.customers (id, name, email, signed_up, active, tags) VALUES (1, 'Ada Lovelace', 'ada@example.com', '2024-01-15', true, {'vip', 'early'});
INSERT INTO shop.customers (id, name, email, signed_up, active, tags) VALUES (2, 'Grace Hopper', 'grace@example.com', '2024-02-20', true, {'vip'});
INSERT INTO shop.customers (id, name, email, signed_up, active) VALUES (3, 'Alan Turing', null, '2024-03-05', false);
INSERT INTO shop.orders (customer_id, id, total, placed_at, status, notes, shipping) VALUES (1, 101, 19.99, '2024-04-01T09:30:00Z', 'shipped', 'Gift wrap', {'city': 'London', 'postcode': 'N1'});
INSERT INTO shop.orders (customer_id, id, total, placed_at, status) VALUES (1, 102, 5.50, '2024-04-02T14:00:00Z', 'placed');
INSERT INTO shop.orders (customer_id, id, total, placed_at, status, shipping) VALUES (2, 103, 120.00, '2024-04-03T11:15:00Z', 'returned', {'city': 'New York'});
INSERT INTO shop.orders (customer_id, id, total, placed_at, status) VALUES (3, 104, 42.25, '2024-04-04T16:45:00Z', 'placed');
