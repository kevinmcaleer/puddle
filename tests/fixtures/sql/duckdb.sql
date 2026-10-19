-- schema.sql from EXPORT DATABASE 'shop_export'
INSTALL json;
LOAD json;

CREATE SCHEMA analytics;

CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy');

CREATE SEQUENCE event_ids START 1;

CREATE TABLE users (
  id UBIGINT PRIMARY KEY,
  handle VARCHAR NOT NULL UNIQUE,
  current_mood mood,
  address STRUCT(street VARCHAR, city VARCHAR),
  prefs MAP(VARCHAR, VARCHAR),
  tags VARCHAR[],
  created_at TIMESTAMPTZ DEFAULT current_timestamp
);

CREATE OR REPLACE TABLE analytics.events (
  id BIGINT DEFAULT nextval('event_ids') PRIMARY KEY,
  user_id UBIGINT REFERENCES users (id),
  kind VARCHAR NOT NULL CHECK (kind IN ('view', 'click')),
  payload JSON,
  amount HUGEINT DEFAULT 0,
  happened_at TIMESTAMP NOT NULL
);

CREATE TABLE main.daily (
  day DATE,
  user_id UBIGINT,
  views INTEGER DEFAULT 0,
  PRIMARY KEY (day, user_id),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX events_user_idx ON analytics.events (user_id);

CREATE MACRO add_one(a) AS a + 1;

CREATE VIEW analytics.recent AS SELECT * FROM analytics.events WHERE happened_at > now() - INTERVAL 1 DAY;
