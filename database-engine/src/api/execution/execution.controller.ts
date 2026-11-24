import { Body, Controller, HttpStatus, Post, UseGuards, HttpCode } from '@nestjs/common';
import { SqlEndpoint } from '../../common/decorators/sql-endpoint.decorator';
import { SqlRequestGuard } from '../../common/guards/sql-request.guard';
import { ExecutionService } from './execution.service';

@Controller('execute')
export class ExecutionController {
    constructor(private readonly executionService: ExecutionService) {}

    @Post('ddl')
    @SqlEndpoint('ddl')
    @UseGuards(SqlRequestGuard)
    @HttpCode(HttpStatus.OK)
    async executeDDL(@Body() body: { sql: string }) {
        return await this.executionService.execute(body.sql);
    }

    @Post('dml')
    @SqlEndpoint('dml')
    @UseGuards(SqlRequestGuard)
    @HttpCode(HttpStatus.OK)
    async executeDML(@Body() body: { sql: string }) {
        return await this.executionService.execute(body.sql);
    }
}
