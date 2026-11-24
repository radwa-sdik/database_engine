import { PageHeader, Slot } from "../page/page.types";
import { ValueTypes } from "../../../common/types/common.types";

export interface StoredTuple {
    id: TupleId;
    data: ValueTypes[];
}

export interface TupleId{
    fileName: string;
    pageId: number;
    slotIndex: number;
}

export interface Page {
    header: PageHeader;
    data: Buffer;
    slots: Slot[];
}

export interface PageId{
    fileName: string;
    pageId: number;
}

// export interface Frame {
//     frameId: number;
//     pageId: PageId | null;
//     page: Page | null;
//     isDirty: boolean;
//     pinCount: number;
//     referenceBit: boolean;
// }

export interface FileHeader {
    fileName: string;
    pageSize: number;
    pageCount: number;
    nextSerialValue: number;
}