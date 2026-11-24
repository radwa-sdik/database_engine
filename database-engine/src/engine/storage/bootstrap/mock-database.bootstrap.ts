import { OnApplicationBootstrap, Injectable } from "@nestjs/common";
import fs from "node:fs";
import path from "node:path";

import { DATA_FILE_PATH } from "../../../common/types/common.types";
import { CatalogService } from "../catalog/catalog.service";
import { FileManagerService } from "../file/file-manager.service";
import { createMockTableRows, createMockTables } from "./mock-database";
import { StorageManagerService } from "../storage-manager.service";

@Injectable()
export class MockDatabaseBootstrap implements OnApplicationBootstrap {
    constructor(
        private readonly catalogService: CatalogService,
        private readonly storageManager: StorageManagerService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const isFreshDatabase = !this.catalogService.hasPersistedCatalog;

        if (isFreshDatabase) {
            for (const table of createMockTables()) {
                this.catalogService.addTable(table);
            }
            await this.catalogService.flushToDisk();
        }

        await fs.promises.mkdir(DATA_FILE_PATH, { recursive: true });

        for (const table of this.catalogService.getTables()) {
            const fileName = `${table.name}.data`;
            const filePath = path.join(DATA_FILE_PATH, fileName);
            const fileWasMissing = !fs.existsSync(filePath);

            if (fileWasMissing) {
                const fileManager = await FileManagerService.create(fileName);
                await fileManager.closeAsync();
            }

            if (!isFreshDatabase || !fileWasMissing) continue;

            const rows = createMockTableRows(table.name);
            if (rows.length === 0) continue;

            await this.storageManager.insertTuples(table.name, rows);

            const serialColumnIndex = table.columns.findIndex(
                (column) => column.dataType === "SERIAL",
            );
            if (serialColumnIndex >= 0) {
                const nextSerialValue = rows.reduce((maximum, row) => {
                    const value = row[serialColumnIndex];
                    return typeof value === "number"
                        ? Math.max(maximum, value + 1)
                        : maximum;
                }, 1);

                await this.storageManager.setNextSerialValue(table.name, nextSerialValue);
            }
        }
    }
}
