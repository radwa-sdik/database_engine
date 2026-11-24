import { Injectable } from '@nestjs/common';
import { LexerService } from '../../engine/sql/lexer/lexer.service';
import { ParserService } from '../../engine/sql/parser/parser.service';
import { QueryAnalyzerService } from '../../engine/sql/query-analyzer/query-analyzer.service';
import { ExecutorService } from '../../engine/sql/executer/executer.service';
import { AnalyzedQuery } from '../../engine/sql/query-analyzer/query-analyzer.types';
import { ValueTypes } from '../../common/types/common.types';
import { ResultMapper } from './query-result-mapper';
import { ApiResponse } from './api-response.types';

@Injectable()
export class ExecutionService {
    constructor(
        private readonly queryAnalyzer: QueryAnalyzerService,
        private readonly executor: ExecutorService,
    ) {}

    analyze(sql: string): { tokens: ReturnType<LexerService['tokenize']>; ast: ReturnType<ParserService['parse']>; plan: AnalyzedQuery } {
        const tokens = new LexerService(sql).tokenize();
        const ast = new ParserService(tokens).parse();
        return {
            tokens,
            ast,
            plan: this.queryAnalyzer.analyze(ast),
        };
    }

    async execute(sql: string): Promise< Record<string, ValueTypes>[] | ApiResponse | void> {
        const { plan } = this.analyze(sql);
        const result = await this.executor.executeQuery(plan);

        if (typeof result === "number") {
            return { success: true,message: `${result} row(s) affected.` };
        }
        
        if (this.isDDLQuery(plan)) {
            return ResultMapper.mapDDLResultToApiResponse(sql, plan);
        }
        if (!result) return;

        return ResultMapper.mapQueryResultToApiResponse(result);
    }

    private isDDLQuery(query: AnalyzedQuery): boolean {
        return [
            "CreateTable",
            "DropTable",
            "AddColumn",
            "DropColumn",
            "RenameColumn",
        ].includes(query.type);
    }
}
