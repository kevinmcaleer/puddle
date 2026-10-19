PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  born INTEGER CHECK (born > 1000)
);
INSERT INTO authors VALUES(1,'Ursula K. Le Guin','ursula@example.org',1929);
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE IF NOT EXISTS "books" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "author_id" INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  "title" TEXT NOT NULL COLLATE NOCASE,
  "published" DATE,
  "price" REAL DEFAULT 0.0,
  "in_print" BOOLEAN NOT NULL DEFAULT 1
);
CREATE TABLE [reviews] (
  [id] INTEGER NOT NULL PRIMARY KEY,
  [book_id] INTEGER NOT NULL,
  [stars] INTEGER NOT NULL CHECK ([stars] BETWEEN 1 AND 5),
  [body] TEXT, -- may be empty
  FOREIGN KEY ([book_id]) REFERENCES [books] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE TABLE tags (
  book_id INTEGER NOT NULL REFERENCES books,
  tag TEXT NOT NULL,
  PRIMARY KEY (book_id, tag)
) WITHOUT ROWID;
CREATE INDEX idx_books_author ON books (author_id);
CREATE UNIQUE INDEX idx_books_title ON books (title COLLATE NOCASE, author_id);
CREATE VIEW cheap_books AS SELECT * FROM books WHERE price < 10;
CREATE TRIGGER books_touch AFTER UPDATE ON books BEGIN
  UPDATE books SET price = price WHERE id = NEW.id;
END;
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('authors',1);
COMMIT;
