import path from "path";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import fs from "fs";
import { DATA_FILE_PATH, ValueTypes } from "../../common/types/common.types";
import { CellValue } from "../sql/query-analyzer/query-analyzer.types";
import { CatalogService } from "./catalog/catalog.service";
import { ColumnMetadata, TableMetadata } from "./catalog/catalog.types";
import { FileManagerService } from "./file/file-manager.service";
import { StoredTuple, TupleId } from "./file/file.types";
import { Page } from "./page/page";
import { TupleSerializerService } from "./tuple/tuple-serializer.service";
import { Tuple, TupleColumnDataType } from "./tuple/tuple.types";
import { MAX_TUPLE_SIZE } from "./page/page.types";
import { TupleTooLargeError } from "./page/page.error";
import { StorageError } from "../errors";

@Injectable()
export class StorageManagerService implements OnModuleDestroy {
    private tableFileManagers: Map<string, FileManagerService> = new Map();

    constructor(private catalogManager: CatalogService) {
    }
    
    async onModuleDestroy() {
        await this.closeAllFileManagers();
    }

    //ddl
    async createTable(table: TableMetadata): Promise<void> {
        if (this.catalogManager.tableExists(table.name)) {
            this.throwError(`Table '${table.name}' already exists.`);
        }
        const fileManager = await FileManagerService.create(`${table.name}.data`);
        try {
            this.catalogManager.addTable(table);
            await this.catalogManager.flushToDisk();
            this.tableFileManagers.set(table.name, fileManager);
        } catch (error) {
            this.catalogManager.removeTable(table.name);
            await fileManager.deleteAsync().catch(() => {});
            throw error;
        }
    }

    async dropTable(tableName: string): Promise<void> {
        const tableMetadata = this.catalogManager.getTable(tableName);
        tableName = tableName.toLowerCase();
        const fileManager = await this.getFileManager(tableName);

        this.catalogManager.removeTable(tableName);
        let isCatalogFlushed = false;

        try {
            await this.catalogManager.flushToDisk();
            isCatalogFlushed = true;
            await fileManager.deleteAsync();
            this.tableFileManagers.delete(tableName.toLowerCase());
        } catch (error) {
            this.catalogManager.addTable(tableMetadata!);
            
            if (isCatalogFlushed)
                await this.catalogManager.flushToDisk().catch(() => {});

            this.tableFileManagers.delete(tableName.toLowerCase());
            throw error;
        }

    }
    
    async rewriteTable(tableName: string, newSchema: ColumnMetadata[], transform: (tuple: ValueTypes[]) => ValueTypes[], newTableMetadata?: TableMetadata): Promise<void>{
        const oldTableMetadata =  this.catalogManager.getTable(tableName);
    
        if (!oldTableMetadata) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }  

        const oldFileManager = await this.getFileManager(tableName);
        const newFileManager = await FileManagerService.create(`${tableName}.tmp.data`);

        const backupPath = `${DATA_FILE_PATH}/${tableName}.backup.data`;
        const originalPath = `${DATA_FILE_PATH}/${tableName}.data`;
        const tempPath = `${DATA_FILE_PATH}/${tableName}.tmp.data`;

        let originalBackedUp = false;
        let newFilePersisted = false;
        let catalogChanged = false;

        try {
            let page = new Page();
            let currentPageId = await newFileManager.allocatePage(page.toBuffer());
            page.updatePageId(currentPageId);

            for await (const storedTuple of this.scanTable(tableName)) {
                const newValues = transform(storedTuple.data);
                const newTupleObj = this.valuesToTuple(newSchema, newValues);
                const newTupleEncoded = TupleSerializerService.serializeTuple(newTupleObj);
                let slotIndex = page.insert(newTupleEncoded);

                if (slotIndex === null) {
                    await newFileManager.writePageAsync(currentPageId, page.toBuffer());
                    page = new Page();
                    slotIndex = page.insert(newTupleEncoded);

                    if (slotIndex === null) {
                        this.throwError("Tuple is too large to fit into a new page.");
                    }
                    currentPageId = await newFileManager.allocatePage(page.toBuffer());
                    page.updatePageId(currentPageId);
                }

            }
            await newFileManager.writePageAsync(currentPageId, page.toBuffer());
            await newFileManager.setNextSerialValue(oldFileManager.getNextSerialValue());
            await newFileManager.closeAsync();

            await oldFileManager.closeAsync();

            //rename the new file to the original file name
            await fs.promises.unlink(backupPath).catch(() => {});
            await fs.promises.rename(originalPath, backupPath);
            originalBackedUp = true;

            await fs.promises.rename(tempPath, originalPath);
            newFilePersisted = true;

            this.catalogManager.replaceTable(newTableMetadata || {
                ...oldTableMetadata,
                columns: newSchema
            });

            await this.catalogManager.flushToDisk().catch(() => {
                this.catalogManager.replaceTable(oldTableMetadata);
                this.throwError("Failed to flush catalog changes to disk. Original schema restored.");
            });
            catalogChanged = true;
            //delete the backup file
            await fs.promises.unlink(backupPath).catch(() => {});
            this.tableFileManagers.delete(tableName.toLowerCase());
        } catch (error) {
              // Restore in-memory metadata.
            if (catalogChanged) {
                this.catalogManager.replaceTable(oldTableMetadata);
                await this.catalogManager.flushToDisk().catch(() => {});
            }

            // Restore original physical file.
            if (originalBackedUp) {
                if (newFilePersisted)
                    await fs.promises.unlink(originalPath).catch(() => {});

                await fs.promises.rename(backupPath, originalPath).catch(() => {});
            }

            await newFileManager.closeAsync().catch(() => {});
            await fs.promises.unlink(tempPath).catch(() => {});

            this.tableFileManagers.delete(tableName.toLowerCase());

            throw error;
        }
    }

    //retrieval
    async getTable(tableName: string): Promise<StoredTuple[]> {
        const tableMetadata = this.catalogManager.getTable(tableName);
        if (!tableMetadata) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }
        const fileManager = await this.getFileManager(tableName);
        const tuples: StoredTuple[] = [];
        const columnTypes = this.tableMetadataToColumnTypes(tableMetadata);
        for(let pageId = 1; pageId < fileManager.getPageCount(); pageId++) {
            const pageBuffer = await fileManager.readPageAsync(pageId);
            const page = Page.fromBuffer(pageBuffer);
            for(let slotIndex = 0; slotIndex < page.totalSlots(); slotIndex++) {
                const tupleBuffer = page.getTuple(slotIndex);
                if(tupleBuffer) {
                    const tuple = TupleSerializerService.deserializeTuple(tupleBuffer, columnTypes);
                    tuples.push({
                        id: {
                            fileName: `${tableName}.data`,
                            pageId: pageId,
                            slotIndex: slotIndex
                        },
                        data: tuple.map(t => t.value)
                    });
                }
            }
        }
        return tuples;
    }

    async *scanTable(tableName: string): AsyncGenerator<StoredTuple> {
        const tableMetadata = this.catalogManager.getTable(tableName);
        if (!tableMetadata) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }
        const fileManager = await this.getFileManager(tableName);
        const columnTypes = this.tableMetadataToColumnTypes(tableMetadata);
        for(let pageId = 1; pageId < fileManager.getPageCount(); pageId++) {
            const pageBuffer = await fileManager.readPageAsync(pageId);
            const page = Page.fromBuffer(pageBuffer);
            for(let slotIndex = 0; slotIndex < page.totalSlots(); slotIndex++) {
                const tupleBuffer = page.getTuple(slotIndex);
                if(tupleBuffer) {
                    const tuple = TupleSerializerService.deserializeTuple(tupleBuffer, columnTypes);
                    yield {
                        id: {
                            fileName: `${tableName}.data`,
                            pageId: pageId,
                            slotIndex: slotIndex
                        },
                        data: tuple.map(t => t.value)
                    };
                }
            }
        }
    }

    async getTupleCount(tableName: string): Promise<number> {
        const tableMetadata = this.catalogManager.getTable(tableName);
        if (!tableMetadata) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }
        const fileManager = await this.getFileManager(tableName);
        let count = 0;
        for(let pageId = 1; pageId < fileManager.getPageCount(); pageId++) {
            const pageBuffer = await fileManager.readPageAsync(pageId);
            const page = Page.fromBuffer(pageBuffer);
            count += page.tupleCount();
        }
        return count;
    }

    async selectTuple(tupleId: TupleId): Promise<StoredTuple | null> {
        const tableName = path.parse(tupleId.fileName).name;
        const tableMetadata = this.catalogManager.getTable(tableName);
        if (!tableMetadata) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }
        const fileManager = await this.getFileManager(tableName);
        const pageBuffer = await fileManager.readPageAsync(tupleId.pageId);
        const page = Page.fromBuffer(pageBuffer);
        const tupleBuffer = page.getTuple(tupleId.slotIndex);
        if (!tupleBuffer) {
            return null;
        }
        const columnTypes = this.tableMetadataToColumnTypes(tableMetadata);
        const tuple = TupleSerializerService.deserializeTuple(tupleBuffer, columnTypes);
        return {
            id: tupleId,
            data: tuple.map(t => t.value)
        };

    }

    async isEmptyTable(tableName: string): Promise<boolean> {
        const tableMetadata = this.catalogManager.getTable(tableName);
        if (!tableMetadata) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }

        const fileManager = await this.getFileManager(tableName);
        for(let pageId = 1; pageId < fileManager.getPageCount(); pageId++) {
            const pageBuffer = await fileManager.readPageAsync(pageId);
            const page = Page.fromBuffer(pageBuffer);
            if (page.tupleCount() > 0) {
                return false;
            }
        }
        return true;
        
    }

    //dml (insert, update, delete)
    async insertTuples(tableName: string, rows: CellValue[][]): Promise<StoredTuple[]> {
        if (!rows.length) return [];

        const fileManager = await this.getFileManager(tableName);
        const tableMetadata = this.catalogManager.getTable(tableName);
        if (!tableMetadata) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }
        let nextSerialValue = fileManager.getNextSerialValue();


        const updatedRows = rows.map(row =>
            row.map((value, index) => {
                const column = tableMetadata.columns[index];

                if (column.dataType !== "SERIAL") {
                    if (this.isGeneratedValue(value)) {
                        this.throwError("Generated values are only supported for SERIAL columns.");
                    }

                    return value as ValueTypes;
                }

                if (this.isGeneratedValue(value)) {
                    if (nextSerialValue > 2147483647) {
                        this.throwError("SERIAL sequence has reached its maximum value.");
                    }

                    return nextSerialValue++;
                }

                // Explicitly provided SERIAL value
                if (typeof value !== "number") {
                    this.throwError("SERIAL value must be a valid positive integer.");
                }

                if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
                    this.throwError("SERIAL value must be a valid positive integer.");
                }

                // Advance the sequence if necessary
                if (value >= nextSerialValue) {
                    nextSerialValue = value + 1;
                }

                return value as number;
            })
        );

        await fileManager.setNextSerialValue(nextSerialValue);

        const encodedTuples = updatedRows.map(row => {
            const tupleObj = this.valuesToTuple(tableMetadata.columns, row);
            return TupleSerializerService.serializeTuple(tupleObj);
        });

        const pages = new Map<number, Page>();
        const dirtyPageIds = new Set<number>();
        const insertedIds: TupleId[] = [];

        let activePageId = fileManager.getPageCount() - 1;

        if (activePageId === 0) {
            let page = new Page();
            activePageId = await fileManager.allocatePage(page.toBuffer());
            page.updatePageId(activePageId);
            pages.set(activePageId, page);
        }

        for (const tuple of encodedTuples) {
            if (tuple.length > MAX_TUPLE_SIZE) {
                throw new TupleTooLargeError("Tuple is too large to fit into a page.");
            }

            let page = pages.get(activePageId);

            if (!page) {
                page = Page.fromBuffer(await fileManager.readPageAsync(activePageId));
                pages.set(activePageId, page);
            }

            let slotIndex = page.insert(tuple);

            if (slotIndex === null) {
                page = new Page();
                slotIndex = page.insert(tuple);
                if (slotIndex === null) this.throwError("Unexpected error: tuple could not be inserted into a new page.");

                activePageId = await fileManager.allocatePage(page.toBuffer());
                page.updatePageId(activePageId);
                pages.set(activePageId, page);

            }

            dirtyPageIds.add(activePageId);
            insertedIds.push({ fileName: `${tableName}.data`, pageId: activePageId, slotIndex });
        }

        for (const pageId of dirtyPageIds) {
            await fileManager.writePageAsync(pageId, pages.get(pageId)!.toBuffer());
        }

        return insertedIds.map((id, index) => ({
            id,
            data: updatedRows[index]
        }));
    }

    async deleteTuples(tableName: string, tupleIds: TupleId[]): Promise<void> {
        if (!tupleIds.length) return;

        const fileManager = await this.getFileManager(tableName);
        const pages = new Map<number, Page>();
        const dirtyPageIds = new Set<number>();

        for (const tupleId of tupleIds) {
            if (path.parse(tupleId.fileName).name !== tableName) {
                this.throwError(`Tuple does not belong to table "${tableName}".`);
            }

            let page = pages.get(tupleId.pageId);
            if (!page) {
                const pageBuffer = await fileManager.readPageAsync(tupleId.pageId);
                page = Page.fromBuffer(pageBuffer);
                pages.set(tupleId.pageId, page);
            }
            page.deleteTuple(tupleId.slotIndex);
            dirtyPageIds.add(tupleId.pageId);
        }

        for (const pageId of dirtyPageIds) {
            await fileManager.writePageAsync(pageId, pages.get(pageId)!.toBuffer());
        }
    }
    
    async updateTuples(tableName: string, updates: { tupleId: TupleId; newValues: ValueTypes[] }[]): Promise<StoredTuple[]> {
        if (!updates.length) return [];

        const fileManager = await this.getFileManager(tableName);
        const pages = new Map<number, Page>();
        const dirtyPageIds = new Set<number>();

        const updatedTuples: StoredTuple[] = [];
        const tableMetadata = this.catalogManager.getTable(tableName);

        for (const update of updates) {
            const { tupleId, newValues } = update;

            if (path.parse(tupleId.fileName).name !== tableName) {
                this.throwError(`Tuple does not belong to table "${tableName}".`);
            }

            let page = pages.get(tupleId.pageId);
            if (!page) {
                const pageBuffer = await fileManager.readPageAsync(tupleId.pageId);
                page = Page.fromBuffer(pageBuffer);
                pages.set(tupleId.pageId, page);
            }

            if (!tableMetadata) {
                this.throwError(`Table '${tableName}' does not exist.`);
            }
            const newTupleObj = this.valuesToTuple(tableMetadata.columns, newValues);
            const newTupleEncoded = TupleSerializerService.serializeTuple(newTupleObj);

            const updatedSlotIndex = page.updateTuple(tupleId.slotIndex, newTupleEncoded);
            if(updatedSlotIndex !== null) {
                dirtyPageIds.add(tupleId.pageId);
                updatedTuples.push({
                    id: {...tupleId, slotIndex: updatedSlotIndex},
                    data: newValues
                });
            } else {
                //loop on cached pages to find a page with enough space to insert the new tuple
                let inserted = false;
                for (const [pageId, cachedPage] of pages) {
                    const slotIndex = cachedPage.insert(newTupleEncoded);
                    if (slotIndex !== null) {
                        dirtyPageIds.add(pageId);
                        updatedTuples.push({
                            id: { fileName: `${tableName}.data`, pageId, slotIndex },
                            data: newValues
                        });
                        inserted = true;                        
                        break;
                    }
                }
                if (!inserted) {
                    //if no cached page has enough space, allocate a new page
                    const newPage = new Page();
                    const slotIndex = newPage.insert(newTupleEncoded);
                    if (slotIndex === null) {
                        this.throwError("Tuple is too large to fit into a new page.");
                    }
                    const newPageId = await fileManager.allocatePage(newPage.toBuffer());
                    newPage.updatePageId(newPageId);
                    pages.set(newPageId, newPage);
                    dirtyPageIds.add(newPageId);
                    updatedTuples.push({
                        id: { fileName: `${tableName}.data`, pageId: newPageId, slotIndex },
                        data: newValues
                    });
                }

                //delete the old tuple from its original page
                page.deleteTuple(tupleId.slotIndex);
                dirtyPageIds.add(tupleId.pageId);
            }
        }

        for (const pageId of dirtyPageIds) {
            await fileManager.writePageAsync(pageId, pages.get(pageId)!.toBuffer());
        }

        return updatedTuples;
    }

    async setNextSerialValue(tableName: string, value: number): Promise<void> {
        const fileManager = await this.getFileManager(tableName);
        await fileManager.setNextSerialValue(value);
    }

    //helpers
    private async closeAllFileManagers(): Promise<void> {
        for (const fileManager of this.tableFileManagers.values()) {
            await fileManager.closeAsync();
        }
        this.tableFileManagers.clear();
    }

    private async getFileManager(tableName: string): Promise<FileManagerService> {
        let fileManager = this.tableFileManagers.get(tableName);

        if (!fileManager) {
            fileManager = await FileManagerService.open(`${tableName}.data`);
            this.tableFileManagers.set(tableName, fileManager);
        }

        return fileManager;
    }

    private valuesToTuple(schema: ColumnMetadata[], values: ValueTypes[]): Tuple {
        if (values.length !== schema.length) {
            this.throwError(`Column count mismatch: expected ${schema.length}, got ${values.length}.`);
        }

        return values.map((value, index) => ({
            type: {
                name: schema[index].name,
                dataType: schema[index].dataType,
                length: schema[index].length
            },
            value
        }));
    }

    private tableMetadataToColumnTypes(tableMetadata: TableMetadata): TupleColumnDataType[]{
        return tableMetadata.columns.map((column: ColumnMetadata) => ({
            name: column.name,
            dataType: column.dataType,
            length: column.length
        }));
    }

    private isGeneratedValue(value: CellValue): boolean {
        return value !== null && typeof value === "object" && "type" in value && value.type === "GENERATED";
    }

    private throwError(message: string): never {
        throw new StorageError(message);
    }
}