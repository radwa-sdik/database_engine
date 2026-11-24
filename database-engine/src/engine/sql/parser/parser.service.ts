import { ParserError } from "../../errors";
import { TokenType } from "../lexer/token-type.enum";
import { Token } from "../lexer/token.types";
import {Statement, DropTableStatement, UpdateSetClause, UpdateStatement,OrderByClause,SelectColumn
    , SelectStatement, DeleteStatement, CreateTableStatement, AlterTableStatement, ColumnDefinition, ForeignKeyDefinition,
    InsertStatement} from "./statment.types";
import { Expr } from "./expression.types";


export class ParserService {
    tokens: Token[];
    current: number = 0;

    constructor(tokens: Token[]) {        
        this.tokens = tokens;
    }

    parse(): Statement {
        let stmt: Statement;

        if (this.match(TokenType.CREATE)) {
            stmt = this.parseCreateTable();
        } 
        else if (this.match(TokenType.ALTER)) {
            stmt = this.parseAlterTable();
        } else if (this.match(TokenType.DROP)) {
            stmt = this.parseDropTable();
        } else if (this.match(TokenType.SELECT)) {
            stmt = this.parseSelect();
        } else if (this.match(TokenType.INSERT)) {
            stmt = this.parseInsert();
        } else if (this.match(TokenType.UPDATE)) {
            stmt = this.parseUpdate();
        } else if (this.match(TokenType.DELETE)) {
            stmt = this.parseDelete();
        } else {
            this.throwError('Expected SQL statement (CREATE, DROP, SELECT, INSERT, UPDATE, DELETE).');
        }

        this.match(TokenType.SEMICOLON);

        if (!this.isAtEnd()) {
            this.throwError('Unexpected extra tokens after statement.');
        }

        return stmt;
    }

    private parseUpdate(): UpdateStatement {
        const tableToken = this.parseIdentifier();
        this.consumeType(TokenType.SET);
        // Parse the SET clause
        const setClauses: UpdateSetClause[] = [this.parseUpdateSetClause()];
        while (this.match(TokenType.COMMA)) {
            if(this.isAtEnd() || this.checkTokenType(TokenType.WHERE) || this.checkTokenType(TokenType.SEMICOLON)) {
                this.throwError('Trailing comma in SET clause.');
            }
            setClauses.push(this.parseUpdateSetClause());
        }

        const whereClause = this.match(TokenType.WHERE) ? this.parseWhereClause() : undefined;
        return { type: "Update", table: tableToken.value, set: setClauses, where: whereClause };
    }

    private parseUpdateSetClause(): UpdateSetClause {
        const columnToken = this.parseIdentifier();
        this.consumeType(TokenType.EQUAL);
        const value = this.parseExpression();
        return { type:"UpdateSet", column: columnToken.value, value };
    }

    private parseDropTable(): DropTableStatement {
        this.consumeType(TokenType.TABLE);
        const tableToken = this.parseIdentifier();
        return { type: "DropTable", table: tableToken.value };
    }

    private parseDelete(): DeleteStatement{
        this.consumeType(TokenType.FROM);   
        const tableToken = this.parseIdentifier();
        const whereClause = this.match(TokenType.WHERE) ? this.parseWhereClause() : undefined;
        return { type: "Delete", table: tableToken.value, where: whereClause };
    }

    // Parses an INSERT Statment
    private parseInsert(): InsertStatement {
        // check 'INTO' keyword
        this.consumeType(TokenType.INTO);
        // check table name
        const tableToken = this.parseIdentifier();

        // check column names
        this.consumeType(TokenType.LEFT_PAREN);
        if(this.checkTokenType(TokenType.RIGHT_PAREN)) {
            this.throwError('Expected at least one column name.');
        }
        let columnToken = this.parseIdentifier();
        const columns: string[] = [columnToken.value];
        while (this.match(TokenType.COMMA)) {
            if(this.checkTokenType(TokenType.RIGHT_PAREN)) {
                this.throwError('Trailing comma in column names.');
            }
            columnToken = this.parseIdentifier();
            columns.push(columnToken.value);
        }
        this.consumeType(TokenType.RIGHT_PAREN);

        // check rows of values
        this.consumeType(TokenType.VALUES);
        this.consumeType(TokenType.LEFT_PAREN);
        const rows: Expr[][] = [this.parseRowValues()];
        this.consumeType(TokenType.RIGHT_PAREN);

        while (this.match(TokenType.COMMA)) {
            this.consumeType(TokenType.LEFT_PAREN);
            rows.push(this.parseRowValues());
            this.consumeType(TokenType.RIGHT_PAREN);
        }

        return { type: "Insert", table: tableToken.value, columns: columns, rows: rows };
    }
    private parseRowValues(): Expr[] {
        if(this.checkTokenType(TokenType.RIGHT_PAREN)) {
            this.throwError('Expected at least one value in row.');
        }
        const values: Expr[] = [this.parseExpression()];
        while (this.match(TokenType.COMMA)) {
            if(this.checkTokenType(TokenType.RIGHT_PAREN)) {
                this.throwError('Trailing comma in row values.');
            }
            values.push(this.parseExpression());
        }
        return values;
    }

    /**
     * parses a CREATE TABLE statement.
     */

    private parseCreateTable(): CreateTableStatement {
        // check 'TABLE' keyword
        this.consumeType(TokenType.TABLE);
        const tableToken = this.parseIdentifier();
        // check for '('
        this.consumeType(TokenType.LEFT_PAREN);
        // Check if table has no columns
        if(this.checkTokenType(TokenType.RIGHT_PAREN)) {
            this.throwError('Expected at least one column definition.');
        }

        // Parse column definitions
        const columns: ColumnDefinition[] = [this.parseColumnDefinition()];
        while (this.match(TokenType.COMMA)) {
            if(this.checkTokenType(TokenType.RIGHT_PAREN)) {
                this.throwError('Trailing comma in column definitions.');
            }
            const columnDef = this.parseColumnDefinition();
            columns.push(columnDef);
        }
        this.consumeType(TokenType.RIGHT_PAREN);
        return { type: "CreateTable", table: tableToken.value, columns: columns };
    }

    private parseColumnDefinition(): ColumnDefinition {
        const nameToken = this.parseIdentifier();
        const dataTypeToken = this.consumeToken();
        const acceptedDataTypes = [TokenType.INTEGER, TokenType.DOUBLE, TokenType.SERIAL, TokenType.CHAR, TokenType.TEXT, TokenType.BOOLEAN, TokenType.TIMESTAMP];
        
        if (!acceptedDataTypes.includes(dataTypeToken.type)) {
            this.throwError('Expected data type.', dataTypeToken.line, dataTypeToken.position);
        }

        let length: number | undefined = undefined;
        if (dataTypeToken.type === TokenType.CHAR) {
            this.consumeType(TokenType.LEFT_PAREN);
            const lengthToken = this.consumeToken();
            if (lengthToken.type !== TokenType.NUMBER) {
                this.throwError('Expected length for CHAR type.', lengthToken.line, lengthToken.position);
            }
            this.consumeType(TokenType.RIGHT_PAREN);
            length = Number(lengthToken.value); 
        }

        //check for constraints like PRIMARY KEY, UNIQUE, NOT NULL, DEFAULT, REFERENCES
        let isPrimaryKey = false;
        let isUnique = false;
        let isNotNull = false;
        let references: ForeignKeyDefinition | undefined = undefined;

        while (this.match(TokenType.PRIMARY, TokenType.UNIQUE, TokenType.NOT, TokenType.REFERENCES)) {
            const constraintToken = this.tokens[this.current - 1];
            if (constraintToken.type === TokenType.PRIMARY) {
                if (isPrimaryKey) {
                    this.throwError('Duplicate PRIMARY KEY constraint.', constraintToken.line, constraintToken.position);
                }
                this.consumeType(TokenType.KEY);
                isPrimaryKey = true;
            } else if (constraintToken.type === TokenType.UNIQUE) {
                if (isUnique) {
                    this.throwError('Duplicate UNIQUE constraint.', constraintToken.line, constraintToken.position);
                }
                isUnique = true;
            } else if (constraintToken.type === TokenType.NOT) {
                if (isNotNull) {
                    this.throwError('Duplicate NOT NULL constraint.', constraintToken.line, constraintToken.position);
                }
                this.consumeType(TokenType.NULL);
                isNotNull = true;
            } else if (constraintToken.type === TokenType.REFERENCES) {
                if (references) {
                    this.throwError('Duplicate REFERENCES constraint.', constraintToken.line, constraintToken.position);
                }
                references = this.parseForeignKey();
            }
        }

        const dataType = dataTypeToken.type as "INTEGER" | "DOUBLE" | "SERIAL" | "CHAR" | "TEXT" | "BOOLEAN" | "TIMESTAMP";

        return { type: "Column", name: nameToken.value, dataType: { type: dataType, length }, isPrimaryKey, isUnique, isNotNull, references };
    }
    
    private parseForeignKey(): ForeignKeyDefinition {
        const tableToken = this.parseIdentifier();

        this.consumeType(TokenType.LEFT_PAREN);
        const columnToken = this.parseIdentifier();
        this.consumeType(TokenType.RIGHT_PAREN);
        return { referencesTable: tableToken.value, referencesColumn: columnToken.value };
    }

    private parseAlterTable(): AlterTableStatement {
        this.consumeType(TokenType.TABLE);
        const tableToken = this.parseIdentifier();
        const actionToken = this.consumeToken();
        switch (actionToken.type) {
            case TokenType.ADD:
                this.consumeType(TokenType.COLUMN);
                const columnDef = this.parseColumnDefinition();
                return { type: "AddColumn", table: tableToken.value, column: columnDef };
            case TokenType.DROP:
                this.consumeType(TokenType.COLUMN);
                const columnToken = this.parseIdentifier();
                return { type: "DropColumn", table: tableToken.value, column: columnToken.value };
            case TokenType.RENAME:
                this.consumeType(TokenType.COLUMN);
                const oldNameToken = this.parseIdentifier();
                this.consumeType(TokenType.TO);
                const newNameToken = this.parseIdentifier();
                return { type: "RenameColumn", table: tableToken.value, oldName: oldNameToken.value, newName: newNameToken.value };
            default:
                this.throwError(`Unexpected token ${actionToken.type} in ALTER TABLE statement.`, actionToken.line, actionToken.position);
        }
    }
    /**
     * Parses a SELECT statement.
     */

    private parseSelect(): SelectStatement {
        const columns: SelectColumn[] | '*' = this.parseSelectColumns();

        this.consumeType(TokenType.FROM);
        const fromToken = this.parseIdentifier();
        const whereClause = this.match(TokenType.WHERE) ? this.parseWhereClause() : undefined;
        const orderByClause = this.match(TokenType.ORDER) ? this.parseOrderByClause() : undefined;
        
        let limitClause: number | undefined = undefined;
        if(this.match(TokenType.LIMIT)) {
            if(this.currentToken.type !== TokenType.NUMBER) {
                this.throwError('Expected number after LIMIT.');
            }else{

                limitClause = Number(this.consumeToken().value);
            }
        }
        return { type: "Select", columns, from: fromToken.value, where: whereClause, orderBy: orderByClause, limit: limitClause }; 
    
    }

    private parseSelectColumns(): SelectColumn[] | '*' {
        if (this.match(TokenType.STAR)) return '*';

        const columns: SelectColumn[] = [this.parseSelectColumn()];
        while (this.match(TokenType.COMMA)) {
            columns.push(this.parseSelectColumn());
        }
        return columns;
    }

    private parseSelectColumn(): SelectColumn {
        const expr: Expr = this.parseExpression();
        let alias: string | undefined;

        if (this.match(TokenType.AS)) {
            const aliasToken = this.parseIdentifier();

            alias = aliasToken.value;
        }
        return { type: "SelectColumn", expression: expr, alias };
    }
    
    private parseWhereClause(): Expr {
        return this.parseExpression();
    }

    private parseOrderByClause(): OrderByClause[] {
        this.consumeType(TokenType.BY);
        const orderBys: OrderByClause[] = [this.parseOrderBy()];
        while (this.match(TokenType.COMMA)) {
            orderBys.push(this.parseOrderBy());
        }
        return orderBys;
    }

    private parseOrderBy(): OrderByClause {
        const expr = this.parseExpression();
        const direction = this.match(TokenType.ASC) ? 'ASC' : this.match(TokenType.DESC) ? 'DESC' : 'ASC';
        return { type: "OrderBy", column: expr, direction };
    }

    //Parses an expression
    private parseExpression(): Expr {
        return this.parseOr();
    }

    private parseOr(): Expr {
        let left = this.parseAnd();
        while (this.checkTokenType(TokenType.OR)) {
            this.consumeToken();
            const right = this.parseAnd();
            left = { type: "Logical", operator: "OR", left, right };
        }
        return left;
    }

    private parseAnd(): Expr {
        let left = this.parseNot();
        while (this.checkTokenType( TokenType.AND)) {
            this.consumeToken();
            const right = this.parseNot();
            left = { type: "Logical", operator: "AND", left, right };
        }
        return left;
    }

    private parseNot(): Expr {
        if (this.currentToken.type === TokenType.NOT) {
            this.consumeToken(); 
            const operand = this.parseNot();
            return { type: "Unary", operator: "NOT", operand };
        }
        return this.parseComparison();
    }

    private parseComparison(): Expr {
        let left = this.parseAdditive();
        const comparisonOperators = [TokenType.EQUAL, TokenType.NOT_EQUAL, TokenType.LESS, TokenType.LESS_EQUAL, TokenType.GREATER, TokenType.GREATER_EQUAL];
        
        if (this.match(TokenType.IS)) {
            const isNot = this.match(TokenType.NOT);
            this.consumeType(TokenType.NULL);

            return { type: "IsNull", isNot, operand: left };
        }
        
        if (comparisonOperators.includes(this.currentToken?.type)) {
            const operatorToken = this.consumeToken();
            const operator = operatorToken.type === TokenType.EQUAL ? '=' :
                            operatorToken.type === TokenType.NOT_EQUAL ? '!=' :
                            operatorToken.type === TokenType.LESS ? '<' :
                            operatorToken.type === TokenType.LESS_EQUAL ? '<=' :
                            operatorToken.type === TokenType.GREATER ? '>' : '>=';
            const right = this.parseAdditive();
            left = { type: "Binary", operator, left, right };
        }
        return left;
    }

    private parseAdditive(): Expr {
        let left = this.parseMultiplicative();
        while (this.checkTokenType( TokenType.PLUS) || this.checkTokenType( TokenType.MINUS)) {
            const operator = this.consumeToken().type === TokenType.PLUS ? '+' : '-';
            const right = this.parseMultiplicative();
            left = { type: "Binary", operator, left, right };
        }
        return left;
    }

    private parseMultiplicative(): Expr {
        let left = this.parseUnary();
        while (this.checkTokenType( TokenType.STAR) || this.checkTokenType( TokenType.SLASH)) {
            const operator = this.consumeToken().type === TokenType.STAR ? '*' : '/';
            const right = this.parseUnary();
            left = { type: "Binary", operator, left, right };
        }
        return left;
    }

    private parseUnary(): Expr {
        if (this.currentToken.type === TokenType.MINUS) {
            this.consumeToken();
            return { type: "Unary", operator: "-", operand: this.parseUnary() };
        }
        return this.parsePrimary();
    }

    private parsePrimary(): Expr {
        if(this.currentToken.type === TokenType.IDENTIFIER) 
            return { type: "ColumnRef", name: this.consumeToken().value };

        if(this.currentToken.type === TokenType.LEFT_PAREN) {
            this.consumeToken();
            const expr = this.parseExpression();
            
            this.consumeType(TokenType.RIGHT_PAREN);

            return expr;
        }

        return this.parseLiteral();
    }

    private parseLiteral(): Expr {
        const token = this.currentToken;

        switch (token.type) {
            case TokenType.STRING:
                return { type: "Literal", value: this.consumeToken().value };
            case TokenType.NULL:
                this.consumeToken();
                return { type: "Literal", value: null };
            case TokenType.NUMBER:
                return { type: "Literal", value: Number(this.consumeToken().value) };
            case TokenType.TRUE:
            case TokenType.FALSE:
                return { type: "Literal", value: this.consumeToken().value.toUpperCase() === "TRUE" };

            default:
                this.throwError(`Syntax error at or near '${token.lexeme}'`, token.line, token.position);
        }
    }

    /*
     * Helper Methods
     */
    private get currentToken(): Token {
        return this.tokens[this.current];
    }

    private consumeToken(): Token {
        if (this.isAtEnd()) {
            this.throwError("Unexpected end of input");
        }
        return this.tokens[this.current++];
    }

    private checkTokenType(expectedType: TokenType): boolean {
        if (this.isAtEnd()) return false;
        return this.currentToken?.type === expectedType;
    }

    private consumeType(expectedType: TokenType): boolean {
        if (!this.checkTokenType(expectedType)) {
            this.throwError(`Expected ${expectedType}, got ${this.currentToken?.type}`);
        }
        this.consumeToken();
        return true;
    }

    private match(...types: TokenType[]): boolean {
        if (types.includes(this.currentToken.type)) {
            this.consumeToken();
            return true;
        }
        return false;
    }

    private throwError(message: string, line: number = this.currentToken.line, position: number = this.currentToken.position): never {
        throw new ParserError(message, line, position);
    }

    private isAtEnd(): boolean {
        return this.currentToken.type === TokenType.EOF;
    }

    private parseIdentifier(): Token {
        const token = this.consumeToken();
        if (token.type !== TokenType.IDENTIFIER) {
            this.throwError(`Expected identifier, got ${token.type}`, token.line, token.position);
        }
        return token;
    }
}