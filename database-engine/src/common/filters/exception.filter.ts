import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { EngineError } from '../../engine/errors';

@Catch(EngineError)
export class EngineExceptionFilter implements ExceptionFilter {
    catch(exception: EngineError, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        response.status(400).json({
            success: false,
            statusCode: 400,
            error: exception.name,
            message: exception.message,
            line: exception.line,
            position: exception.position,
        });
    }
}