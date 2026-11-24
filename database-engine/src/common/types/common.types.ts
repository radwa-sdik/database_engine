import path from "node:path";

export type ValueTypes = string | number | boolean | null;
export type ColumnDataType = "INTEGER" | "DOUBLE" | "SERIAL" | "CHAR" | "TEXT" | "BOOLEAN" | "TIMESTAMP";
export type FileType = "DATA" | "SCHEMA";

export const DATABASE_ROOT = path.resolve(process.cwd(), "database");
export const DATA_FILE_PATH = path.join(DATABASE_ROOT, "data");
export const CATALOG_FILE_PATH = path.join(DATABASE_ROOT, "catalog", "catalog.dat");