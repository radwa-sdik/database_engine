import { Module } from '@nestjs/common';
import { SqlRequestGuard } from '../../common/guards/sql-request.guard';
import { StorageModule } from '../storage/storage.module';
import { QueryAnalyzerService } from './query-analyzer/query-analyzer.service';
import { ExecutorService } from './executer/executer.service';
import { DDLExecutor } from './executer/ddl-executer';
import { DMLExecutor } from './executer/dml-executer';
import { SelectExecutor } from './executer/select-executer';
import { ConstraintsValidator } from './executer/constraints-validator';

@Module({
    imports: [StorageModule],
    providers: [
        SqlRequestGuard,
        QueryAnalyzerService,
        ExecutorService,
        DDLExecutor,
        DMLExecutor,
        SelectExecutor,
        ConstraintsValidator,
    ],
    exports: [
        SqlRequestGuard,
        QueryAnalyzerService,
        ExecutorService,
    ],
})
export class SqlModule {}
