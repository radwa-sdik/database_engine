# Database Engine

A small SQL database engine built with NestJS. It provides HTTP endpoints for executing DDL and DML statements, stores table metadata in `database/catalog/catalog.dat`, and stores table data in binary page files under `database/data/`.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Installation

```bash
npm install
```

## Run the server

```bash
npm run start:dev
```

The API listens on `http://localhost:3000` by default. Set `PORT` to use another port:

```bash
PORT=4000 npm run start:dev
```

On Windows PowerShell:

```powershell
$env:PORT=4000
npm run start:dev
```

## Verify the API

```bash
curl http://localhost:3000/
```

The root endpoint currently returns `Hello World!`.

## API endpoints

All SQL requests use JSON and must contain exactly one statement.

| Method | Endpoint | Statement types |
| --- | --- | --- |
| `POST` | `/execute/ddl` | `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE` |
| `POST` | `/execute/dml` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |

`Content-Type: application/json` is required.

### Request body

```json
{
  "sql": "SELECT * FROM users;"
}
```

The guard rejects empty statements, statements longer than 10,000 characters, multiple statements, unsupported statement types, and statements sent to the wrong endpoint.

## Request processing flow

Each request passes through these stages:

```text
HTTP guard
  -> lexer
  -> parser
  -> query analyzer
  -> executor
  -> constraint validator
  -> binary storage
  -> JSON response
```

Validation stops the request at the first failing stage. The guard validates the
request shape and endpoint, the lexer validates tokens, the parser validates
SQL structure, the analyzer resolves tables/columns/types, and the constraint
validator checks the complete rows before they are written.

The parser accepts one optional trailing semicolon. Comments beginning with
`--` are supported. Keywords are case-insensitive, identifiers are converted
to lowercase, and identifiers may be at most 63 characters long. Strings use
single quotes; escape an embedded quote by doubling it:

```sql
SELECT * FROM users WHERE name = 'O''Brien';
```

## DML examples

### Select

```bash
curl -X POST http://localhost:3000/execute/dml \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT * FROM users;"}'
```

Response:

```json
[
  {
    "id": 1,
    "name": "Alice Johnson",
    "age": 28,
    "email": "alice@example.com",
    "active": true,
    "created_at": "2025-01-15T09:30:00.000Z"
  }
]
```

### Filter, order, and limit

```bash
curl -X POST http://localhost:3000/execute/dml \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT name, salary FROM employees WHERE department_id = 1 ORDER BY salary DESC LIMIT 5;"}'
```

### Insert

The parser requires an explicit column list. Omitted nullable columns become `NULL`, and omitted `SERIAL` columns are generated.

```bash
curl -X POST http://localhost:3000/execute/dml \
  -H "Content-Type: application/json" \
  -d '{"sql":"INSERT INTO users (name, age, email, active) VALUES ('\''David Wilson'\'', 31, '\''david@example.com'\'', true);"}'
```

Multiple rows are also supported:

```sql
INSERT INTO departments (name)
VALUES ('Marketing'), ('Operations');
```

An insert result contains the inserted rows:

```json
[
  {
    "id": 4,
    "name": "David Wilson",
    "age": 31,
    "email": "david@example.com",
    "active": true,
    "created_at": null
  }
]
```

### Update

```bash
curl -X POST http://localhost:3000/execute/dml \
  -H "Content-Type: application/json" \
  -d '{"sql":"UPDATE users SET age = 29 WHERE name = '\''Alice Johnson'\'';"}'
```

Response:

```json
{
  "success": true,
  "message": "1 row(s) affected."
}
```

### Delete

```bash
curl -X POST http://localhost:3000/execute/dml \
  -H "Content-Type: application/json" \
  -d '{"sql":"DELETE FROM users WHERE name = '\''Carol Davis'\'';"}'
```

## DDL examples

### Create a table

```bash
curl -X POST http://localhost:3000/execute/ddl \
  -H "Content-Type: application/json" \
  -d '{"sql":"CREATE TABLE projects (id SERIAL PRIMARY KEY, title CHAR(100) NOT NULL, budget INTEGER);"}'
```

Supported column types:

- `INTEGER`
- `DOUBLE`
- `SERIAL`
- `CHAR(length)`
- `TEXT`
- `BOOLEAN`
- `TIMESTAMP`

Supported constraints include `PRIMARY KEY`, `UNIQUE`, `NOT NULL`, and `REFERENCES`.

Foreign keys use inline column syntax and must reference an existing primary-key
or unique column:

```sql
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id)
);
```

DDL responses use this shape:

```json
{
  "success": true,
  "ddl": "CREATE TABLE projects (id SERIAL PRIMARY KEY, title CHAR(100) NOT NULL, budget INTEGER);",
  "message": "Table projects created successfully."
}
```

### Add a column

```sql
ALTER TABLE projects ADD COLUMN owner_id INTEGER REFERENCES users(id);
```

### Rename a column

```sql
ALTER TABLE projects RENAME COLUMN title TO name;
```

### Drop a column

```sql
ALTER TABLE projects DROP COLUMN budget;
```

### Drop a table

```sql
DROP TABLE projects;
```

A table cannot be dropped while it is referenced by another table's foreign key.

## SQL behavior and validation

### Data types

| Type | Behavior |
| --- | --- |
| `INTEGER` | 32-bit signed integer |
| `DOUBLE` | Floating-point number |
| `SERIAL` | Auto-generated positive integer; compatible with `INTEGER` foreign keys |
| `CHAR(n)` | Fixed storage size; `n` must be positive |
| `TEXT` | Variable-length text |
| `BOOLEAN` | `TRUE` or `FALSE` |
| `TIMESTAMP` | Parsed and stored as epoch milliseconds |

`CHAR(n)` length is measured in Unicode characters. Values longer than `n`
are rejected, never truncated. Shorter values are not space-padded in query
results; any storage padding is removed when values are read.

Timestamp values accept date-time forms with optional fractional seconds and
`Z` or numeric timezone offsets, such as
`'2025-11-22T15:30:00.125+02:00'`. Invalid dates, times, and offsets are
rejected. Results are returned as ISO 8601 strings.

### Constraints and mutation rules

- `PRIMARY KEY` is unique and non-null; a table can have at most one.
- `UNIQUE` rejects duplicate non-null values. Multiple `NULL` values are allowed.
- Foreign-key values must match a referenced primary-key or unique value, or be `NULL`.
- `INSERT` requires an explicit column list. Omitted nullable columns become
  `NULL`; omitted `SERIAL` columns are generated.
- `UPDATE` cannot change primary-key or `SERIAL` columns. All affected rows are
  validated before any update is written.
- `DELETE` and `DROP TABLE` reject operations that would violate foreign-key references.
- A primary-key column may be dropped when it is not referenced. Dropping it
  also removes the table's primary-key metadata.
- Adding a non-nullable column to a non-empty table is rejected; nullable
  columns are initialized to `NULL`.

### SELECT and expressions

Supported clauses are `WHERE`, `ORDER BY`, and `LIMIT`. `ASC` is the default
sort direction, and `LIMIT` must be a non-negative integer. `AS` aliases are
supported explicitly:

```sql
SELECT name AS full_name, age + 1 AS next_age
FROM users
WHERE active = TRUE
ORDER BY age DESC
LIMIT 10;
```

Supported operators include arithmetic (`+`, `-`, `*`, `/`), comparisons,
`AND`, `OR`, `NOT`, and `IS NULL`/`IS NOT NULL`. Arithmetic requires numeric
values; division by zero and invalid type combinations are rejected. `NULL`
propagates through arithmetic and ordinary comparisons, and `WHERE` keeps only
rows whose expression evaluates exactly to `TRUE`.

Results are JSON arrays of objects. `SELECT *` uses table column order, aliases
define output keys, and duplicate output names receive suffixes such as
`name`, `name_2`, and `name_3`.

The parser does not currently support joins, table aliases, subqueries,
grouping, aggregates, `HAVING`, `DISTINCT`, `OFFSET`, `DEFAULT`, `CHECK`,
`VARCHAR`, composite keys, or table-level foreign-key definitions.

## Validation and response errors

The engine returns HTTP 400 JSON errors for lexical, syntax, binding, type,
constraint, and storage failures. Errors include a failure name/message and,
when available, the SQL line and position:

```json
{
  "success": false,
  "statusCode": 400,
  "error": "BindingError",
  "message": "Table 'missing' does not exist.",
  "line": 1,
  "position": 0
}
```

For statement-specific validation details, see
[`flow.md`](../docs/flow.md). For the complete accepted grammar, see
[`grammer.md`](../docs/grammer.md).

## Mock database

On the first successful start, the database bootstrap creates these tables:

- `users`
- `departments`
- `employees`
- `tags`

It also creates their `.data` files and inserts mock rows. The mock definitions are in:

- `src/engine/storage/bootstrap/mock-database.ts`
- `src/engine/storage/bootstrap/mock-database.bootstrap.ts`

Mock data is inserted only when the catalog does not exist yet and a table data file is missing. Restarting normally preserves the existing catalog and inserted data.

## Reset the database

Stop the server, then remove the persisted catalog and data files:

```powershell
Remove-Item -Recurse -Force database\catalog, database\data
```

Start the server again to regenerate the mock database.

## Persistence files

```text
database/
  catalog/
    catalog.dat
  data/
    users.data
    departments.data
    employees.data
    tags.data
```

Do not edit these binary files manually.

Table files contain binary pages rather than JSON rows. The catalog is the
source of truth for table and column metadata; tuple type metadata is used by
the codec while encoding and decoding values, not stored redundantly in every
page value.

## Project structure

```text
src/
  api/
    execution/
  common/
  engine/
    sql/
      lexer/
      parser/
      query-analyzer/
      executer/
    storage/
      bootstrap/
      catalog/
      file/
      page/
      tuple/
  app.module.ts
  main.ts
test/
database/
```

## Tests

Run unit tests:

```bash
npm test
```

Run end-to-end tests:

```bash
npm run test:e2e
```

Build the project:

```bash
npm run build
```
