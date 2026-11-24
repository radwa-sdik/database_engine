export interface Slot{
    offset: number;
    tupleSize: number;
}

export interface PageHeader {
    pageId: number;
    freeSpaceOffset: number;
    slotCount: number;
    deletedCount: number;
}


export const PAGE_HEADER_SIZE = 16;
export const SLOT_SIZE = 8;
export const DEFAULT_PAGE_SIZE = 4096;
export const MAX_TUPLE_SIZE = DEFAULT_PAGE_SIZE - PAGE_HEADER_SIZE - SLOT_SIZE;