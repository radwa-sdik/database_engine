import { ColumnDataType } from "../../../common/types/common.types";

export interface DatabaseMetadata {
    name: string;
    tables: Map<string, TableMetadata>;
}


export interface TableMetadata {
    name: string;
    columns: ColumnMetadata[];
    primaryKey?: string;
    foreignKeys?: ForeignKeyMetadata[];
}

export interface ColumnMetadata {
    name: string;
    dataType: ColumnDataType;
    length?: number;
    isNullable: boolean;
    isUnique: boolean;
    isPrimaryKey: boolean;
}

export interface ForeignKeyMetadata {
    columnName: string;
    referencedTable: string;
    referencedColumn: string;
}


export const DEFAULT_CATALOG_FILE_NAME = "catalog.dat";