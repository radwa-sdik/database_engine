import { Injectable } from "@nestjs/common";
import { AnalyzedQuery } from "../query-analyzer/query-analyzer.types";
import { DDLExecutor } from "./ddl-executer";
import { DMLExecutor } from "./dml-executer";
import { SelectExecutor } from "./select-executer";
import { QueryResult } from "./executer.types";
import { ExecutionError } from "../../errors";

@Injectable()
export class ExecutorService {
    constructor(private ddlExecutor: DDLExecutor, private dmlExecutor: DMLExecutor, private selectExecutor: SelectExecutor) {}      
    
    async executeQuery(query: AnalyzedQuery): Promise<QueryResult | number | void> {
        const type = query.type;
        switch (type) {
            case "Select":
                return await this.selectExecutor.executeSelectQuery(query);
            case "Insert":
                return  await this.dmlExecutor.executeInsert(query);
            case "Update":
                return await this.dmlExecutor.executeUpdate(query);
            case "Delete":
                return await this.dmlExecutor.executeDelete(query);
            case "CreateTable":
                return  await this.ddlExecutor.executeCreateTable(query);
            case "DropTable":
                return  await this.ddlExecutor.executeDropTable(query);
            case "AddColumn":
                return  await this.ddlExecutor.executeAddColumn(query);
            case "DropColumn":
                return await this.ddlExecutor.executeDropColumn(query);
            case "RenameColumn":
                return await this.ddlExecutor.executeRenameColumn(query);  
            default:
                throw new ExecutionError(`Unsupported query type: ${type}`);
        }
    }
}
