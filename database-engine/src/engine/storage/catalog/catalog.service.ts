import { OnModuleInit, Injectable} from "@nestjs/common";

import { CatalogStore } from "./catalog-store";
import { DatabaseMetadata, ForeignKeyMetadata, TableMetadata } from "./catalog.types";
import { CatalogError } from "../../errors";

@Injectable()
export class CatalogService implements OnModuleInit {
    private database: DatabaseMetadata = {
        name: "MyDatabase",
        tables: new Map()
    };
    private persistedCatalogLoaded = false;

    constructor() {}

    async onModuleInit(): Promise<void> {
        const loadedCatalog = await CatalogStore.loadCatalog();

        if (loadedCatalog) {
            this.database = loadedCatalog;
            this.persistedCatalogLoaded = true;
        }
    }

    get hasPersistedCatalog(): boolean {
        return this.persistedCatalogLoaded;
    }

    getTable(tableName: string): TableMetadata | undefined {
        return this.database.tables.get(tableName.toLowerCase());
    }

    getTables(): TableMetadata[] {
        return Array.from(this.database.tables.values());
    }

    tableExists(tableName: string): boolean {
        return this.database.tables.has(tableName.toLowerCase());
    }

    columnExists(tableName: string, columnName: string): boolean {
        const table = this.getTable(tableName);
        return table?.columns.find((c) => c.name === columnName.toLowerCase()) !== undefined;
    }

    addTable(table: TableMetadata): void {
        const key = table.name.toLowerCase();

        if (this.database.tables.has(key)) {
            this.throwError(`Table '${table.name}' already exists.`);
        }

        this.database.tables.set(key, table);
    }

    removeTable(tableName: string): void {
        this.database.tables.delete(tableName.toLowerCase());
    }

    renameColumn(tableName: string, columnIndex: number, newColumnName: string): void {
        const table = this.getTable(tableName);
        if (!table) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }
        if (columnIndex < 0 || columnIndex >= table.columns.length) {
            this.throwError(`Column index ${columnIndex} is out of bounds for table '${tableName}'.`);
        }

        //rename foreign keys that reference this column
        for (const tbl of this.database.tables.values()) {
            if (tbl.foreignKeys) {
                for (const fk of tbl.foreignKeys) {
                    if (fk.referencedTable.toLowerCase() === tableName.toLowerCase() && fk.referencedColumn.toLowerCase() === table.columns[columnIndex].name.toLowerCase()) {
                        fk.referencedColumn = newColumnName.toLowerCase();
                    }
                }
            }
        }

        if (table.primaryKey?.toLowerCase() === table.columns[columnIndex].name.toLowerCase()) {
            table.primaryKey = newColumnName.toLowerCase();
        }


        table.columns[columnIndex].name = newColumnName.toLowerCase();
    }

    replaceTable(table: TableMetadata): void {
        const key = table.name.toLowerCase();
        if (!this.database.tables.has(key)) {
            this.throwError(`Table '${table.name}' does not exist.`);
        }
        this.database.tables.set(key, table);
    }

    isReferencedByForeignKey(tableName: string, columnName?: string, excludeSelf: boolean = false): boolean {
        const lowerTableName = tableName.toLowerCase();
        for (const table of this.database.tables.values()) {
            if(table.name.toLowerCase() === lowerTableName) {
                if (excludeSelf) {
                    continue; // Skip checking foreign keys in the same table
                }
            }
            const fk = table.foreignKeys?.some((fk) => fk.referencedTable.toLowerCase() === lowerTableName  && (!columnName || fk.referencedColumn.toLowerCase() === columnName.toLowerCase()));
            if (fk) return true;
        }
        return false;
    }

    getReferencingForeignKeys(tableName: string, columnName?: string, excludeSelf: boolean = false): { table: TableMetadata; foreignKey: ForeignKeyMetadata }[] {
        const referencingFKs: { table: TableMetadata; foreignKey: ForeignKeyMetadata }[] = [];
        const lowerTableName = tableName.toLowerCase();
        const lowerColumnName = columnName?.toLowerCase();

        for (const table of this.database.tables.values()) {
            if(excludeSelf &&table.name.toLowerCase() === lowerTableName) continue; // Skip checking foreign keys in the same table
            if (table.foreignKeys) {
                for (const fk of table.foreignKeys) {
                    if (fk.referencedTable.toLowerCase() === lowerTableName && (!lowerColumnName || fk.referencedColumn.toLowerCase() === lowerColumnName)) {
                        referencingFKs.push({ table, foreignKey: fk });
                    }
                }
            }
        }

        return referencingFKs;
    }

    async flushToDisk(): Promise<void> {
        await CatalogStore.saveCatalog(this.database);  
    }

    private throwError(message: string): never {
        throw new CatalogError(message);
    }
}