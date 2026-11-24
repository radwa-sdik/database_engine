import { Injectable } from "@nestjs/common";
import { ColumnDataType, ValueTypes } from "../../../common/types/common.types";
import { DateParser } from "../../helpers/date-parser";
import { CatalogService } from "../../storage/catalog/catalog.service";
import { ColumnMetadata, TableMetadata } from "../../storage/catalog/catalog.types";
import { StoredTuple, TupleId } from "../../storage/file/file.types";
import { StorageManagerService } from "../../storage/storage-manager.service";
import { CellValue } from "../query-analyzer/query-analyzer.types";
import { ExecutionError } from "../../errors";

@Injectable()
export class ConstraintsValidator {
    constructor(private catalogService: CatalogService, private storageManager: StorageManagerService) {}
    async validateInsert(table: TableMetadata, rows: CellValue[][], existingTuples: StoredTuple[]): Promise<void> {
        await this.validateRows(table, rows, existingTuples);
    }
     async validateUpdate(table: TableMetadata, updatedRows: {tupleId: TupleId, newValues: ValueTypes[]}[], existingTuples: StoredTuple[]): Promise<void> {
        existingTuples = existingTuples.filter(tuple => !updatedRows.some(row => this.isSameTupleId(row.tupleId, tuple.id)));
        const rowsToValidate = updatedRows.map(row => row.newValues);
        await this.validateRows(table, rowsToValidate, existingTuples);
    }

    async validateDelete(table: TableMetadata, rowsToDelete: StoredTuple[]): Promise<void> {
        const referencingFKs = this.catalogService.getReferencingForeignKeys(table.name);
        if (!referencingFKs.length || !rowsToDelete.length) return;
        for (const fk of referencingFKs) {
            const referencingTable = fk.table;
            const foreignKey = fk.foreignKey;
            const referencedColumnIndex = table.columns.findIndex(col => col.name.toLowerCase() === foreignKey.referencedColumn.toLowerCase());
            const referencingColumnIndex = referencingTable.columns.findIndex(col => col.name.toLowerCase() === foreignKey.columnName.toLowerCase());

            if (referencedColumnIndex === -1 || referencingColumnIndex === -1)
                this.throwError("Invalid foreign key metadata.");

            const deletedValues = new Set(
                rowsToDelete
                    .map(tuple => tuple.data[referencedColumnIndex])
                    .filter(value => value !== null)
            );
            if (!deletedValues.size) continue;

            const referencingTuples = await this.storageManager.getTable(referencingTable.name);
            for (const tuple of referencingTuples) {
                if (rowsToDelete.some(row => this.isSameTupleId(row.id, tuple.id))) continue;

                const referencingValue = tuple.data[referencingColumnIndex];
                if (referencingValue !== null && deletedValues.has(referencingValue)) {
                    this.throwError(`Cannot delete from table '${table.name}' as it is referenced by table '${referencingTable.name}' via foreign key on column '${foreignKey.columnName}'.`);
                }
            }
        }
    }

    private async validateRows(table: TableMetadata,rows: CellValue[][],existingTuples: StoredTuple[]): Promise<void> {
        for (const row of rows) {
            if (row.length !== table.columns.length) {
                this.throwError(`Row length ${row.length} does not match table schema length ${table.columns.length}.`);
            }

            for (let i = 0; i < table.columns.length; i++) {
                this.validateValueFitsColumn(row[i], table.columns[i]);
            }
        }

        await this.validateForeignKeys(table, rows, existingTuples);
        this.validateUniqueValues(table, rows, existingTuples);
    }

    private async validateForeignKeys(table: TableMetadata,rows: CellValue[][],existingTuples: StoredTuple[]): Promise<void> {
        for (const foreignKey of table.foreignKeys ?? []) {
            const columnIndex = table.columns.findIndex(
                col => col.name.toLowerCase() === foreignKey.columnName.toLowerCase()
            );

            if (columnIndex < 0) {
                this.throwError(`Foreign key column '${foreignKey.columnName}' does not exist in table '${table.name}'.`);
            }

            const referencedTable = this.catalogService.getTable(foreignKey.referencedTable);

            if (!referencedTable) {
                this.throwError(`Referenced table '${foreignKey.referencedTable}' does not exist.`);
            }

            const referencedColumnIndex = referencedTable.columns.findIndex(
                col => col.name.toLowerCase() === foreignKey.referencedColumn.toLowerCase()
            );

            if (referencedColumnIndex < 0) {
                this.throwError(
                    `Referenced column '${foreignKey.referencedColumn}' does not exist in table '${foreignKey.referencedTable}'.`
                );
            }

            // For self-referencing FKs, include the new batch and unaffected rows.
            const isSelfReference = table.name.toLowerCase() === foreignKey.referencedTable.toLowerCase();

            const referencedRows = isSelfReference
                ? [...existingTuples.map(tuple => tuple.data), ...rows]
                : (await this.storageManager.getTable(foreignKey.referencedTable)).map(tuple => tuple.data);

            for (const row of rows) {
                const value = row[columnIndex];

                if (value === null || this.isGeneratedValue(value)) continue;

                if (!referencedRows.some(referencedRow => referencedRow[referencedColumnIndex] === value)) {
                    this.throwError(
                        `Foreign key constraint violation: Value '${value}' in column '${foreignKey.columnName}' does not exist in referenced table '${foreignKey.referencedTable}'.`
                    );
                }
            }
        }
    }

    private validateUniqueValues(table: TableMetadata,rows: CellValue[][],existingTuples: StoredTuple[]): void {
        for (let i = 0; i < table.columns.length; i++) {
            const column = table.columns[i];

            if (!column.isUnique && !column.isPrimaryKey) continue;

            // NULL values and generated placeholders are excluded from the comparison.
            const newValues = rows
                .map(row => row[i])
                .filter(value => value !== null && !this.isGeneratedValue(value));

            const existingValues = existingTuples
                .map(tuple => tuple.data[i])
                .filter(value => value !== null);

            if (new Set(newValues).size !== newValues.length ||
                newValues.some(value => existingValues.includes(value as any))) {
                this.throwError(`Unique constraint violation: Column '${column.name}' must have unique values.`);
            }
        }
    }

    private  validateValueFitsColumn(value: CellValue, column: ColumnMetadata): void {
        if (this.isGeneratedValue(value)) {
            if (column.dataType !== "SERIAL") {
                this.throwError(`Generated values are only allowed for SERIAL columns. Column: '${column.name}'.`);
            }
            return;
        }
        if (value === null) {
            if (!column.isNullable)
                this.throwError(`Column '${column.name}' cannot be NULL.`);

            return;
        }

        const valueType = this.mapValueToDataType(value);
        
        switch (column.dataType) {
            case "INTEGER":
            case "SERIAL":
                if (valueType === "INTEGER"){
                    const intValue = value as number;
                    if(intValue < -2147483648 || intValue > 2147483647) {
                        this.throwError(`Value ${value} is out of range for INTEGER type.`);
                    }
                    return;
                }
                break;
            case "DOUBLE":
                if (valueType === "INTEGER" || valueType === "DOUBLE") return;
                break;
            case "TEXT":
                if (valueType === "TEXT") return;
                break;
            case "CHAR":
                if (valueType === "TEXT") {
                    const strValue = value as string;
                    if (column.length !== undefined && [...strValue].length > column.length) {
                        this.throwError(`Value "${value}" exceeds the maximum length of ${column.length} for CHAR type.`);
                    }
                    return;
                }
                break;
            case "BOOLEAN":
                if (valueType === "BOOLEAN") return;
                break;
            case "TIMESTAMP":
                if (valueType === "TEXT") {
                    const strValue = value as string;
                    const parsedDate = DateParser.parseTimestamp(strValue);
                    if (parsedDate === null) this.throwError(`Invalid TIMESTAMP format for value: ${value}`);
                    return;
                }
                if (valueType === "INTEGER" && typeof value === "number" && Number.isSafeInteger(value)) return;
                break;
            default:
                this.throwError(`Unsupported column data type: ${column.dataType}`);
        }

        this.throwError(`Value '${value}' does not fit the data type of column '${column.name}'. Expected ${column.dataType}, but got ${valueType}.`);
    };

    private  mapValueToDataType(value: any): ColumnDataType | "NULL" {
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

    private  isSameTupleId(a: TupleId, b: TupleId): boolean {
        return a.fileName === b.fileName &&
            a.pageId === b.pageId &&
            a.slotIndex === b.slotIndex;
    }

    private  isGeneratedValue(value: CellValue): boolean {
        return typeof value === "object" && value !== null && (value as any).type === "GENERATED";
    }

    private throwError(message: string): never {
        throw new ExecutionError(message);
    }
}