import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { SQL_ENDPOINT_KEY, SqlEndpointType } from '../decorators/sql-endpoint.decorator';

@Injectable()
export class SqlRequestGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}
    canActivate(
    context: ExecutionContext,
    ): boolean | Promise<boolean> | Observable<boolean> {
        const request = context.switchToHttp().getRequest();
        const sql = request.body?.sql;
        //remove comments and trim whitespace
        const cleanedSql = sql.replace(/--.*$/gm, '').trim();

        if (typeof cleanedSql !== 'string' || !cleanedSql.trim()) {
            throw new BadRequestException({success: false, message: 'sql statement is required'});
        }

        if (cleanedSql.length > 10_000) {
            throw new BadRequestException({success: false, message: 'statement too long'});
        }


        this.validateSingleStatement(cleanedSql);

        const statementType = this.getStatementType(cleanedSql);

        if (!statementType) {
            throw new BadRequestException({success: false, message: 'statement type not supported'});
        }

        const expectedEndpoint = this.reflector.get<SqlEndpointType>(
            SQL_ENDPOINT_KEY, context.getHandler(),
        );

        if (expectedEndpoint && statementType !== expectedEndpoint) {
            throw new BadRequestException({success: false, message: 'wrong endpoint for this statement type'});
        }

        return true;
    }

    private validateSingleStatement(sql: string): void {
        let quote: string | null = null;

        for (let i = 0; i < sql.length; i++) {
            const char = sql[i];

            if (quote) {
                if (char === quote) {
                    // SQL escaping: 'it''s' or "a""b"
                    if (sql[i + 1] === quote) {
                        i++;
                    } else {
                        quote = null;
                    }
                } else if (char === '\\') {
                    // Skip an escaped character.
                    i++;
                }

                continue;
            }

            if (char === "'" || char === '"') {
                quote = char;
                continue;
            }

            if (char === ';' && sql.slice(i + 1).trim().length > 0) {
                throw new BadRequestException({success: false, message: 'only one statement allowed per request'});
            }
        }
    }

    private getStatementType(sql: string): SqlEndpointType | null {
        const firstKeyword = sql.trim().match(/^[a-zA-Z]+/)?.[0].toUpperCase();

        const ddlStatements = ['CREATE', 'ALTER','DROP'];
        const dmlStatements = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

        if (ddlStatements.includes(firstKeyword ?? '')) return 'ddl';
        if (dmlStatements.includes(firstKeyword ?? '')) return 'dml';

        return null;
    }
}
