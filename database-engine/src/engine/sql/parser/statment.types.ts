import { ColumnDataType } from "../../../common/types/common.types";
import { Expr } from "./expression.types";

//Statement AST nodes
export type Statement = SelectStatement | InsertStatement | UpdateStatement | DeleteStatement | CreateTableStatement | AlterTableStatement | DropTableStatement;

export interface SelectStatement {
    type: "Select";
    columns: SelectColumn[] | '*';
    from: string;
    where?: Expr;
    orderBy?: OrderByClause[];
    limit?: number;
}

export interface SelectColumn {
    type: "SelectColumn";
    expression: Expr;
    alias?: string;
}

export interface OrderByClause {
    type: "OrderBy";
    column: Expr;
    direction: "ASC" | "DESC";
}


export interface InsertStatement {
    type: "Insert";
    table: string;
    columns: string[];
    rows: Expr[][];
}

export interface UpdateStatement {
    type: "Update";
    table: string;
    set: UpdateSetClause[];
    where?: Expr;
}

export interface UpdateSetClause {
    type: "UpdateSet";
    column: string;
    value: Expr;
}

export interface DeleteStatement {
    type: "Delete";
    table: string;
    where?: Expr;
}

export interface CreateTableStatement {
    type: "CreateTable";
    table: string;
    columns: ColumnDefinition[];
}

export type AlterTableStatement = AddColumnStatement | DropColumnStatement | RenameColumnStatement;

export interface AddColumnStatement {
    type: "AddColumn";
    table: string;
    column: ColumnDefinition;
}

export interface DropColumnStatement {
    type: "DropColumn";
    table: string;
    column: string;
}

export interface RenameColumnStatement {
    type: "RenameColumn";
    table: string;
    oldName: string;
    newName: string;
}

export interface DropTableStatement {
    type: "DropTable";
    table: string;
}

export interface ColumnDefinition {
    type: "Column";
    name: string;
    dataType: DataType;
    isPrimaryKey: boolean;
    isUnique: boolean;
    isNotNull: boolean;
    references?: ForeignKeyDefinition;
}

export interface ForeignKeyDefinition {
    referencesTable: string;
    referencesColumn: string;
}

export interface DataType{
    type: ColumnDataType;
    length?: number; // For CHAR type, specify the length
}