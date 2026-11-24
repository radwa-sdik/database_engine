import { Injectable } from "@nestjs/common";
import { ColumnDataType, ValueTypes } from "../../../common/types/common.types";
import { DateParser } from "../../helpers/date-parser";
import { ExpressionEvaluator } from "../../helpers/expression-evalutor";
import { CatalogService } from "../../storage/catalog/catalog.service";
import { ColumnMetadata } from "../../storage/catalog/catalog.types";
import { StorageManagerService } from "../../storage/storage-manager.service";
import { AnalyzedDelete, AnalyzedInsert, AnalyzedUpdate, ColumnAssignment } from "../query-analyzer/query-analyzer.types";
import { ConstraintsValidator } from "./constraints-validator";
import { QueryResult } from "./executer.types";
import { ExecutionError } from "../../errors";

@Injectable()
export class DMLExecutor {
    constructor(private catalogService: CatalogService, private storageManager:  StorageManagerService, private constraintsValidator: ConstraintsValidator) {}

    async executeInsert(query: AnalyzedInsert): Promise<QueryResult> {
        const tableName = query.table.name;
        const existingTuples = await this.storageManager.getTable(tableName);
        await this.constraintsValidator.validateInsert(query.table, query.values, existingTuples);
        const insertedTuples = await this.storageManager.insertTuples(tableName, query.values);
        return {
            columns: query.table.columns.map((col) => col.name),
            rows: insertedTuples.map((tuple) => this.formatResultRow(tuple.data, query.table.columns)),
        };
    }

    async executeUpdate(query: AnalyzedUpdate): Promise<QueryResult> {
        const tableName = query.table.name;
        if (!this.catalogService.tableExists(tableName)) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }
        const existingTuples = await this.storageManager.getTable(tableName);
        const columns = query.table.columns;
        const updatedTuples = [];
        for(const tuple of existingTuples) {
            const toUpdate = query.where ? ExpressionEvaluator.evaluate(query.where, tuple.data) : true;
            if(toUpdate === true) {
                const newValues = this.updateTupleValues(tuple.data, query.assignments, columns);
                updatedTuples.push({ tupleId: tuple.id, newValues: newValues });
            }
        }
        await this.constraintsValidator.validateUpdate(query.table, updatedTuples, existingTuples);
        const updatedTuplesData = await this.storageManager.updateTuples(tableName, updatedTuples);
        return {
            columns: columns.map((col) => col.name),
            rows: updatedTuplesData.map((tuple) => this.formatResultRow(tuple.data, columns)),
        };
    }

    private updateTupleValues(tuple: ValueTypes[], assignments: ColumnAssignment[], columns: ColumnMetadata[]): ValueTypes[] {
        const newValues = [...tuple];
        for(const assignment of assignments) {
            const newValue = ExpressionEvaluator.evaluate(assignment.value, tuple);
            newValues[assignment.columnIndex] = newValue;
        }
        return newValues;
    }

    private formatResultRow(row: ValueTypes[], columns: ColumnMetadata[]): ValueTypes[] {
        return row.map((value, index) => {
            if (columns[index]?.dataType === "TIMESTAMP" && typeof value === "number") {
                return new Date(value).toISOString();
            }
            return value;
        });
    }

    async executeDelete(query: AnalyzedDelete): Promise<number> {
        const tableName = query.table.name;
        if (!this.catalogService.tableExists(tableName)) {
            this.throwError(`Table '${tableName}' does not exist.`);
        }

        const tuplesToDelete = [];
        for await(const tuple of this.storageManager.scanTable(tableName)) {
            const toDelete = query.where ? ExpressionEvaluator.evaluate(query.where, tuple.data) : true;
            if(toDelete === true) {
                tuplesToDelete.push(tuple);
            }
        }
        await this.constraintsValidator.validateDelete(query.table, tuplesToDelete);
        await this.storageManager.deleteTuples(tableName, tuplesToDelete.map(t => t.id));

        return tuplesToDelete.length;
    }

    private throwError(message: string): never {
        throw new ExecutionError(message);
    }
}