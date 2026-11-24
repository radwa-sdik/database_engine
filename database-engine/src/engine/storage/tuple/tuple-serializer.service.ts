
import { ValueTypes } from "../../../common/types/common.types";
import { TupleCodecError } from "../../errors";
import { DateParser } from "../../helpers/date-parser";
import { Tuple, TupleColumnDataType } from "./tuple.types";

export class TupleSerializerService {
    static serializeTuple(tuple: Tuple): Buffer {
        const nullBitmapSize = Math.ceil(tuple.length / 8);
        const nullBitmap = Buffer.alloc(nullBitmapSize, 0);
        const buffers: Buffer[] = [];

        for (let i = 0; i < tuple.length; i++) {
            let { value, type } = tuple[i];

            if (value === null) {
                nullBitmap[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
                continue;
            }

            let buffer: Buffer;

            switch (type.dataType) {
                case "INTEGER":
                case "SERIAL":
                    value = Number(value);
                    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
                        this.throwError(`Invalid INTEGER value for column ${type.name}.`);

                    buffer = Buffer.alloc(4);
                    buffer.writeInt32BE(value, 0);
                    break;

                case "DOUBLE":
                    if (typeof value !== "number" || !Number.isFinite(value))
                        this.throwError(`Invalid DOUBLE value for column ${type.name}.`);

                    buffer = Buffer.alloc(8);
                    buffer.writeDoubleBE(value, 0);
                    break;

                case "CHAR": {
                    if (typeof value !== "string")
                        this.throwError(`Invalid CHAR value for column ${type.name}.`);

                    if (type.length === undefined || type.length <= 0)
                        this.throwError(`Invalid CHAR length for column ${type.name}.`);

                    const maxCharacters = type.length;
                    const maxBytes = maxCharacters * 4;
                    const characterCount = [...value].length;
                    const encoded = Buffer.from(value, "utf8");

                    if (characterCount > maxCharacters)
                        this.throwError(`Value for column ${type.name} exceeds defined length of ${maxCharacters} characters.`);

                    if (encoded.length > maxBytes)
                        this.throwError(`Value for column ${type.name} exceeds defined storage length.`);

                    buffer = Buffer.alloc(maxBytes);
                    encoded.copy(buffer);
                    break;
                }

                case "TEXT": {
                    if (typeof value !== "string")
                        this.throwError(`Invalid TEXT value for column ${type.name}.`);

                    const textBuffer = Buffer.from(value, "utf-8");
                    buffer = Buffer.alloc(4 + textBuffer.length);
                    buffer.writeUInt32BE(textBuffer.length, 0);
                    textBuffer.copy(buffer, 4);
                    break;
                }

                case "BOOLEAN":
                    if (typeof value !== "boolean")
                        this.throwError(`Invalid BOOLEAN value for column ${type.name}.`);

                    buffer = Buffer.from([value ? 1 : 0]);
                    break;

                case "TIMESTAMP":
                    if (typeof value === "string") {
                        const timestamp = DateParser.parseTimestamp(value);
                        if (timestamp === null)
                            this.throwError(`Invalid TIMESTAMP value for column ${type.name}.`);

                        value = timestamp;
                    }

                    if (typeof value !== "number" || !Number.isSafeInteger(value))
                        this.throwError(`Invalid TIMESTAMP value for column ${type.name}.`);

                    buffer = Buffer.alloc(8);
                    buffer.writeBigInt64BE(BigInt(value), 0);
                    break;

                default:
                    this.throwError(`Unsupported data type: ${type.dataType}`);
            }

            buffers.push(buffer);
        }

        return Buffer.concat([nullBitmap, ...buffers]);
    }

    static deserializeTuple(buffer: Buffer, schema: TupleColumnDataType[]): Tuple {
        const tuple: Tuple = [];
        const nullBitmapSize = Math.ceil(schema.length / 8);

        if (buffer.length < nullBitmapSize)
            this.throwError("Buffer does not contain a complete null bitmap.");

        let offset = nullBitmapSize;

        const ensureAvailable = (size: number) => {
            if (offset + size > buffer.length)
                this.throwError("Buffer does not contain enough data for the given schema.");
        };

        for (let i = 0; i < schema.length; i++) {
            const column = schema[i];
            const isNull = (buffer[Math.floor(i / 8)] & (1 << (7 - (i % 8)))) !== 0;

            if (isNull) {
                tuple.push({ type: column, value: null });
                continue;
            }

            let value: ValueTypes;

            switch (column.dataType) {
                case "INTEGER":
                case "SERIAL":
                    ensureAvailable(4);
                    value = buffer.readInt32BE(offset);
                    offset += 4;
                    break;

                case "DOUBLE":
                    ensureAvailable(8);
                    value = buffer.readDoubleBE(offset);
                    offset += 8;
                    break;

                case "CHAR": {
                    const length = column.length;
                    if (length === undefined || length <= 0)
                        this.throwError(`Invalid CHAR length for column ${column.name}.`);

                    const byteLength = length * 4;
                    ensureAvailable(byteLength);

                    value = buffer.subarray(offset, offset + byteLength).toString("utf8").replace(/\0+$/, "");
                    offset += byteLength;
                    break;
                }

                case "TEXT": {
                    ensureAvailable(4);
                    const length = buffer.readUInt32BE(offset);
                    offset += 4;
                    ensureAvailable(length);

                    value = buffer.subarray(offset, offset + length).toString("utf-8");
                    offset += length;
                    break;
                }

                case "BOOLEAN": {
                    ensureAvailable(1);
                    const boolValue = buffer.readUInt8(offset);

                    if (boolValue !== 0 && boolValue !== 1)
                        this.throwError("Invalid BOOLEAN value in tuple buffer.");

                    value = boolValue === 1;
                    offset++;
                    break;
                }

                case "TIMESTAMP":
                    ensureAvailable(8);
                    value = Number(buffer.readBigInt64BE(offset));
                    offset += 8;
                    break;

                default:
                    this.throwError(`Unsupported data type: ${column.dataType}`);
            }

            tuple.push({ type: column, value });
        }

        if (offset !== buffer.length)
            this.throwError("Tuple buffer contains unexpected trailing data.");

        return tuple;
    }

    static getTupleSize(tuple: Tuple): number {
        let size = Math.ceil(tuple.length / 8);

        for (const { value, type } of tuple) {
            if (value === null) continue;

            switch (type.dataType) {
                case "INTEGER":
                case "SERIAL":
                    size += 4;
                    break;

                case "TIMESTAMP":
                    size += 8;
                    break;

                case "DOUBLE":
                    size += 8;
                    break;

                case "CHAR":
                    size += (type.length ?? 0) * 4;
                    break;

                case "TEXT":
                    if (typeof value !== "string")
                        this.throwError(`Invalid TEXT value for column ${type.name}.`);

                    size += 4 + Buffer.byteLength(value, "utf-8");
                    break;

                case "BOOLEAN":
                    size += 1;
                    break;

                default:
                    this.throwError(`Unsupported data type: ${type.dataType}`);
            }
        }

        return size;
    }

    private static throwError(message: string): never {
        throw new TupleCodecError(message);
    }
}
