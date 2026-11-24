import { ValueTypes } from "../../common/types/common.types";
import { QueryResult } from "../../engine/sql/executer/executer.types";
import { AnalyzedQuery } from "../../engine/sql/query-analyzer/query-analyzer.types";
import { ApiResponse } from "./api-response.types";

export class ResultMapper {
    static mapQueryResultToApiResponse(queryResult: QueryResult): Record<string, ValueTypes>[] {
        const result: Record<string, ValueTypes>[] = [];
        for (const row of queryResult.rows) {
            const mappedRow: Record<string, ValueTypes> = {};

            for (let i = 0; i < queryResult.columns.length; i++) {
                const columnName = queryResult.columns[i];
                let key = columnName;
                let counter = 2;

                while (key in mappedRow) {
                    key = `${columnName}_${counter++}`;
                }

                mappedRow[key] = row[i];
            }

            result.push(mappedRow);
        }

        return result;
    }

    static mapDDLResultToApiResponse(sql: string, query: AnalyzedQuery): ApiResponse {
        let message: string | undefined;
        switch (query.type) {
            case "CreateTable":
                message = `Table ${query.table.name} created successfully.`;
                break;
            case "DropTable":
                message = `Table ${query.table.name} dropped successfully.`;
                break;
            case "AddColumn":
                message = `Column ${query.column.name} added successfully.`;
                break;
            case "DropColumn":
                message = `Column ${query.table.columns[query.columnIndex].name} dropped successfully.`;
                break;
            case "RenameColumn":
                message = `Column ${query.oldColumnName} renamed to ${query.newColumnName} successfully.`;
                break;
            default:
                message = `DDL operation executed successfully.`;
        }
        return { success: true, ddl: sql, message };
    }
}