import { ValueTypes } from "../../../common/types/common.types";
import { TableMetadata } from "../catalog/catalog.types";

export function createMockTables(): TableMetadata[] {
    return [
        {
            name: "users",
            columns: [
                { name: "id", dataType: "SERIAL", isNullable: false, isPrimaryKey: true, isUnique: true },
                { name: "name", dataType: "CHAR", length: 100, isNullable: false, isPrimaryKey: false, isUnique: false},
                { name: "age", dataType: "INTEGER", isNullable: true, isPrimaryKey: false, isUnique: false},
                { name: "email", dataType: "CHAR", length: 255, isNullable: false, isPrimaryKey: false, isUnique: true},
                { name: "active", dataType: "BOOLEAN", isNullable: true, isPrimaryKey: false, isUnique: false},
                { name: "created_at", dataType: "TIMESTAMP", isNullable: true, isPrimaryKey: false, isUnique: false},
            ],
            primaryKey: "id",
            foreignKeys: [],
        },
        {
            name: "departments",
            columns: [
                { name: "id", dataType: "SERIAL", isNullable: false, isPrimaryKey: true, isUnique: true },
                { name: "name", dataType: "CHAR", length: 100, isNullable: false, isPrimaryKey: false, isUnique: true},
            ],
            primaryKey: "id",
            foreignKeys: [],
        },
        {
            name: "employees",
            columns: [
                { name: "id", dataType: "SERIAL", isNullable: false, isPrimaryKey: true, isUnique: true },
                { name: "name", dataType: "CHAR", length: 100, isNullable: false, isPrimaryKey: false, isUnique: false},
                { name: "department_id", dataType: "INTEGER", isNullable: false, isPrimaryKey: false, isUnique: false},
                { name: "salary", dataType: "INTEGER", isNullable: true, isPrimaryKey: false, isUnique: false},
                { name: "manager_id", dataType: "INTEGER", isNullable: true, isPrimaryKey: false, isUnique: false},
            ],
            primaryKey: "id",
            foreignKeys: [
                { columnName: "department_id", referencedTable: "departments", referencedColumn: "id" },
                { columnName: "manager_id", referencedTable: "employees", referencedColumn: "id" },
            ],
        },
        {
            name: "tags",
            columns: [
                { name: "id", dataType: "INTEGER", isNullable: false, isPrimaryKey: true, isUnique: true},
                { name: "label", dataType: "CHAR", length: 3, isNullable: true, isPrimaryKey: false, isUnique: false},
            ],
            primaryKey: "id",
            foreignKeys: [],
        },
    ];
}

export function createMockTableRows(tableName: string): ValueTypes[][] {
    switch (tableName.toLowerCase()) {
        case "users":
            return [
                [1, "Alice Johnson", 28, "alice@example.com", true, "2025-01-15 09:30:00"],
                [2, "Bob Smith", 34, "bob@example.com", true, "2025-02-20 14:15:00"],
                [3, "Carol Davis", null, "carol@example.com", false, "2025-03-10 08:00:00"],
            ];
        case "departments":
            return [
                [1, "Engineering"],
                [2, "Human Resources"],
                [3, "Finance"],
            ];
        case "employees":
            return [
                [1, "Alice Johnson", 1, 95000, null],
                [2, "Bob Smith", 1, 88000, 1],
                [3, "Carol Davis", 2, 72000, null],
                [4, "David Wilson", 3, 68000, 3],
            ];
        case "tags":
            return [
                [1, "NEW"],
                [2, "HOT"],
                [3, "VIP"],
            ];
        default:
            return [];
    }
}