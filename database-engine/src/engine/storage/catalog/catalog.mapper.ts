import { AddColumnStatement, ColumnDefinition, CreateTableStatement, ForeignKeyDefinition } from "../../sql/parser/statment.types";
import { ColumnMetadata, ForeignKeyMetadata, TableMetadata } from "./catalog.types";

export class CatalogMapper {
    static fromCreateTable(statement: CreateTableStatement): TableMetadata {
        return {
            name: statement.table,
            columns: statement.columns.map(CatalogMapper.fromColumnDefinition),
            primaryKey: statement.columns.find((c) => c.isPrimaryKey)?.name.toLowerCase(),
            foreignKeys: statement.columns
                .filter((c) => c.references)
                .map((c) => ({
                    columnName: c.name.toLowerCase(),
                    referencedTable: c.references!.referencesTable.toLowerCase(),
                    referencedColumn: c.references!.referencesColumn.toLowerCase()
                }))
        };
    }

    static fromAddColumn(statement: AddColumnStatement): ColumnMetadata {
        return CatalogMapper.fromColumnDefinition(statement.column);
    }

    static fromColumnDefinition(column: ColumnDefinition): ColumnMetadata {
        return {
            name: column.name.toLowerCase(),
            dataType: column.dataType.type,
            length: column.dataType.length,
            isNullable: !column.isNotNull && !column.isPrimaryKey && column.dataType.type !== "SERIAL",
            isPrimaryKey: column.isPrimaryKey,
            isUnique: column.isUnique || column.isPrimaryKey
        };
    }

    static fromForeignKeyDefinition(columnName: string, foreignKey: ForeignKeyDefinition): ForeignKeyMetadata {
        return {
            columnName: columnName.toLowerCase(),
            referencedTable: foreignKey.referencesTable.toLowerCase(),
            referencedColumn: foreignKey.referencesColumn.toLowerCase()
        };
    }
}