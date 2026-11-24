import { PageCorruptedError, PageError, PageFullError, TupleTooLargeError } from "./page.error";
import { DEFAULT_PAGE_SIZE, MAX_TUPLE_SIZE, PAGE_HEADER_SIZE, PageHeader, Slot, SLOT_SIZE } from "./page.types";

export class Page {
    private pageSize: number;
    private pageBuffer: Buffer;    

    constructor(pageSize: number = DEFAULT_PAGE_SIZE, pageId: number = 0) {
        if (pageSize < DEFAULT_PAGE_SIZE) {
            throw new PageError(`Page size must be at least ${DEFAULT_PAGE_SIZE} bytes`);
        }
        this.pageSize = pageSize;
        this.pageBuffer = Buffer.alloc(this.pageSize);
        Page.writeHeaderToBuffer({
            pageId: pageId,
            slotCount: 0,
            freeSpaceOffset: this.pageSize,
            deletedCount: 0
        }, this.pageBuffer);
    }

    static fromBuffer(buffer: Buffer): Page {
        if (buffer.length < PAGE_HEADER_SIZE) {
            throw new PageCorruptedError("Buffer is too small to be a valid page");
        }
        const header = this.readHeaderFromBuffer(buffer);
        if (header.pageId < 0) {
            throw new PageCorruptedError("Invalid page ID");
        }
        if (header.freeSpaceOffset < PAGE_HEADER_SIZE || header.freeSpaceOffset > buffer.length) {
            throw new PageCorruptedError("Invalid free space offset");
        }
        if (header.slotCount < 0 || header.slotCount > (buffer.length - PAGE_HEADER_SIZE) / SLOT_SIZE) {
            throw new PageCorruptedError("Invalid slot count");
        }
        if (header.deletedCount < 0) {
            throw new PageCorruptedError("Invalid deleted count");
        }
        const page = new Page(buffer.length);
        buffer.copy(page.pageBuffer);
        return page;
    }


    toBuffer(): Buffer {
        return Buffer.from(this.pageBuffer);
    }

    tupleCount(): number {
        return this.pageHeader.slotCount - this.pageHeader.deletedCount;
    }

    totalSlots(): number {
        return this.pageHeader.slotCount;
    }

    updatePageId(newPageId: number): void {
        if (!Number.isInteger(newPageId) || newPageId < 0) {
            throw new PageError("Page ID must be a non-negative integer");
        }
        
        this.pageHeader.pageId = newPageId;
        Page.writeHeaderToBuffer(this.pageHeader, this.pageBuffer);
    }

    insert(tupleBuffer: Buffer, reusedSlotIndex?: number) : number | null {
        let slotIndex = this.tryInsert(tupleBuffer, reusedSlotIndex);

        if (slotIndex === null && this.pageHeader.deletedCount > 0) {
            this.compact();
            slotIndex = this.tryInsert(tupleBuffer, reusedSlotIndex);
        }

        return slotIndex;
    }

    private tryInsert(tupleBuffer: Buffer, reusedSlotIndex?: number): number | null {
        const tupleSize = tupleBuffer.length;
        if(tupleSize > MAX_TUPLE_SIZE) {
            throw new TupleTooLargeError("Tuple is too large");
        }
        const slotSize = SLOT_SIZE;
        const header = Page.readHeaderFromBuffer(this.pageBuffer);

        if (reusedSlotIndex === undefined && header.slotCount >= (this.pageBuffer.length - PAGE_HEADER_SIZE) / SLOT_SIZE) {
            throw new PageFullError("Page is full");
        }
        let freeSpace = this.getFreeSpace();

        if (reusedSlotIndex !== undefined) {
            if (reusedSlotIndex < 0 || reusedSlotIndex >= header.slotCount) {
                throw new PageError("Invalid slot index for reuse");
            }

            const slotOffset = PAGE_HEADER_SIZE + reusedSlotIndex * SLOT_SIZE;
            const oldTupleSize = this.pageBuffer.readUInt32BE(slotOffset + 4);

            if (oldTupleSize !== 0) {
                this.throwError("Cannot reuse an active slot");
            }
        }

        if (freeSpace < tupleSize + (reusedSlotIndex === undefined ? slotSize : 0)) {
            return null;
        }

        header.freeSpaceOffset -= tupleSize;
        tupleBuffer.copy(this.pageBuffer, header.freeSpaceOffset);

        // Write the slot information
        const slotIndex = reusedSlotIndex ?? header.slotCount;
        const slot: Slot = {
            offset: header.freeSpaceOffset,
            tupleSize: tupleSize,
        };
        Page.writeSlotToBuffer(slotIndex, slot, this.pageBuffer);
        
        if (reusedSlotIndex === undefined) {
            header.slotCount++;
        } else {
            header.deletedCount--;
        }

        Page.writeHeaderToBuffer(header, this.pageBuffer);

        return slotIndex;
    }


    getTuple(slotIndex: number): Buffer | null {
        const header = Page.readHeaderFromBuffer(this.pageBuffer);
        if (slotIndex < 0 || slotIndex >= header.slotCount) {
            this.throwError("Invalid slot index");
        }
        const slotOffset = PAGE_HEADER_SIZE + slotIndex * SLOT_SIZE;
        const offset = this.pageBuffer.readUInt32BE(slotOffset);
        const tupleSize = this.pageBuffer.readUInt32BE(slotOffset + 4);
        if (tupleSize === 0) {
            return null; 
        }
        return Buffer.from(this.pageBuffer.slice(offset, offset + tupleSize));
    }

    deleteTuple(slotIndex: number): void {
        const header = Page.readHeaderFromBuffer(this.pageBuffer);
        if (slotIndex < 0 || slotIndex >= header.slotCount) {
            this.throwError("Invalid slot index");
        }
        const slotOffset = PAGE_HEADER_SIZE + slotIndex * SLOT_SIZE;
        const tupleSize = this.pageBuffer.readUInt32BE(slotOffset + 4);
        if (tupleSize === 0) {
            this.throwError("Tuple is already deleted");
        }
        this.pageBuffer.writeUInt32BE(0, slotOffset + 4);
        header.deletedCount += 1;
        Page.writeHeaderToBuffer(header, this.pageBuffer);
    }

    updateTuple(slotIndex: number, newTupleBuffer: Buffer): number | null {
        const header = this.pageHeader;
        if (slotIndex < 0 || slotIndex >= header.slotCount) {
            this.throwError("Invalid slot index");
        }
        const slotOffset = PAGE_HEADER_SIZE + slotIndex * SLOT_SIZE;
        const oldTupleSize = this.pageBuffer.readUInt32BE(slotOffset + 4);
        const newTupleSize = newTupleBuffer.length;
        if(newTupleSize > MAX_TUPLE_SIZE) {
            throw new TupleTooLargeError("Tuple is too large");
        }
        if (oldTupleSize === 0) {
            this.throwError("Cannot update a deleted tuple");
        }
        if (newTupleSize > oldTupleSize) {
            const additionalSpaceNeeded = newTupleSize - oldTupleSize;

            if (this.getFreeSpace() < additionalSpaceNeeded && this.pageHeader.deletedCount > 0) {
                this.compact();
            }

            if (this.getFreeSpace() < additionalSpaceNeeded) return null; // Not enough space even after compaction

            this.deleteTuple(slotIndex);
            const newSlotIndex = this.insert(newTupleBuffer, slotIndex);
            
            if (newSlotIndex === null) {
                throw new PageError("Failed to reinsert tuple after deleting the old one.");
            }

            return newSlotIndex;
        }

        //update the tuple in place
        const tupleOffset = this.pageBuffer.readUInt32BE(slotOffset);
        newTupleBuffer.copy(this.pageBuffer, tupleOffset, 0, newTupleSize);
        this.pageBuffer.writeUInt32BE(newTupleSize, slotOffset + 4);
        return slotIndex;
    }

    private getFreeSpace(): number {
        const header = this.pageHeader;
        return header.freeSpaceOffset - (header.slotCount * SLOT_SIZE + PAGE_HEADER_SIZE);
    }

    private getDeletedCount(): number {
        return this.pageHeader.deletedCount;
    }

    private compact(): void {
        const header = this.pageHeader;
        const newBuffer = Buffer.alloc(this.pageSize);
        let freeSpaceOffset = this.pageSize;

        for (let i = 0; i < header.slotCount; i++) {
            const slotOffset = PAGE_HEADER_SIZE + i * SLOT_SIZE;
            const tupleOffset = this.pageBuffer.readUInt32BE(slotOffset);
            const tupleSize = this.pageBuffer.readUInt32BE(slotOffset + 4);

            if (tupleSize === 0) continue;

            freeSpaceOffset -= tupleSize;
            this.pageBuffer.copy(newBuffer, freeSpaceOffset, tupleOffset, tupleOffset + tupleSize);

            newBuffer.writeUInt32BE(freeSpaceOffset, slotOffset);
            newBuffer.writeUInt32BE(tupleSize, slotOffset + 4);
        }

        this.pageBuffer = newBuffer;
        Page.writeHeaderToBuffer({ ...header, freeSpaceOffset }, this.pageBuffer);
    }


    private get pageHeader(): PageHeader {
        return {
            pageId: this.pageBuffer.readUInt32BE(0),
            slotCount: this.pageBuffer.readUInt32BE(4),
            freeSpaceOffset: this.pageBuffer.readUInt32BE(8),
            deletedCount: this.pageBuffer.readUInt32BE(12)
        };
    }

    private static readHeaderFromBuffer(buffer: Buffer): PageHeader {
        return {
            pageId: buffer.readUInt32BE(0),
            slotCount: buffer.readUInt32BE(4),
            freeSpaceOffset: buffer.readUInt32BE(8),
            deletedCount: buffer.readUInt32BE(12)
        };
    }

    private static writeSlotToBuffer(slotIndex: number, slot: Slot, buffer: Buffer): void {
        const slotOffset = PAGE_HEADER_SIZE + slotIndex * SLOT_SIZE;
        buffer.writeUInt32BE(slot.offset, slotOffset);
        buffer.writeUInt32BE(slot.tupleSize, slotOffset + 4);
    }

    private static writeHeaderToBuffer(header: PageHeader, buffer: Buffer): void {
        buffer.writeUInt32BE(header.pageId, 0);
        buffer.writeUInt32BE(header.slotCount, 4);
        buffer.writeUInt32BE(header.freeSpaceOffset, 8);
        buffer.writeUInt32BE(header.deletedCount, 12);
    }

    private throwError(message: string): never {
        throw new PageError(message);
    }
}