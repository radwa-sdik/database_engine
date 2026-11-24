import { Module } from '@nestjs/common';
import { ExecutionController } from './execution/execution.controller';
import { ExecutionService } from './execution/execution.service';
import { SqlModule } from '../engine/sql/sql.module';

@Module({
  controllers: [ExecutionController],
  providers: [ExecutionService],
  imports: [SqlModule],
})
export class ApiModule {}
