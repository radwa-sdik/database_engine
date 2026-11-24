import { Injectable } from "@nestjs/common";
import { ValueTypes } from "../../../common/types/common.types";
import { ExecutionError } from "../../errors";
import { ExpressionEvaluator } from "../../helpers/expression-evalutor";
import { CatalogService } from "../../storage/catalog/catalog.service";
import { StoredTuple } from "../../storage/file/file.types";
import { StorageManagerService } from "../../storage/storage-manager.service";
import { Expr } from "../parser/expression.types";
import { AnalyzedSelect, OrderBy, ProjectedColumn } from "../query-analyzer/query-analyzer.types";
import { QueryResult } from "./executer.types";

@Injectable()
export class SelectExecutor {
    constructor(private catalogService: CatalogService, private storageManager: StorageManagerService) {}

    async executeSelectQuery(query: AnalyzedSelect): Promise<QueryResult> {
        const tableName = query.table.name;
        const tableMetadata = this.catalogService.getTable(tableName);
        if (!tableMetadata) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }
        const rows: ValueTypes[][] = [];
        
        let source: AsyncGenerator<StoredTuple> = this.executeTableScan(tableName);

        if (query.where) {
            source = this.executeFilterQueryGenerator(source, query.where);
        }
        if (query.orderBy?.length) {
            source = this.executeSortedQueryGenerator(source, query.orderBy);
        }
        if (query.limit !== undefined) {
            source = this.executeLimitQueryGenerator(source, query.limit);
        }
        
        for await (const row of this.executeProjectingQueryGenerator(source, query.projectedColumns)) {
            rows.push(row);
        }

        const columnNames = query.projectedColumns.map(col => col.name);
        return { columns: columnNames, rows };
    }

    async *executeProjectingQueryGenerator(source: AsyncGenerator<StoredTuple>, items: ProjectedColumn[]): AsyncGenerator<ValueTypes[]> {
        for await (const row of source) {
            const projectedRow: ValueTypes[] = [];

            for (const column of items) {
                const value = ExpressionEvaluator.evaluate(column.expression, row.data);
                if(column.type === "TIMESTAMP" && typeof value === "number")
                    projectedRow.push(new Date(value).toISOString());
                else
                    projectedRow.push(value);
            }

            yield projectedRow;
        }
    }

    async *executeLimitQueryGenerator(source: AsyncGenerator<StoredTuple>, limit: number): AsyncGenerator<StoredTuple> {
        if (limit <= 0) return; // If limit is 0 or negative, return immediately without yielding any rows
        let count = 0;

        for await (const row of source) {
            yield row;
            count++;
            if (count >= limit) break; 
        }
    }

    async *executeSortedQueryGenerator(source: AsyncGenerator<StoredTuple>, orderBy: OrderBy[]): AsyncGenerator<StoredTuple> {
        const rows: StoredTuple[] = [];
        for await (const row of source) {
            rows.push(row);
        }
        rows.sort((a, b) => {
            for (const order of orderBy) {
                const aValue = ExpressionEvaluator.evaluate(order.column, a.data);
                const bValue = ExpressionEvaluator.evaluate(order.column, b.data);
                if (aValue === null && bValue === null) continue;
                if (aValue === null) return order.direction === "ASC" ? 1 : -1; // Nulls are considered greater than any non-null value
                if (bValue === null) return order.direction === "ASC" ? -1 : 1;
                if (aValue < bValue) {
                    return order.direction === "ASC" ? -1 : 1;
                } else if (aValue > bValue) {
                    return order.direction === "ASC" ? 1 : -1;
                }
            }
            return 0;
        });

        for (const row of rows) {
            yield row;
        }
    }

    async *executeFilterQueryGenerator(source: AsyncGenerator<StoredTuple>, condition: Expr): AsyncGenerator<StoredTuple> {
        for await (const row of source) {
            if (this.checkCondition(row.data, condition)) {
                yield row;
            }
        }
    }

    async *executeTableScan(table: string): AsyncGenerator<StoredTuple> {
        for await (const tuple of this.storageManager.scanTable(table)) {
            yield tuple;
        }
    }

    private checkCondition(row: ValueTypes[], condition: Expr): boolean {
        return ExpressionEvaluator.evaluate(condition, row) === true;
    }

    private throwError(message: string): never {
        throw new ExecutionError(message);
    }
}