import { Injectable } from "@nestjs/common";
import { CatalogService } from "../../storage/catalog/catalog.service";
import { StorageManagerService } from "../../storage/storage-manager.service";
import { AnalyzedAddColumn, AnalyzedCreateTable, AnalyzedDropColumn, AnalyzedDropTable, AnalyzedRenameColumn } from "../query-analyzer/query-analyzer.types";
import { TableMetadata } from "../../storage/catalog/catalog.types";
import { ExecutionError } from "../../errors";

@Injectable()
export class DDLExecutor {
    constructor(private catalogService: CatalogService, private storageManager:  StorageManagerService) {}
    async executeCreateTable(query: AnalyzedCreateTable): Promise<void> {
        await this.storageManager.createTable(query.table);
    }

    async executeDropTable(query: AnalyzedDropTable): Promise<void> {
        await this.storageManager.dropTable(query.table.name);
    }

    async executeAddColumn(query: AnalyzedAddColumn): Promise<void> {
        const tableName = query.table.name;
        const newSchema = [...query.table.columns, query.column];
        const newTableMetadata = { 
            ...query.table, 
            columns: newSchema,
            primaryKey: query.column.isPrimaryKey ? query.column.name : query.table.primaryKey,
            foreignKeys: query.foreignKey ? [...(query.table.foreignKeys || []), query.foreignKey] : query.table.foreignKeys
        };

        if(await this.storageManager.isEmptyTable(tableName)) {
            this.catalogService.replaceTable(newTableMetadata);
            await this.catalogService.flushToDisk().catch(() => {
                this.catalogService.replaceTable(query.table);
                this.throwError("Failed to flush catalog changes to disk. Original schema restored.");
            });
            return;
        }

        if(query.column.isNullable === false) {
            this.throwError(`Cannot add a non-nullable column '${query.column.name}' to a non-empty table '${tableName}'.`);
        }

        // Add the column to the table file in the storage manager
        await this.storageManager.rewriteTable(tableName, newSchema, (tuple) => {
            return [...tuple, null]; 
        }, newTableMetadata);
    }

    async executeDropColumn(query: AnalyzedDropColumn): Promise<void> {
        const tableName = query.table.name;

        const newSchema = query.table.columns.filter(
            (_, i) => i !== query.columnIndex
        );
        const droppedColumn = query.table.columns[query.columnIndex];
        const newTableMetadata: TableMetadata = {
            ...query.table,
            columns: newSchema,
            primaryKey: query.table.primaryKey?.toLowerCase() === droppedColumn.name.toLowerCase()
                ? undefined
                : query.table.primaryKey,
            foreignKeys: query.table.foreignKeys?.filter(
                (foreignKey) => foreignKey.columnName.toLowerCase() !== droppedColumn.name.toLowerCase()
            ),
        };
        // Drop the column from the table file in the storage manager
        await this.storageManager.rewriteTable(tableName, newSchema, (tuple) => {
            return tuple.filter((_, i) => i !== query.columnIndex);
        }, newTableMetadata);
    }

    async executeRenameColumn(query: AnalyzedRenameColumn): Promise<void> {
        this.catalogService.renameColumn(query.table.name, query.columnIndex, query.newColumnName);
        await this.catalogService.flushToDisk().catch((error) => {
            this.catalogService.renameColumn(query.table.name, query.columnIndex, query.oldColumnName);
            this.throwError(`Failed to flush catalog to disk after renaming column: ${error}`);
        });
    }

    private throwError(message: string): never {
        throw new ExecutionError(message);
    }
}