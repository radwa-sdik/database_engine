
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DatabaseMetadata } from "./catalog.types";
import { CatalogSerializer } from "./catalog-serializer";
import { CATALOG_FILE_PATH } from "../../../common/types/common.types";

export class CatalogStore {
    static async loadCatalog(): Promise<DatabaseMetadata | null> {
        let fileBuffer: Buffer;

        try {
            fileBuffer = await fs.readFile(CATALOG_FILE_PATH);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
        }

        return CatalogSerializer.deserializeCatalog(fileBuffer);
    }

    static async saveCatalog(catalog: DatabaseMetadata): Promise<void> {
        const filePath = CATALOG_FILE_PATH;
        const tempPath = `${filePath}.tmp`;
        const dirPath = path.dirname(filePath);

        const catalogBuffer = CatalogSerializer.serializeCatalog(catalog);

        await fs.mkdir(dirPath, { recursive: true });

        let fileHandle: fs.FileHandle | undefined;

        try {
            fileHandle = await fs.open(tempPath, "w");
            await fileHandle.writeFile(catalogBuffer);
            await fileHandle.sync();
            await fileHandle.close();
            fileHandle = undefined;

            await fs.rename(tempPath, filePath);
        } catch (error) {
            if (fileHandle) await fileHandle.close().catch(() => {});
            await fs.unlink(tempPath).catch(() => {});
            throw error;
        }
    }

    static async isCatelogFileExist(): Promise<boolean>{
        try {
            await fs.access(CATALOG_FILE_PATH);
            return true; 
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
            throw error;
        }
    }
}
