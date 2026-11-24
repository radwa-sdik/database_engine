import { ColumnDataType } from "../../../common/types/common.types";
import { ColumnMetadata, DatabaseMetadata, ForeignKeyMetadata, TableMetadata } from "./catalog.types";

export class CatalogSerializer {
        static serializeCatalog(catalog: DatabaseMetadata): Buffer {
        const buffers: Buffer[] = [];
        // Serialize the database name
        const nameBuffer = Buffer.alloc(4 + Buffer.byteLength(catalog.name, "utf-8"));
        nameBuffer.writeUInt32BE(Buffer.byteLength(catalog.name, "utf-8"), 0);
        nameBuffer.write(catalog.name, 4, "utf-8");
        buffers.push(nameBuffer);

        // Serialize the number of tables
        const tableCountBuffer = Buffer.alloc(4);
        tableCountBuffer.writeUInt32BE(catalog.tables.size, 0);
        buffers.push(tableCountBuffer);

        // Serialize each table
        for (const table of catalog.tables.values()) {
            const tableBuffer = CatalogSerializer.serializeTable(table);
            buffers.push(tableBuffer);
        }

        return Buffer.concat(buffers);
    }

    static deserializeCatalog(buffer: Buffer): DatabaseMetadata {
        let offset = 0;
        // Deserialize the database name
        const nameLength = buffer.readUInt32BE(offset);
        offset += 4;
        const name = buffer.toString("utf-8", offset, offset + nameLength);
        offset += nameLength;
        // Deserialize the number of tables
        const tableCount = buffer.readUInt32BE(offset);
        offset += 4;
        const tables = new Map<string, TableMetadata>();
        // Deserialize each table
        for (let i = 0; i < tableCount; i++) {
            const table = CatalogSerializer.deserializeTable(buffer, offset);
            tables.set(table.tableMetadata.name, table.tableMetadata);
            offset = table.newOffset;
        }
        return { name, tables };
    }

    private static deserializeTable(buffer: Buffer, offset: number): { tableMetadata: TableMetadata; newOffset: number } {
        // Deserialize the table name
        const nameLength = buffer.readUInt32BE(offset);
        offset += 4;
        const name = buffer.toString("utf-8", offset, offset + nameLength);
        offset += nameLength;
        // Deserialize the number of columns
        const columnCount = buffer.readUInt32BE(offset);
        offset += 4;
        const columns: ColumnMetadata[] = [];
        // Deserialize each column
        for (let i = 0; i < columnCount; i++) {
            const column = CatalogSerializer.deserializeColumn(buffer, offset);
            columns.push(column.columnMetadata);
            offset = column.newOffset;
        }
        // Deserialize primary key if exists
        const primaryKeyLength = buffer.readUInt32BE(offset);
        offset += 4;
        let primaryKey: string | undefined;
        if (primaryKeyLength > 0) {
            primaryKey = buffer.toString("utf-8", offset, offset + primaryKeyLength);
            offset += primaryKeyLength;
        }

        // Deserialize foreign keys if exist
        const foreignKeyCount = buffer.readUInt32BE(offset);
        offset += 4;
        const foreignKeys: ForeignKeyMetadata[] = [];
        for (let i = 0; i < foreignKeyCount; i++) {
            const foreignKey = CatalogSerializer.deserializeForeignKey(buffer, offset);
            foreignKeys.push(foreignKey.foreignKeyMetadata);
            offset = foreignKey.newOffset;
        }
        return { tableMetadata: { name, columns, primaryKey, foreignKeys }, newOffset: offset };
    }

    private static serializeTable(table: TableMetadata): Buffer {
        const buffers: Buffer[] = [];
        // Serialize the table name
        const nameBuffer = Buffer.alloc(4 + Buffer.byteLength(table.name, "utf-8"));
        nameBuffer.writeUInt32BE(Buffer.byteLength(table.name, "utf-8"), 0);
        nameBuffer.write(table.name, 4, "utf-8");
        buffers.push(nameBuffer);
        // Serialize the number of columns
        const columnCountBuffer = Buffer.alloc(4);
        columnCountBuffer.writeUInt32BE(table.columns.length, 0);
        buffers.push(columnCountBuffer);
        // Serialize each column
        for (const column of table.columns) {
            const columnBuffer = CatalogSerializer.serializeColumn(column);
            buffers.push(columnBuffer);
        }
        // Serialize primary key if exists
        if (table.primaryKey) {
            const primaryKeyBuffer = Buffer.alloc(4 + Buffer.byteLength(table.primaryKey, "utf-8"));
            primaryKeyBuffer.writeUInt32BE(Buffer.byteLength(table.primaryKey, "utf-8"), 0);
            primaryKeyBuffer.write(table.primaryKey, 4, "utf-8");
            buffers.push(primaryKeyBuffer);
        } else {
            const noPrimaryKeyBuffer = Buffer.alloc(4);
            noPrimaryKeyBuffer.writeUInt32BE(0, 0); // Indicate no primary key
            buffers.push(noPrimaryKeyBuffer);
        }

        // Serialize foreign keys if exist
        if (table.foreignKeys && table.foreignKeys.length > 0) {
            const foreignKeyCountBuffer = Buffer.alloc(4);
            foreignKeyCountBuffer.writeUInt32BE(table.foreignKeys.length, 0);
            buffers.push(foreignKeyCountBuffer);
            for (const foreignKey of table.foreignKeys) {
                const foreignKeyBuffer = CatalogSerializer.serializeForeignKey(foreignKey);
                buffers.push(foreignKeyBuffer);
            }
        } else {
            const noForeignKeyBuffer = Buffer.alloc(4);
            noForeignKeyBuffer.writeUInt32BE(0, 0); // Indicate no foreign keys
            buffers.push(noForeignKeyBuffer);
        }

        return Buffer.concat(buffers);
    }

    private static serializeColumn(column: ColumnMetadata): Buffer {
        const buffers: Buffer[] = [];
        // serialize name
        const nameBuffer = Buffer.alloc(4 + Buffer.byteLength(column.name, "utf-8"));
        nameBuffer.writeUInt32BE(Buffer.byteLength(column.name, "utf-8"), 0);
        nameBuffer.write(column.name, 4, "utf-8");
        buffers.push(nameBuffer);
        // serialize type
        const typeBuffer = Buffer.alloc(4 + Buffer.byteLength(column.dataType, "utf-8"));
        typeBuffer.writeUInt32BE(Buffer.byteLength(column.dataType, "utf-8"), 0);
        typeBuffer.write(column.dataType, 4, "utf-8");
        buffers.push(typeBuffer);

        // serialize length if exists
        if (column.length !== undefined) {
            const lengthBuffer = Buffer.alloc(4);
            lengthBuffer.writeUInt32BE(column.length, 0);
            buffers.push(lengthBuffer);
        } else {
            const noLengthBuffer = Buffer.alloc(4);
            noLengthBuffer.writeUInt32BE(0, 0);
            buffers.push(noLengthBuffer);
        }

        // serialize isNullable
        const isNullableBuffer = Buffer.alloc(1);
        isNullableBuffer.writeUInt8(column.isNullable ? 1 : 0, 0);
        buffers.push(isNullableBuffer);
        // serialize isUnique
        const isUniqueBuffer = Buffer.alloc(1);
        isUniqueBuffer.writeUInt8(column.isUnique ? 1 : 0, 0);
        buffers.push(isUniqueBuffer);
        // serialize isPrimaryKey
        const isPrimaryKeyBuffer = Buffer.alloc(1);
        isPrimaryKeyBuffer.writeUInt8(column.isPrimaryKey ? 1 : 0, 0);
        buffers.push(isPrimaryKeyBuffer);


        return Buffer.concat(buffers);
    }
        
    private static serializeForeignKey(key: ForeignKeyMetadata): Buffer {
        const buffers: Buffer[] = [];
        // serialize columnName
        const columnNameBuffer = Buffer.alloc(4 + Buffer.byteLength(key.columnName, "utf-8"));
        columnNameBuffer.writeUInt32BE(Buffer.byteLength(key.columnName, "utf-8"), 0);
        columnNameBuffer.write(key.columnName, 4, "utf-8");
        buffers.push(columnNameBuffer);

        // serialize referencedTable
        const referencedTableBuffer = Buffer.alloc(4 + Buffer.byteLength(key.referencedTable, "utf-8"));
        referencedTableBuffer.writeUInt32BE(Buffer.byteLength(key.referencedTable, "utf-8"), 0);
        referencedTableBuffer.write(key.referencedTable, 4, "utf-8");
        buffers.push(referencedTableBuffer);

        // serialize referencedColumn
        const referencedColumnBuffer = Buffer.alloc(4 + Buffer.byteLength(key.referencedColumn, "utf-8"));
        referencedColumnBuffer.writeUInt32BE(Buffer.byteLength(key.referencedColumn, "utf-8"), 0);
        referencedColumnBuffer.write(key.referencedColumn, 4, "utf-8");
        buffers.push(referencedColumnBuffer);

        return Buffer.concat(buffers);
    }

    private static deserializeColumn(buffer: Buffer, offset: number): { columnMetadata: ColumnMetadata; newOffset: number } {
        // Deserialize the column name
        const nameLength = buffer.readUInt32BE(offset);
        offset += 4;
        const name = buffer.toString("utf-8", offset, offset + nameLength);
        offset += nameLength;

        // Deserialize the column data type
        const typeLength = buffer.readUInt32BE(offset);
        offset += 4;
        const dataType = buffer.toString("utf-8", offset, offset + typeLength);
        offset += typeLength;

        // Deserialize the column length if it exists
        const length = buffer.readUInt32BE(offset);
        offset += 4;

        // Deserialize the column isNullable
        const isNullable = buffer.readUInt8(offset) === 1;
        offset += 1;

        // Deserialize the column isUnique
        const isUnique = buffer.readUInt8(offset) === 1;
        offset += 1;

        // Deserialize the column isPrimaryKey
        const isPrimaryKey = buffer.readUInt8(offset) === 1;
        offset += 1;

        return { columnMetadata: { name, dataType: dataType as ColumnDataType, length, isNullable, isUnique, isPrimaryKey }, newOffset: offset };
    
    }

    private static deserializeForeignKey(buffer: Buffer, offset: number): { foreignKeyMetadata: ForeignKeyMetadata; newOffset: number } {
        // Deserialize the foreign key column name
        const columnNameLength = buffer.readUInt32BE(offset);
        offset += 4;
        const columnName = buffer.toString("utf-8", offset, offset + columnNameLength);
        offset += columnNameLength;
        // Deserialize the foreign key referenced table
        const referencedTableLength = buffer.readUInt32BE(offset);
        offset += 4;
        const referencedTable = buffer.toString("utf-8", offset, offset + referencedTableLength);
        offset += referencedTableLength;
        // Deserialize the foreign key referenced column
        const referencedColumnLength = buffer.readUInt32BE(offset);
        offset += 4;
        const referencedColumn = buffer.toString("utf-8", offset, offset + referencedColumnLength);
        offset += referencedColumnLength;

        return { foreignKeyMetadata: { columnName, referencedTable, referencedColumn }, newOffset: offset };
    }
}