# System Flow and Statement Validation

This document describes how an SQL request moves through the database engine and which validations run at each stage.

## 1. High-level flow

```text
Postman / HTTP client
        |
        v
ExecutionController
        |
        v
SqlRequestGuard
        |
        v
ExecutionService
        |
        v
LexerService
        |
        v
ParserService
        |
        v
QueryAnalyzerService
        |
        v
ExecutorService
        |
        +--> DDLExecutor --> CatalogService / StorageManagerService
        |
        +--> DMLExecutor --> ConstraintsValidator --> StorageManagerService
        |
        +--> SelectExecutor --> StorageManagerService
        |
        v
ResultMapper / API response
```

The system has five validation phases:

1. HTTP request validation.
2. Lexical validation.
3. Parser validation.
4. Semantic and expression validation.
5. Storage constraint validation.

Each phase can stop the statement before the next phase starts.

## 2. Startup flow

During application startup:

1. `CatalogService.onModuleInit()` loads `database/catalog/catalog.dat`.
2. If no catalog exists, `persistedCatalogLoaded` remains false.
3. `MockDatabaseBootstrap.onApplicationBootstrap()` creates the mock catalog tables.
4. The mock catalog is flushed to disk.
5. Missing `.data` files are created.
6. Mock rows are inserted only into newly created mock table files.
7. Existing catalog and existing data files are not overwritten.

Startup files:

- `database/catalog/catalog.dat`
- `database/data/*.data`

## 3. HTTP request validation

Both endpoints use `SqlRequestGuard`.

| Endpoint | Accepted statement groups |
|---|---|
| `POST /execute/ddl` | `CREATE`, `ALTER`, `DROP` |
| `POST /execute/dml` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |

The body must contain a `sql` field:

```json
{
  "sql": "SELECT * FROM users;"
}
```

The guard performs these checks:

1. Comments beginning with `--` are removed for validation.
2. `sql` must be a non-empty string after trimming.
3. The statement must not exceed 10,000 characters.
4. The statement must contain only one statement.
5. The first keyword must identify a supported statement type.
6. DDL statements must use `/execute/ddl`.
7. DML statements must use `/execute/dml`.

Semicolons inside single- or double-quoted text do not count as statement separators. A semicolon followed by another non-whitespace statement is rejected as multiple statements.

Example errors:

```json
{
  "success": false,
  "message": "sql statement is required"
}
```

```json
{
  "success": false,
  "message": "only one statement allowed per request"
}
```

```json
{
  "success": false,
  "message": "wrong endpoint for this statement type"
}
```

The HTTP controller then calls `ExecutionService.execute(sql)`.

## 4. Lexical validation

`ExecutionService.analyze()` creates a `LexerService`.

The lexer validates:

- unsupported characters
- identifier length
- unterminated single-quoted strings
- invalid number formats
- keyword recognition
- comment removal
- operators and punctuation

Identifiers are converted to lowercase. They may contain a letter or underscore at the first position and letters, digits, or underscores after that. Maximum identifier length is 63 characters.

String literals must use single quotes. Double quotes are rejected. Single quotes are escaped as `''`.

```sql
'Alice'
'O''Brien'
```

Lexical failures return engine error responses containing the lexer error name, message, line, and position.

## 5. Parser validation

`ParserService` consumes lexer tokens and creates a statement AST.

It validates:

- statement keyword order
- required keywords
- balanced parentheses
- required identifiers
- data-type syntax
- `CHAR(n)` syntax
- trailing commas
- missing values
- optional semicolon and end-of-input

The parser supports `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.

It does not support `TRUNCATE`, joins, subqueries, grouping, aggregates, `HAVING`, `DISTINCT`, `OFFSET`, table aliases, `DEFAULT`, `CHECK`, or table-level foreign-key constraints.

Parser errors include the line and position of the syntax failure.

## 6. Query analysis

`QueryAnalyzerService` validates the parsed AST against the current catalog.

It resolves table names, column names, catalog metadata, expression types, output column names, foreign-key metadata, and primary-key metadata.

## 7. CREATE TABLE validation

```text
Parser AST
  -> table name uniqueness
  -> column-name uniqueness
  -> primary-key count
  -> column type and length
  -> foreign-key target resolution
  -> catalog metadata creation
  -> storage file creation
```

Validation:

1. The table name must not already exist.
2. The table must have at least one column.
3. Column names must be unique.
4. A table can have at most one primary-key column.
5. `CHAR(n)` must have a positive length.
6. A foreign-key target table must exist.
7. A referenced column must exist.
8. The referenced column must be primary key or unique.
9. Foreign-key data types must be compatible.

After analysis, `DDLExecutor` calls `StorageManagerService.createTable()`, which:

- checks again that the table does not exist
- creates the table data file
- adds the table to the catalog
- flushes catalog metadata
- rolls back the catalog entry and file if the operation fails

## 8. ALTER TABLE validation

### ADD COLUMN

1. The table must exist.
2. The new column name must not exist.
3. `CHAR(n)` must have a positive length.
4. A foreign-key target, if declared, must exist and be primary/unique.
5. The table cannot already have a primary key if the new column is primary key.

Execution behavior:

- If the table is empty, only catalog metadata is updated.
- If the table is non-empty, the new column must be nullable.
- Existing rows receive `NULL` for the added column.
- The table file is rewritten safely and the new catalog metadata is persisted.

### DROP COLUMN

1. The table must exist.
2. The column must exist.
3. The last column of a table cannot be dropped.
4. A column cannot be dropped if another table or the same table references it through a foreign key.
5. A primary-key column may be dropped when no column references it.

The table file is rewritten without that column. If the dropped column is the primary key, the catalog's `primaryKey` value is cleared.

### RENAME COLUMN

1. The table must exist.
2. The old column must exist.
3. The new name must not already exist.
4. Catalog metadata is updated.
5. Foreign-key metadata referencing the old column is updated.

If the catalog flush fails, the in-memory rename is rolled back.

## 9. DROP TABLE validation

1. The table must exist.
2. No other table may reference it through a foreign key.
3. The catalog entry is removed.
4. The catalog is flushed before the data file is deleted.
5. If deletion fails after the catalog flush, the catalog entry is restored.

## 10. INSERT validation

The analysis and execution flow is:

```text
Require table
  -> resolve specified columns
  -> reject duplicate specified columns
  -> validate row length
  -> evaluate literal expressions
  -> validate value types
  -> generate omitted SERIAL values
  -> reject omitted NOT NULL columns
  -> fill omitted nullable columns with NULL
  -> validate storage constraints
  -> write all rows
```

`QueryAnalyzerService` validates:

1. The table exists.
2. Every specified column exists.
3. No column is specified more than once.
4. Every row has the expected number of values.
5. Insert expressions do not contain column references.
6. Every value fits its target column.
7. `SERIAL` is omitted or generated.
8. Omitted non-nullable columns do not become `NULL`.

`ConstraintsValidator` validates:

1. Row length exactly matches the table schema.
2. Values fit the schema and range.
3. `CHAR(n)` values do not exceed `n` characters.
4. `TIMESTAMP` values parse correctly.
5. Foreign-key values exist in the referenced table or are `NULL`.
6. Unique and primary-key values do not conflict with existing or batch values.
7. Multiple `NULL` values are allowed in unique columns.

Storage validation then:

- generates the next positive `SERIAL` values
- advances the sequence when an explicit serial value is greater than or equal to the current value
- rejects serial values outside `1..2147483647`
- encodes and writes tuples
- allocates new pages when necessary

## 11. UPDATE validation

The update flow is:

```text
Require table
  -> resolve assignment columns
  -> reject primary and SERIAL updates
  -> reject duplicate assignment columns
  -> bind and validate WHERE
  -> evaluate assignments against old row values
  -> validate all affected rows
  -> update tuples
```

`QueryAnalyzerService` validates:

1. The table exists.
2. Every assignment and `WHERE` column exists.
3. Primary-key columns cannot be updated.
4. `SERIAL` columns cannot be updated.
5. Assignment column names are unique.
6. Assignment expressions have types compatible with their columns.
7. `WHERE` expressions evaluate to boolean or `NULL`.

Assignment expressions with column references are evaluated against the old tuple values. All affected rows are collected before constraints are checked.

`ConstraintsValidator` validates complete new affected rows:

- column value types
- row length
- nullability
- unique and primary-key constraints
- foreign-key constraints

Updates happen only after the affected rows pass validation.

## 12. DELETE validation

The delete flow is:

```text
Require table
  -> bind WHERE expression
  -> scan rows
  -> keep rows matching TRUE
  -> validate foreign-key references
  -> delete matching tuple IDs
  -> return deleted row count
```

Validation:

1. The table exists.
2. `WHERE`, if present, is bound and must evaluate to boolean or `NULL`.
3. Rows are selected only when `WHERE` evaluates exactly to `TRUE`.
4. Deleted values are checked against foreign keys in every referencing table.
5. `NULL` values do not block deletion.
6. Deletion is rejected if a non-null deleted value is referenced by another row.

Without `WHERE`, every row is selected for deletion.

The result is:

```json
{
  "success": true,
  "message": "2 row(s) affected."
}
```

## 13. SELECT validation

The select flow is:

```text
Require table
  -> analyze projection expressions
  -> bind projection column references
  -> validate WHERE
  -> validate ORDER BY expressions
  -> validate LIMIT
  -> scan table
  -> filter
  -> sort
  -> limit
  -> project
  -> map JSON result
```

### Projection validation

- `SELECT *` projects every table column in catalog order.
- Named or expression projections must resolve against the table.
- `AS` assigns the result column name.
- Expressions without aliases use `expr`.
- A timestamp projected column or expression is converted to ISO 8601 format.

### WHERE validation

- The table is resolved first.
- Column references are bound to tuple indexes.
- The expression type must be `BOOLEAN` or `NULL`.
- The executor keeps a row only when the evaluated result is exactly `TRUE`.

### ORDER BY validation

- Expressions are analyzed against the table.
- Boolean and `NULL` ordering expressions are rejected.
- `ASC` is the default.
- `DESC` is accepted explicitly.
- `NULL` sorts last for ascending order and first for descending order.

### LIMIT validation

- `LIMIT` must be an integer.
- `LIMIT` must be greater than or equal to zero.
- `LIMIT 0` produces no rows.

### Result mapping

Query results are arrays of objects. Duplicate JSON keys are disambiguated with numeric suffixes:

- `name`
- `name_2`
- `name_3`

## 14. Expression validation

### Arithmetic

- `+`, `-`, `*`, `/` require numeric types.
- `INTEGER`, `SERIAL`, and `DOUBLE` are accepted as numeric types.
- Integer division truncates toward zero.
- Division by zero is rejected.
- Arithmetic with `NULL` returns `NULL`.

### Comparison

- Numeric types are mutually comparable.
- Text types are mutually comparable.
- `TIMESTAMP` can be compared with text only when the text operand is a literal.
- Boolean values support only equality and inequality.
- Ordering booleans is rejected.
- `IS NULL` and `IS NOT NULL` are supported.
- `NULL = NULL` is false.

### Logical expressions

- `AND`, `OR`, and `NOT` require boolean or `NULL` operands.
- Logical expressions use three-valued logic.
- `NOT NULL` evaluates to `NULL`.

### Column references

- Every identifier in `WHERE`, `UPDATE`, `SELECT`, and `ORDER BY` must exist in the current table.
- Insert values cannot reference table columns.

## 15. Constraint validation

The storage constraint validator runs before insert and update writes.

### NULL

- A nullable column accepts `NULL`.
- A non-nullable column rejects `NULL`.
- `SERIAL` values are generated rather than left `NULL`.
- Multiple `NULL` values are allowed for unique columns.

### UNIQUE

- `UNIQUE` and primary-key columns reject duplicate non-null values.
- Duplicate values within one insert/update batch are rejected.
- Duplicate values matching existing rows are rejected.
- `NULL` values are excluded from uniqueness checks.

### PRIMARY KEY

- `PRIMARY KEY` is unique and non-null.
- Primary-key columns cannot be updated.
- A table can have at most one primary-key column.
- A primary-key column can be dropped if no column references it.
- Dropping a primary-key column also removes that table's primary-key metadata.

### FOREIGN KEY

- Insert and update values must match a referenced row or be `NULL`.
- The referenced column must be primary key or unique.
- `INTEGER` and `SERIAL` are compatible.
- Delete and drop operations reject referenced values or tables.

### TIMESTAMP

- Text timestamp values must match the parser's accepted formats.
- Invalid dates and invalid times are rejected.
- Stored timestamps are epoch milliseconds.
- Returned timestamp values are ISO 8601 strings.

### CHAR

- `CHAR(n)` requires `n > 0`.
- Values longer than `n` Unicode characters are rejected.
- Values are not truncated.
- Returned values have storage padding removed.

## 16. Storage execution

After semantic and constraint validation, the storage manager:

1. Opens or creates the table `.data` file.
2. Loads or allocates pages.
3. Serializes tuples with `TupleCodecService`.
4. Writes tuples into free page slots.
5. Allocates a new page when the current page has insufficient room.
6. Updates the file header and serial sequence.
7. Syncs and closes file managers during shutdown.

Table files contain binary page data, not JSON or plain-text rows.

## 17. Response mapping

`ExecutionService` maps the final result:

- `SELECT` and insert/update query results become JSON row arrays.
- `DELETE` becomes `{ success: true, message: "N row(s) affected." }`.
- DDL operations become a success object containing `success`, `ddl`, and `message`.
- Engine exceptions become HTTP 400 JSON responses.

DDL example:

```json
{
  "success": true,
  "ddl": "CREATE TABLE projects (id SERIAL PRIMARY KEY, title CHAR(100) NOT NULL);",
  "message": "Table projects created successfully."
}
```

Engine error example:

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

## 18. Validation summary

| Statement | Guard | Parser | Analyzer | Constraint/storage |
|---|---|---|---|---|
| `CREATE TABLE` | endpoint and type | syntax | table/column/FK/type checks | catalog and file creation |
| `ALTER TABLE` | endpoint and type | syntax | table/column/FK checks | catalog or table rewrite |
| `DROP TABLE` | endpoint and type | syntax | existence/FK references | catalog and file deletion |
| `SELECT` | endpoint and type | syntax | table/column/expressions/LIMIT | page scan and projection |
| `INSERT` | endpoint and type | syntax | table/columns/row/value types | null/unique/FK/value range/write |
| `UPDATE` | endpoint and type | syntax | table/assignments/WHERE/types | old-row evaluation/all-row constraints/write |
| `DELETE` | endpoint and type | syntax | table/WHERE | row selection/FK reference/delete |
