import { StorageError } from "../../errors";

export class PageError extends StorageError {}
export class PageNotFoundError extends PageError {}
export class PageFullError extends PageError {}
export class TupleTooLargeError extends PageError {}
export class PageCorruptedError extends PageError {}
// export class SlotNotFoundError extends PageError {}
// export class SlotCorruptedError extends PageError {}
// export class TupleNotFoundError extends PageError {}