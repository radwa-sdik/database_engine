export class EngineError extends Error {
    constructor(message: string, public line?: number, public position?: number) {
        super(message);
        this.name = new.target.name;
    }
}

export class LexerError extends EngineError {}
export class ParserError extends EngineError {}
export class BindingError extends EngineError {}
export class ExecutionError extends EngineError {}
export class CatalogError extends EngineError {}
export class ExpressionEvaluationError extends EngineError {}
export class StorageError extends EngineError {}
export class PageError extends StorageError {}
export class TupleCodecError extends StorageError {}
export class FileManagerError extends StorageError {}