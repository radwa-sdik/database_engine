# SQL Grammar Specification

This document describes the SQL syntax accepted by this implementation.

SQL is processed in this order:

1. HTTP validation in `SqlRequestGuard`
2. Lexing
3. Parsing
4. Query analysis
5. Execution

Statements sent to the API must be in the request body as `{ "sql": "..." }`.

## 1. Lexical rules

### Whitespace

Spaces, tabs, carriage returns, and newlines are ignored. Newlines increment the lexer line number.

### Keywords

Keywords are case-insensitive. For example, `SELECT`, `select`, and `SeLeCt` are all valid.

### Identifiers

```text
identifier = (letter | "_") (letter | digit | "_")*
```

- Maximum length: 63 characters.
- Identifiers are converted to lowercase.
- Keyword names cannot be used as identifiers.
- Quoted identifiers are not supported.

### String literals

String literals use single quotes:

```sql
'Alice'
'2025-01-15 09:30:00'
```

Double quotes are not supported. A single quote inside a string is escaped by doubling it:

```sql
'O''Brien'
```

An unterminated string produces a lexer error.

### Number literals

```text
number = digit+ ("." digit+)?
```

Both integers and decimal numbers are accepted by the lexer. The analyzer determines whether the value fits a column or expression type.

### Boolean and null literals

```sql
TRUE
FALSE
NULL
```

### Comments

The lexer ignores SQL comments beginning with `--`:

```sql
-- This is a comment
SELECT * FROM users;
```

### Operators and punctuation

```text
+  -  *  /  =  !=  <>  <  <=  >  >=
(  )  ,  ;
```

### Statements

The parser accepts one optional semicolon at the end of a statement. The HTTP guard rejects:

- empty statements
- statements longer than 10,000 characters
- more than one statement

## 2. Endpoint routing

| Statement | Endpoint |
|---|---|
| `CREATE TABLE` | `POST /execute/ddl` |
| `ALTER TABLE` | `POST /execute/ddl` |
| `DROP TABLE` | `POST /execute/ddl` |
| `SELECT` | `POST /execute/dml` |
| `INSERT` | `POST /execute/dml` |
| `UPDATE` | `POST /execute/dml` |
| `DELETE` | `POST /execute/dml` |

Sending a DDL statement to the DML endpoint, or a DML statement to the DDL endpoint, is rejected.

## 3. Data types

| Type | Syntax | Notes |
|---|---|---|
| Integer | `INTEGER` | 32-bit signed integer |
| Double | `DOUBLE` | Floating-point number |
| Serial | `SERIAL` | Auto-incrementing integer |
| Fixed character | `CHAR(n)` | `n` must be greater than zero |
| Text | `TEXT` | Variable-length text |
| Boolean | `BOOLEAN` | `TRUE` or `FALSE` |
| Timestamp | `TIMESTAMP` | Stored and returned through timestamp parsing |

`SERIAL` is automatically generated on insert and can also be used as a foreign key type compatible with `INTEGER`.

### `CHAR(n)` behavior

- `n` must be greater than zero.
- Length is measured in Unicode characters, not bytes.
- Values longer than `n` characters are rejected; they are never truncated or silently padded in query results.
- Internally, a `CHAR(n)` value occupies `n` UTF-8 storage slots up to four bytes per character. Remaining storage bytes are zero-filled, and the bytes at the end are removed when a value is read.
- A shorter value is returned without added spaces. Padding is storage-only and is not part of the returned value.

## 4. Column constraints

The supported inline column constraints are:

```text
PRIMARY KEY
UNIQUE
NOT NULL
REFERENCES table(column)
```

There is no support for table-level `FOREIGN KEY (...) REFERENCES ...` syntax, `DEFAULT`, or `CHECK`.

Column constraints may appear in the following order:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email CHAR(255) UNIQUE NOT NULL,
  department_id INTEGER REFERENCES departments(id)
);
```

Rules:

- A table can have at most one primary-key column.
- Column names within a table must be unique.
- A table must contain at least one column.
- `PRIMARY KEY` implies unique and non-null behavior in the catalog.
- `UNIQUE` values must be distinct among non-null values. Multiple `NULL` values are allowed in a unique column.
- A primary-key column also rejects `NULL` and therefore cannot contain repeated values.
- A foreign key must reference an existing table and column.
- The referenced column must be a primary key or unique column.
- `INTEGER` and `SERIAL` are accepted as compatible foreign-key types.

## 5. DDL statements

### 5.1 CREATE TABLE

```text
CREATE TABLE identifier (
  identifier type [PRIMARY KEY]
                   [UNIQUE]
                   [NOT NULL]
                   [REFERENCES identifier(identifier)]
  [, identifier type ...]*
);
```

Example:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name CHAR(100) NOT NULL,
  age INTEGER,
  active BOOLEAN,
  created_at TIMESTAMP
);
```

The table name must not already exist.

### 5.2 ALTER TABLE ADD COLUMN

```sql
ALTER TABLE users ADD COLUMN email CHAR(255) UNIQUE NOT NULL;
ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id);
```

When adding a column to a non-empty table:

- a nullable column is filled with `NULL`
- a non-nullable column is rejected

The new column name must not already exist. Multiple primary keys are not allowed.

### 5.3 ALTER TABLE DROP COLUMN

```sql
ALTER TABLE users DROP COLUMN age;
```

The engine rejects:

- unknown columns
- dropping the last column of a table
- dropping a column, including a primary-key column, referenced by a foreign key in another table or in the same table

A primary-key column may be dropped when no other column references it. Dropping the primary key removes the table's primary-key metadata; the column is removed from the table together with its `PRIMARY KEY` and `NOT NULL` constraints.

### 5.4 ALTER TABLE RENAME COLUMN

```sql
ALTER TABLE users RENAME COLUMN name TO full_name;
```

The old column must exist and the new column name must not already exist. Foreign-key metadata that references the renamed column is updated.

### 5.5 DROP TABLE

```sql
DROP TABLE users;
```

The table must exist. A table cannot be dropped while another table references it.

## 6. DML statements

### 6.1 SELECT

```text
SELECT select_list
FROM identifier
[WHERE expression]
[ORDER BY order_item [, order_item]*]
[LIMIT number];
```

The select list is either `*` or one or more expressions:

```sql
SELECT * FROM users;
SELECT id, name AS full_name FROM users;
SELECT name, age + 1 FROM users;
```

#### SELECT aliases

```text
select_item = expression ["AS" identifier]
```

An alias must be an identifier and is used as the result-column name. The alias grammar is `expression AS identifier`; aliases without `AS`, for example `SELECT name full_name`, are not accepted.

Examples:

```sql
SELECT name AS full_name FROM users;
SELECT age + 1 AS next_age FROM users;
SELECT name AS first_name, name AS display_name FROM users;
```

Clause order is fixed:

```text
SELECT -> FROM -> WHERE -> ORDER BY -> LIMIT
```

Example:

```sql
SELECT name, salary
FROM employees
WHERE department_id = 1
ORDER BY salary DESC
LIMIT 10;
```

Rules:

- `ORDER BY` supports expressions and optional `ASC` or `DESC`.
- `ASC` is the default.
- `LIMIT` must be a non-negative integer.
- Boolean expressions cannot be used for ordering.
- `NULL` is sorted after non-null values in ascending order and before non-null values in descending order.

Unsupported features include joins, grouping, aggregates, `HAVING`, `DISTINCT`, `OFFSET`, subqueries, set operations, and table aliases.

#### Result representation

Query results are represented as a JSON array of objects. Each object row uses projected column names as keys.

- `SELECT *` uses the table column names in table-definition order.
- `AS` sets the output key name.
- Expression results without a column name use `expr`.
- Duplicate output names cannot be represented twice in a JSON object.
- If a name is repeated, the second and later occurrences receive numeric suffixes: `name`, `name_2`, `name_3`, and so on.

For example:

```sql
SELECT name, name AS display_name, name AS display_name FROM users;
```

Produces objects shaped like:

```json
{
  "name": "Alice Johnson",
  "display_name": "Alice Johnson",
  "display_name_2": "Alice Johnson"
}
```

Use aliases with distinct names when the exact column name is required.

### 6.2 INSERT

```text
INSERT INTO identifier (identifier [, identifier]*)
VALUES (expression [, expression]*) [, (expression [, expression]*)]*;
```

The column list is required.

```sql
INSERT INTO users (name, age, email, active)
VALUES ('Alice Johnson', 28, 'alice@example.com', TRUE);
```

Multiple rows are supported:

```sql
INSERT INTO departments (name)
VALUES ('Engineering'), ('Finance');
```

Rules:

- Each row must contain exactly as many values as the column list.
- Column names cannot be duplicated.
- `SERIAL` columns are generated when omitted.
- Omitted `SERIAL` columns receive the next serial value.
- Omitted nullable columns receive `NULL`.
- Omitted non-nullable columns are rejected.
- Inserted values must fit the target column type.
- Primary-key, unique, and foreign-key constraints are validated.
- `NULL` does not participate in unique-value validation, so the same or different rows may contain `NULL` in a unique column.

Column references are not supported in insert values. Use literals and expressions made only from literals.

### 6.3 UPDATE

```text
UPDATE identifier
SET identifier = expression [, identifier = expression]*
[WHERE expression];
```

Examples:

```sql
UPDATE users SET age = 29 WHERE name = 'Alice Johnson';
UPDATE users SET age = age + 1 WHERE active = TRUE;
```

Rules:

- The assignment expression may reference columns from the row being updated.
- Right-hand expressions are evaluated against the old row values.
- Primary-key and `SERIAL` columns cannot be updated.
- Duplicate assignment columns are rejected.
- All affected rows are checked before changes are written.
- Without `WHERE`, all rows are updated.

### 6.4 DELETE

```text
DELETE FROM identifier [WHERE expression];
```

Examples:

```sql
DELETE FROM users WHERE id = 3;
DELETE FROM users;
```

Without `WHERE`, all rows are deleted. Deleting a referenced primary or unique row is rejected.

## 7. Expressions

```text
expression
  -> or-expression

or-expression
  -> and-expression ("OR" and-expression)*

and-expression
  -> not-expression ("AND" not-expression)*

not-expression
  -> "NOT" not-expression
  -> comparison

comparison
  -> additive
     [("=" | "!=" | "<>" | "<" | "<=" | ">" | ">=") additive]
  -> additive "IS" ["NOT"] "NULL"

additive
  -> multiplicative (("+" | "-") multiplicative)*

multiplicative
  -> unary (("*" | "/") unary)*

unary
  -> "-" unary
  -> primary

primary
  -> number
  -> string
  -> TRUE
  -> FALSE
  -> NULL
  -> identifier
  -> "(" expression ")"
```

### Precedence

From lowest to highest:

1. `OR`
2. `AND`
3. `NOT`
4. Comparison and `IS [NOT] NULL`
5. `+`, `-`
6. `*`, `/`
7. unary `-`
8. literals, identifiers, and parentheses

Operators at the same level are evaluated left to right.

### `TIMESTAMP` behavior

`TIMESTAMP` strings must match one of these accepted forms:

```text
YYYY-MM-DD HH:MM:SS
YYYY-MM-DDTHH:MM:SS
YYYY-MM-DDTHH:MM:SS.fraction
YYYY-MM-DDTHH:MM:SSZ
YYYY-MM-DDTHH:MM:SS+HH:MM
YYYY-MM-DDTHH:MM:SS-HH:MM
YYYY-MM-DDTHH:MM:SS+HHMM
YYYY-MM-DDTHH:MM:SS-HHMM
```

`Z` and numeric timezone offsets are optional. A fraction may contain one or more digits and is normalized to milliseconds. Invalid calendar dates, invalid time ranges, invalid timezone hours or minutes, and unsupported formats are rejected.

Examples:

```sql
'2025-11-22 15:30:00'
'2025-11-22T15:30:00Z'
'2025-11-22T15:30:00.125+02:00'
```

Timestamp values are parsed to epoch milliseconds and serialized by the engine. Query output for a `TIMESTAMP` column or projected timestamp expression is ISO 8601 via `new Date(...).toISOString()`, such as `2025-11-22T15:30:00.000Z`.

### Comparison behavior

- Numeric types `INTEGER`, `SERIAL`, and `DOUBLE` are compatible for arithmetic and comparison.
- `CHAR`, `TEXT`, and `TIMESTAMP` are considered text-compatible for comparisons.
- Booleans support equality and inequality comparisons.
- Boolean ordering comparisons are rejected.
- `TIMESTAMP` literals or text operands compared with a timestamp column are parsed as timestamps.
- Chained comparisons are not supported.

### Arithmetic behavior

- Arithmetic supports numeric types.
- Integer division truncates toward zero.
- Division by zero is rejected.
- Arithmetic with `NULL` returns `NULL`.

### NULL behavior

- `IS NULL` and `IS NOT NULL` test null values.
- `NULL = NULL` is false.
- Arithmetic and regular comparisons involving `NULL` evaluate to `NULL`.
- `NOT NULL` in expressions is `NULL`.
- `WHERE` keeps a row only when the expression evaluates to exactly `TRUE`.

Three-valued logical behavior:

| Left | Right | AND | OR |
|---|---|---|---|
| TRUE | TRUE | TRUE | TRUE |
| TRUE | FALSE | FALSE | TRUE |
| TRUE | NULL | NULL | TRUE |
| FALSE | TRUE | FALSE | TRUE |
| FALSE | FALSE | FALSE | FALSE |
| FALSE | NULL | FALSE | NULL |
| NULL | TRUE | NULL | TRUE |
| NULL | FALSE | FALSE | NULL |
| NULL | NULL | NULL | NULL |

## 8. Unsupported SQL

The parser does not support:

- `TRUNCATE`
- `VACUUM`
- `JOIN`
- table aliases
- `GROUP BY`
- aggregate functions
- `HAVING`
- `DISTINCT`
- `OFFSET`
- subqueries
- table-level foreign-key definitions
- `DEFAULT`
- `CHECK`
- `VARCHAR`
- double-quoted strings
- double-quoted identifiers
- composite primary or foreign keys
- `ON DELETE` and `ON UPDATE`

## 9. Full example

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name CHAR(100) NOT NULL,
  age INTEGER,
  email CHAR(255) UNIQUE NOT NULL,
  active BOOLEAN,
  created_at TIMESTAMP
);

INSERT INTO users (name, age, email, active, created_at)
VALUES (
  'Alice Johnson',
  28,
  'alice@example.com',
  TRUE,
  '2025-01-15 09:30:00'
);

UPDATE users
SET age = age + 1
WHERE name = 'Alice Johnson';

SELECT id, name, age
FROM users
WHERE active = TRUE
ORDER BY age DESC
LIMIT 10;

ALTER TABLE users RENAME COLUMN name TO full_name;
ALTER TABLE users ADD COLUMN phone CHAR(20);
ALTER TABLE users DROP COLUMN age;
DROP TABLE users;
```
