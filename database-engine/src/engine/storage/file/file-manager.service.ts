import { FileHeader } from "./file.types";
import * as fs from "node:fs";
import path from "path";
import { DEFAULT_PAGE_SIZE } from "../page/page.types";
import { FileHandle } from "node:fs/promises";
import { PageError } from "../page/page.error";
import { FileManagerError } from "../../errors";
import { DATA_FILE_PATH } from "../../../common/types/common.types";

export class FileManagerService {
    private fileHandle: FileHandle | null = null;
    private fileHeader: FileHeader | null = null;

    private constructor(private fileName: string) {
    }

    static async create(fileName: string): Promise<FileManagerService> {
        const fileManager = new FileManagerService(fileName);
        await fileManager.createFileAsync();
        await fileManager.openExistingAsync();
        return fileManager;
    }

    static async open(fileName: string): Promise<FileManagerService> {
        const fileManager = new FileManagerService(fileName);
        await fileManager.openExistingAsync();
        return fileManager;
    }

    private async openExistingAsync(): Promise<void> {
        this.fileHandle = await fs.promises.open(this.getFilePath(), "r+");
        try{
            const headerBuffer = Buffer.alloc(DEFAULT_PAGE_SIZE);
            await this.fileHandle.read(headerBuffer, 0, DEFAULT_PAGE_SIZE, 0);
            this.fileHeader = this.deserializeFileHeader(headerBuffer);
        }catch (error) {
            await this.closeAsync();
            this.throwError(`Failed to read file header for '${this.fileName}': ${error}`);
        }
    }

    async closeAsync(): Promise<void> {
        if (this.fileHandle) {
            try {
                await this.fileHandle.sync();
            } catch (error) {console.error(`Failed to sync file '${this.fileName}': ${error}`);}
            finally {
                await this.fileHandle.close();
                this.fileHandle = null;
                this.fileHeader = null;
            }
        }
    }

    async syncAsync(): Promise<void> {
        if (this.fileHandle) {
            try {
                await this.fileHandle.sync();
            } catch (error) {
                this.throwError(`Failed to sync file '${this.fileName}': ${error}`);
            }
        } else {
            this.throwError("File not initialized. Call initialize() first.");
        }
    }

    async deleteAsync(): Promise<void> {
        const filePath = this.getFilePath();
        await this.closeAsync();
        await fs.promises.unlink(filePath);
    }

    getHeader(): FileHeader {
        this.ensureFileInitialized();
        return { ...this.fileHeader! };
    }

    async writePageAsync(pageId: number, pageBuffer: Buffer): Promise<void> {
        this.ensureFileInitialized();
        const header = this.fileHeader!;
        if (pageId <= 0 || pageId >= header.pageCount) {
            this.throwError(`Page ID ${pageId} is invalid or out of bounds for writing. Valid data pages: 1 to ${header.pageCount - 1}`);
        }
        if(pageBuffer.length !== header.pageSize){
            this.throwError(`Invalid buffer size: expected ${header.pageSize} bytes, got ${pageBuffer.length} bytes.`);
        }

        const pageSize = header.pageSize;
        const pageOffset =  pageId * pageSize;
        await this.fileHandle!.write(pageBuffer,0,pageBuffer.length,pageOffset);
    }

    async readPageAsync(pageId: number): Promise<Buffer> {
        this.ensureFileInitialized();
        const header = this.fileHeader!;
        if (pageId < 0 || pageId >= header.pageCount) {
            this.throwError(`Page ID ${pageId} is out of bounds. Total pages: ${header.pageCount}`);
        }

        const pageSize = header.pageSize;
        const pageOffset = pageId * pageSize;
        const buffer = Buffer.alloc(pageSize);
        await this.fileHandle!.read(buffer, 0, pageSize, pageOffset);
        return buffer;
    }

    async allocatePage(pageBuffer: Buffer): Promise<number> {
        this.ensureFileInitialized();
        const header = this.fileHeader!;
        const newPageId = header.pageCount;
        const pageOffset = newPageId * header.pageSize;

        if(pageBuffer.length !== header.pageSize){
            throw new PageError(`Invalid buffer size: expected ${header.pageSize} bytes, got ${pageBuffer.length} bytes.`);
        }

        await this.fileHandle!.write(pageBuffer, 0, pageBuffer.length, pageOffset);

        const updatedHeader: FileHeader = {
            ...header,
            pageCount: header.pageCount + 1
        };
        const headerBuffer = this.serializeFileHeader(updatedHeader);
        await this.fileHandle!.write(headerBuffer, 0, headerBuffer.length, 0);
        this.fileHeader = updatedHeader;

        return newPageId;
    }

    getPageCount(): number {
        this.ensureFileInitialized();
        return this.fileHeader!.pageCount;
    }

    getNextSerialValue(): number {
        this.ensureFileInitialized();
        return this.fileHeader!.nextSerialValue;
    }

    async incrementNextSerialValue(): Promise<void> {
        this.ensureFileInitialized();
        const header = this.fileHeader!;
        const updatedHeader: FileHeader = {
            ...header,
            nextSerialValue: header.nextSerialValue + 1
        };
        const headerBuffer = this.serializeFileHeader(updatedHeader);
        await this.fileHandle!.write(headerBuffer, 0, headerBuffer.length, 0);
        this.fileHeader = updatedHeader;
    }

    async setNextSerialValue(newValue: number): Promise<void> {
        this.ensureFileInitialized();
        if(newValue < this.fileHeader!.nextSerialValue) {
            this.throwError(`New serial value ${newValue} must be greater than or equal to the current value ${this.fileHeader!.nextSerialValue}.`);
        }
        const header = this.fileHeader!;
        const updatedHeader: FileHeader = {
            ...header,
            nextSerialValue: newValue
        };
        const headerBuffer = this.serializeFileHeader(updatedHeader);
        await this.fileHandle!.write(headerBuffer, 0, headerBuffer.length, 0);
        this.fileHeader = updatedHeader;
    }

    deleteFile(): void {
        const filePath = this.getFilePath();
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }else {
            this.throwError(`File '${filePath}' does not exist.`);
        }
    }


    private ensureFileInitialized(): void {
        if (!this.fileHandle) {
            this.throwError("File not initialized. Call initialize() first.");
        }
    }

    private getFilePath(): string {
        return path.join(DATA_FILE_PATH, this.fileName);
    }

    private async createFileAsync(): Promise<void> {
        const filePath = this.getFilePath();
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });

        const fileHandle = await fs.promises.open(filePath, "wx+");
        try {
            const buffer = this.serializeFileHeader({
                fileName: this.fileName,
                pageSize: DEFAULT_PAGE_SIZE,
                pageCount: 1,
                nextSerialValue:1
            });
            await fileHandle.write(buffer, 0, buffer.length, 0);
        } finally {
            await fileHandle.close();
        }
    }

    private serializeFileHeader(header: FileHeader): Buffer {
        const buffer = Buffer.alloc(DEFAULT_PAGE_SIZE);
        buffer.write(header.fileName, 0, 256, "utf-8");
        buffer.writeUInt32LE(header.pageSize, 256);
        buffer.writeUInt32LE(header.pageCount, 260);
        buffer.writeUInt32LE(header.nextSerialValue ?? 0, 264);
        return buffer;
    }

    private deserializeFileHeader(buffer: Buffer): FileHeader {
        const fileName = buffer.toString("utf-8", 0, 256).replace(/\0/g, "");
        const pageSize = buffer.readUInt32LE(256);
        const pageCount = buffer.readUInt32LE(260);
        const nextSerialValue = buffer.readUInt32LE(264);
        return { 
            fileName,
            pageSize,
            pageCount,
            nextSerialValue
        };
    }

    private throwError(message: string): never {
        throw new FileManagerError(message);
    }
}