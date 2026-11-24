
import { ColumnDataType, ValueTypes } from "../../../common/types/common.types";
import { ColumnMetadata, ForeignKeyMetadata, TableMetadata } from "../../storage/catalog/catalog.types";
import { Expr } from "../parser/expression.types";

export interface AnalyzedSelect{
    type: "Select";
    table: TableMetadata;
    projectedColumns: ProjectedColumn[];
    where?: Expr;
    orderBy?: OrderBy[];
    limit?: number;
}

export interface ProjectedColumn {
    name: string;
    type: ColumnDataType | "NULL";
    expression: Expr;
}

export interface OrderBy{
    column: Expr;
    direction: "ASC" | "DESC";
}

export interface AnalyzedInsert{
    type: "Insert";
    table: TableMetadata;
    values: CellValue[][];
}

export interface AnalyzedUpdate{
    type: "Update";
    table: TableMetadata;
    assignments: ColumnAssignment[];
    where?: Expr;
}

export interface ColumnAssignment {
    columnIndex: number;
    value: Expr;
}

export interface AnalyzedDelete{
    type: "Delete";
    table: TableMetadata;
    where?: Expr;
}

export interface AnalyzedCreateTable{
    type: "CreateTable";
    table: TableMetadata;
}

export interface AnalyzedAddColumn{
    type: "AddColumn";
    table: TableMetadata;
    column: ColumnMetadata;
    foreignKey?: ForeignKeyMetadata;
}

export interface AnalyzedDropColumn{
    type: "DropColumn";
    table: TableMetadata;
    columnIndex: number;
}

export interface AnalyzedRenameColumn{
    type: "RenameColumn";
    table: TableMetadata;
    columnIndex: number;
    oldColumnName: string;
    newColumnName: string;
}

export interface AnalyzedDropTable{
    type: "DropTable";
    table: TableMetadata;
}

export type AnalyzedAlterTable = AnalyzedAddColumn | AnalyzedDropColumn | AnalyzedRenameColumn;

export type AnalyzedQuery = AnalyzedSelect | AnalyzedInsert | AnalyzedUpdate | AnalyzedDelete | AnalyzedCreateTable | AnalyzedDropTable | AnalyzedAlterTable;

export type CellValue = ValueTypes | GeneratedValue ;
//marker
export type GeneratedValue = {
    type: "GENERATED";
};