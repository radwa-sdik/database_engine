import { Injectable } from "@nestjs/common";
import { BindingError } from "../../errors";
import { ExpressionEvaluator } from "../../helpers/expression-evalutor";
import { CatalogMapper } from "../../storage/catalog/catalog.mapper";
import { ColumnMetadata, TableMetadata } from "../../storage/catalog/catalog.types";
import { ColumnRefExpr, Expr } from "../parser/expression.types";
import { AddColumnStatement, ColumnDefinition, CreateTableStatement, DeleteStatement, DropColumnStatement, DropTableStatement, InsertStatement, RenameColumnStatement, SelectStatement, Statement, UpdateStatement } from "../parser/statment.types";
import { DateParser } from "../../helpers/date-parser";
import { AnalyzedAddColumn, AnalyzedCreateTable, AnalyzedDelete, AnalyzedDropColumn, AnalyzedDropTable, AnalyzedInsert, AnalyzedQuery, AnalyzedRenameColumn, AnalyzedSelect, AnalyzedUpdate, CellValue, ColumnAssignment } from "./query-analyzer.types";
import { ColumnDataType } from "../../../common/types/common.types";
import { CatalogService } from "../../storage/catalog/catalog.service";

@Injectable()
export class QueryAnalyzerService {
    constructor(private catalogService: CatalogService) {}
    
    analyze(ast: Statement): AnalyzedQuery {
        switch (ast.type) {
            case "Select":
                return this.analyzeSelect(ast);
            case "Insert":
                return this.analyzeInsert(ast);
            case "Update":
                return this.analyzeUpdate(ast);
            case "Delete":
                return this.analyzeDelete(ast);
            case "CreateTable":
                return this.analyzeCreateTable(ast);
            case "AddColumn":
                return this.analyzeAddColumn(ast);
            case "DropColumn":
                return this.analyzeDropColumn(ast);
            case "RenameColumn":
                return this.analyzeRenameColumn(ast);
            case "DropTable":
                return this.analyzeDropTable(ast);
            default:
                this.throwError(`Unsupported statement type.`);
        }
    }
    
    private analyzeRenameColumn(ast: RenameColumnStatement) : AnalyzedRenameColumn {
        const table = this.requireTable(ast.table);
        const columnIndex = this.requireColumn(table, ast.oldName);
        //check new column name does not already exist
        const newColumnIndex = table.columns.findIndex((col) => col.name === ast.newName);
        if (newColumnIndex !== -1) {
            this.throwError(`Column '${ast.newName}' already exists in table '${ast.table}'.`);
        }
        return { type: "RenameColumn", table, columnIndex, oldColumnName: ast.oldName, newColumnName: ast.newName };
    }

    private analyzeAddColumn(ast: AddColumnStatement) : AnalyzedAddColumn {
        const table = this.requireTable(ast.table);
        const columnNames = table.columns.map(c => c.name.toLowerCase());
        const column = ast.column;
        if (columnNames.includes(column.name.toLowerCase())) {
            this.throwError(`Column "${column.name}" already exists in table "${ast.table}".`);
        }
        this.checkColumn(column, table);
        if(column.isPrimaryKey && table.primaryKey) {
            this.throwError(`Table "${ast.table}" already has a primary key column "${table.primaryKey}". Cannot add another primary key column "${column.name}".`);
        }
        const mappedColumn = CatalogMapper.fromAddColumn(ast);
        const foreignKey = column.references ? CatalogMapper.fromForeignKeyDefinition(column.name, column.references) : undefined;
        return { type: "AddColumn", table, column: mappedColumn, foreignKey };
    }

    private analyzeDropColumn(ast: DropColumnStatement) : AnalyzedDropColumn {
        const table = this.requireTable(ast.table);
        const columnIndex = this.requireColumn(table, ast.column);
        const column = table.columns[columnIndex];

        if(table.columns.length === 1) {
            this.throwError(`Cannot drop the last column "${column.name}" from table "${ast.table}".`);
        }

        // A primary key or ordinary column cannot be dropped while it is referenced.
        if(this.catalogService.isReferencedByForeignKey(ast.table, column.name, false)) {
            this.throwError(`Cannot drop column "${column.name}" as it is referenced by a foreign key.`);
        }

        return { type: "DropColumn", table, columnIndex };
    }

    private analyzeUpdate(ast: UpdateStatement): AnalyzedUpdate {
        const table = this.requireTable(ast.table);
        const assignments: ColumnAssignment[] = [];
        const columnIndexes = [];

        for (const assignment of ast.set) {
            const columnIndex = this.requireColumn(table, assignment.column);
            const column = table.columns[columnIndex];

            if(column.isPrimaryKey) {
                this.throwError(`Cannot update primary key column "${column.name}".`);
            }
            if(column.dataType === "SERIAL") {
                this.throwError(`Cannot update SERIAL column "${column.name}". It is auto-incremented.`);
            }

            columnIndexes.push(columnIndex);

            if(!this.checkColumnRefInExpr(assignment.value)) {
                const value = ExpressionEvaluator.evaluate(assignment.value);
                const normalizedValue = this.valueFitsColumn(value, column);
                assignments.push({ columnIndex, value: { type: "Literal", value: normalizedValue } as Expr });
            } else {
                const valueType = this.typeOfExpr(assignment.value, table);
                if(!this.TypeFitsColumn(valueType, column)) {                        
                    this.throwError(`Type mismatch for column "${column.name}". Expected ${column.dataType}, got ${valueType}.`);
                }
                const boundValue = this.bindColumnRefsInExpr(assignment.value, table);
                assignments.push({ columnIndex, value: boundValue });
            }
        }

        if (new Set(columnIndexes).size !== columnIndexes.length) {
            this.throwError(`Duplicate columns in UPDATE statement.`);
        }

        const boundWhere = ast.where ? this.checkWhereClause(ast.where, table) : undefined;
        return { type: "Update", table, where: boundWhere, assignments };
    }

    private checkColumnRefInExpr(expr: Expr): boolean {
        switch (expr.type) {
            case "ColumnRef":
                return true;
            case "Binary":
            case "Logical":
                return this.checkColumnRefInExpr(expr.left) || this.checkColumnRefInExpr(expr.right);
            case "Unary":
            case "IsNull":
                return this.checkColumnRefInExpr(expr.operand);
            case "Literal":
                return false;
            default:
                this.throwError(`Unsupported expression type`);
        }
    }

    private analyzeDelete(ast: DeleteStatement): AnalyzedDelete {
        const table = this.requireTable(ast.table);
        const boundWhere = ast.where ? this.checkWhereClause(ast.where, table) : undefined;
        return { type: "Delete", table,where: boundWhere };
    }

    private analyzeCreateTable(ast: CreateTableStatement) : AnalyzedCreateTable {
        //check table name uniqueness
        if (this.catalogService.tableExists(ast.table)) {
            this.throwError(`Table '${ast.table}' already exists.`);
        }
        //check unique column names
        const columnNames = ast.columns.map(c => c.name.toLowerCase());
        if (new Set(columnNames).size !== columnNames.length) {
            this.throwError(`Duplicate column names in CREATE TABLE statement.`);
        }
        //check primary key constraints
        const primaryKeyColumns = ast.columns.filter(c => c.isPrimaryKey);
        if (primaryKeyColumns.length > 1) {
            this.throwError(`Multiple primary keys defined in CREATE TABLE statement.`);
        }
        const tableMetadata = CatalogMapper.fromCreateTable(ast);
        for (const column of ast.columns) {
            this.checkColumn(column,tableMetadata);
        }

        return {
            type: "CreateTable",
            table: tableMetadata
        };
    }

    private analyzeDropTable(ast: DropTableStatement) : AnalyzedDropTable {
        const table = this.requireTable(ast.table);
        if(this.catalogService.isReferencedByForeignKey(ast.table)) {
            this.throwError(`Cannot drop table "${ast.table}" as it is referenced by a foreign key in another table.`);
        }
        return {
            type: "DropTable",
            table: table
        };
    }

    private analyzeInsert(ast: InsertStatement) : AnalyzedInsert {
        const table = this.requireTable(ast.table);
        const columnIndexes = ast.columns.map(col => this.requireColumn(table, col));
        const values: CellValue[][] = [...Array(ast.rows.length)].map(() => []);
        if (columnIndexes.length !== new Set(columnIndexes).size) {
            this.throwError(`Duplicate columns in INSERT statement.`);
        }

        for (let i = 0; i < ast.rows.length; i++) {
            const row = ast.rows[i];
            if (row.length !== columnIndexes.length) {
                this.throwError(`Row ${i + 1} has ${row.length} values, but ${columnIndexes.length} columns were specified.`);
            }
            for (let j = 0; j < row.length; j++) {
                const columnIndex = columnIndexes[j];
                const column = table.columns[columnIndex];
                const value = ExpressionEvaluator.evaluate(row[j]);
                const normalizedValue = this.valueFitsColumn(value, column);
                values[i][columnIndex] = normalizedValue;
            }
        }

        // Fill in default values for columns not specified in the INSERT statement
        for (let i = 0; i < values.length; i++) {
            for (let j = 0; j < table.columns.length; j++) {
                if (values[i][j] === undefined) {
                    const column = table.columns[j];
                    if (column.dataType === "SERIAL") {
                        values[i][j] = {type: "GENERATED"};
                    } else if (!column.isNullable) {
                        this.throwError(`Column "${column.name}" cannot be null in row ${i + 1}.`);
                    } else {
                        values[i][j] = null;
                    }
                }
            }
        }

        return {
            type: "Insert",
            table: table,
            values: values
        }
    }

    private analyzeSelect(ast: SelectStatement): AnalyzedSelect {
        const table = this.requireTable(ast.from);
        
        let projectedColumns = [];

        if(ast.columns === '*') {
            projectedColumns = table.columns.map((col, columnIndex) => ({ 
                name: col.name, type: col.dataType, expression: { type: "BoundColumnRef", columnIndex } as Expr }));
        } else {
            projectedColumns = ast.columns.map(col => ({
                name: col.alias || (col.expression.type === "ColumnRef" ? col.expression.name : "expr"),
                type: this.typeOfExpr(col.expression, table),
                expression: this.bindColumnRefsInExpr(col.expression, table)
            }));
        }

        const boundWhere = ast.where ? this.checkWhereClause(ast.where, table) : undefined;

        const orderBy = ast.orderBy?.map(item => {
            const type = this.typeOfExpr(item.column, table);

            if (type === "BOOLEAN" || type === "NULL") {
                this.throwError(`Cannot order by expression of type ${type}.`);
            }

            return {
                column: this.bindColumnRefsInExpr(item.column, table),
                direction: item.direction
            };
        });

        if (ast.limit !== undefined && (!Number.isInteger(ast.limit) || ast.limit < 0)) {
            this.throwError(`LIMIT value must be a non-negative integer.`);
        }

        return {
            type: "Select",
            table,
            projectedColumns: projectedColumns,
            where: boundWhere,
            orderBy: orderBy,
            limit: ast.limit
        };
    }

    private checkColumn(column: ColumnDefinition, table?: TableMetadata) { 

        if(column.dataType.type === "CHAR" && (column.dataType.length === undefined || column.dataType.length <= 0)) {
            this.throwError(`CHAR type must have a positive length specified for column "${column.name}".`);
        }

        if (column.references) {
            if (!table) {
                this.throwError(`Table context is required to validate foreign key references for column "${column.name}".`);
            }

            const refTable = column.references.referencesTable;
            const refColumn = column.references.referencesColumn;
            const isSelfRef = refTable.toLowerCase() === table.name.toLowerCase();

            const referencedTable = isSelfRef ? table : this.catalogService.getTable(refTable);

            if (!referencedTable) {
                this.throwError(`Referenced table '${refTable}' does not exist for foreign key on column '${column.name}'.`);
            }

            const referencedColumn = referencedTable.columns.find(c => c.name === refColumn);
            if (!referencedColumn) {
                this.throwError(`Referenced column '${refColumn}' does not exist in table '${refTable}' for foreign key on column '${column.name}'.`);
            }

            if (referencedColumn.dataType !== column.dataType.type && !(["INTEGER", "SERIAL"].includes(referencedColumn.dataType) && ["INTEGER", "SERIAL"].includes(column.dataType.type))) {
                this.throwError(`Data type mismatch for foreign key on column '${column.name}'. Expected '${referencedColumn.dataType}', got '${column.dataType.type}'.`);
            }

            if (referencedTable.primaryKey !== refColumn && !referencedColumn.isUnique) {
                this.throwError(`Referenced column '${refColumn}' in table '${refTable}' must be a primary key or unique for foreign key on column '${column.name}'.`);
            }
        }
    }

    //helpers
    private requireTable(tableName: string): TableMetadata {
        const table = this.catalogService.getTable(tableName);
        if (!table) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }

        return table;
    }

    private requireColumn(table: TableMetadata, columnName: string): number {
        const columnIndex = table.columns.findIndex((col) => col.name === columnName);
        if (columnIndex === -1) {
            this.throwError(`Column '${columnName}' does not exist in table '${table.name}'.`);
        }
        return columnIndex;
    }

    // Determine the final data type of an expression
    private typeOfExpr(expr: Expr, table: TableMetadata): ColumnDataType | "NULL" {       
        switch (expr.type) {
            case "Literal":
                return this.mapValueToDataType(expr.value);
                
            case "ColumnRef":
                const columnIndex = this.requireColumn(table, expr.name);
                return table.columns[columnIndex].dataType;

            case "BoundColumnRef":
                if (expr.columnIndex < 0 || expr.columnIndex >= table.columns.length) {
                    this.throwError("Invalid bound column reference.");
                }

                return table.columns[expr.columnIndex].dataType;

            case "Binary":
                let leftType = this.typeOfExpr(expr.left, table);
                let rightType = this.typeOfExpr(expr.right, table);
                const operator = expr.operator;

                const arithmeticOperators = ['+', '-', '*', '/'];
                const comparisonOperators = ['=', '!=','<', '>', '<=', '>='];


                if(leftType === "NULL" || rightType === "NULL") {
                    leftType = leftType === "NULL" ? rightType : leftType;
                    rightType = rightType === "NULL" ? leftType : rightType;                    
                }

                if (arithmeticOperators.includes(operator)) {
                    if(leftType === "NULL" && rightType === "NULL") 
                        return "NULL";

                    if (!["INTEGER", "DOUBLE", "SERIAL"].includes(leftType) || !["INTEGER", "DOUBLE", "SERIAL"].includes(rightType)) {
                        this.throwError(`Arithmetic operations can only be performed on numeric types.`);
                    }
                    return leftType === "DOUBLE" || rightType === "DOUBLE" ? "DOUBLE" : "INTEGER";
                }

                if (comparisonOperators.includes(operator)) {

                    if (!this.isComparableTypes(leftType, rightType)) {
                        this.throwError(`Cannot compare types ${leftType} and ${rightType}.`);
                    }

                    if (["<", ">", "<=", ">="].includes(operator) && leftType === "BOOLEAN") {
                        this.throwError("Boolean values do not support ordering comparisons.");
                    }

                    //check time stamp comparison with text
                    if ((leftType === "TIMESTAMP" && ["TEXT", "CHAR"].includes(rightType)) || (["TEXT", "CHAR"].includes(leftType) && rightType === "TIMESTAMP")) {
                        const textOperand = ["TEXT", "CHAR"].includes(rightType) ? expr.right : expr.left;
                        if(textOperand.type !== "Literal") {
                            this.throwError(`Cannot compare TIMESTAMP with non-literal text.`);
                        }
                        const parsedDate = DateParser.parseTimestamp(textOperand.value as string);
                        if (parsedDate === null) {
                            this.throwError(`Invalid TIMESTAMP format for value: ${textOperand.value}`);
                        }
                        textOperand.value = parsedDate;
                    }

                    return "BOOLEAN";
                }
                this.throwError(`Unsupported binary operator: ${operator}`);


            case "Logical":
                const leftLogicalType = this.typeOfExpr(expr.left, table);
                const rightLogicalType = this.typeOfExpr(expr.right, table);

                if (["BOOLEAN", "NULL"].includes(leftLogicalType) && ["BOOLEAN", "NULL"].includes(rightLogicalType)) {
                    return "BOOLEAN";
                }
                
                this.throwError(`Logical expressions must be of type BOOLEAN.`);

            case "Unary":
                const exprType = this.typeOfExpr(expr.operand, table);

                if (expr.operator === "NOT") {
                    if (!["BOOLEAN", "NULL"].includes(exprType)) {
                        this.throwError("NOT operator can only be applied to BOOLEAN expressions.");
                    }
                    return "BOOLEAN";
                }

                if (expr.operator === "-") {
                    if (exprType === "NULL") {
                        return "NULL";
                    }
                    if (!["INTEGER", "DOUBLE", "SERIAL"].includes(exprType)) {
                        this.throwError("Unary minus can only be applied to numeric expressions.");
                    }
                    return exprType;
                }

                this.throwError(`Unsupported unary operator: ${expr.operator}`);
                break;

            case "IsNull":
                this.typeOfExpr(expr.operand, table);
                return "BOOLEAN";
            default:
                this.throwError(`Unsupported expression type`);
        }
    }
    
    private mapValueToDataType(value: any): ColumnDataType | "NULL" {
        if (typeof value === "number") {
            return Number.isInteger(value) ? "INTEGER" : "DOUBLE";
        } else if (typeof value === "string") {
            return "TEXT";
        }
        else if (typeof value === "boolean") {
            return "BOOLEAN";
        }
        else if (value === null) {
            return "NULL";
        }
        else {
            this.throwError(`Unsupported literal value type: ${typeof value}`);
        }
    }

    private isComparableTypes(left: ColumnDataType | "NULL", right: ColumnDataType | "NULL"): boolean {
        if (left === "NULL" || right === "NULL")  return true; 
        if (left === right) return true;
        

        const numericTypes = ["INTEGER", "DOUBLE","SERIAL"];
        if (numericTypes.includes(left) && numericTypes.includes(right))  return true;
        
        const textTypes = ["CHAR", "TEXT", "TIMESTAMP"];
        if (textTypes.includes(left) && textTypes.includes(right))  return true;

        return false;
    }

    private TypeFitsColumn(valueType: ColumnDataType | "NULL", column: ColumnMetadata): boolean {
        const columnType = column.dataType;
        if (valueType === "NULL") {
            return column.isNullable;
        }
        if (valueType === columnType) return true;

        const integerTypes = ["INTEGER","SERIAL"];
        if (integerTypes.includes(valueType) && integerTypes.includes(columnType)) return true;

        if(columnType === "DOUBLE" && integerTypes.includes(valueType)) return true;

        const textTypes = ["CHAR", "TEXT"];
        if (textTypes.includes(valueType) && textTypes.includes(columnType))  return true;

        return false;
    }

    //return normalized value if it fits the column type, otherwise throw error
    private valueFitsColumn(value: any, column: ColumnMetadata): CellValue {
        if (value === null) {
            return column.isNullable ? null : this.throwError(`null value in column "${column.name}" violates not-null constraint`);
        }
        const valueType = this.mapValueToDataType(value);

        switch (column.dataType) {
            case "INTEGER":
            case "SERIAL":
                if (valueType === "INTEGER"){
                    if(value < -2147483648 || value > 2147483647) {
                        this.throwError(`Value ${value} is out of range for INTEGER type.`);
                    }
                    return value;
                }
                break;
            case "DOUBLE":
                if (valueType === "INTEGER" || valueType === "DOUBLE") return value;
                break;
            case "TEXT":
                if (valueType === "TEXT") return value;
                break;
            case "CHAR":
                if (valueType === "TEXT") {
                    if (column.length !== undefined && value.length > column.length) {
                        this.throwError(`Value "${value}" exceeds the maximum length of ${column.length} for CHAR type.`);
                    }
                    return value;
                }
                break;
            case "BOOLEAN":
                if (valueType === "BOOLEAN") return value;
                break;
            case "TIMESTAMP":
                if (valueType === "TEXT") {
                    const parsedDate = DateParser.parseTimestamp(value);
                    if (parsedDate !== null) return parsedDate;
                    else this.throwError(`Invalid TIMESTAMP format for value: ${value}`);
                }
                break;
            default:
                this.throwError(`Unsupported column data type: ${column.dataType}`);
        }
        this.throwError(`Value type ${valueType} does not match column type ${column.dataType} for column "${column.name}".`);
    }

    private checkWhereClause(where: Expr, table: TableMetadata): Expr {
        const type = this.typeOfExpr(where, table);
        if (type !== "BOOLEAN" && type !== "NULL") {
            this.throwError(`WHERE clause must evaluate to a boolean expression.`);
        }
        return this.bindColumnRefsInExpr(where, table);
    }

    private bindColumnRefsInExpr(expr: Expr, table: TableMetadata): Expr {
        switch (expr.type) {
            case "ColumnRef":
                const columnIndex = this.requireColumn(table, expr.name);
                return { type: "BoundColumnRef", columnIndex };
            case "BoundColumnRef":
                if (expr.columnIndex < 0 || expr.columnIndex >= table.columns.length) {
                    this.throwError(`Invalid bound column reference at index ${expr.columnIndex}.`);
                }
                return expr;
            case "Binary":
            case "Logical":
                return {
                    ...expr,
                    left: this.bindColumnRefsInExpr(expr.left, table),
                    right: this.bindColumnRefsInExpr(expr.right, table)
                };
            case "Unary":
            case "IsNull":
                return {
                    ...expr,
                    operand: this.bindColumnRefsInExpr(expr.operand, table)
                };
            case "Literal":
                return expr;
            default:
                this.throwError(`Unsupported expression type in WHERE clause.`);
        }
    }

    private throwError(message: string): never {
        throw new BindingError(message);
    }
}

