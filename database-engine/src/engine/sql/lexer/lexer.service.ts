import { LexerError } from "../../errors";
import { KeywordsMap } from "./keywords.map";
import { TokenType } from "./token-type.enum";
import { Token } from "./token.types";

export class LexerService {
    private text: string;
    private tokens: Token[];

    private current: number = 0;
    private line: number = 1;
    private start: number = 0;


    constructor(text:string) {
        this.text = text;
        this.tokens = [];
    }

    tokenize() {
        while (!this.isAtEnd()) {
            this.start = this.current;
            this.scanToken();
        }

        this.start = this.current
        this.addToken(TokenType.EOF, '');
        return this.tokens;
    }

    private scanToken() {
        const char = this.consumeCurrentChar();

        switch (char) {
            case ' ':
            case '\t':
            case '\r':
                // Ignore whitespace
                break;
            case '\n':
                this.line++;
                break;
            case '+':
                this.addToken(TokenType.PLUS, this.getLexeme());
                break;
            case '*':
                this.addToken(TokenType.STAR, this.getLexeme());
                break;
            case '/':
                this.addToken(TokenType.SLASH, this.getLexeme());
                break;
            case '(':
                this.addToken(TokenType.LEFT_PAREN, this.getLexeme());
                break;
            case ')':
                this.addToken(TokenType.RIGHT_PAREN, this.getLexeme());
                break;
            case ',':
                this.addToken(TokenType.COMMA, this.getLexeme());
                break;
            case ';':
                this.addToken(TokenType.SEMICOLON, this.getLexeme());
                break;
            case "=":
                this.addToken(TokenType.EQUAL, this.getLexeme());
                break;
            case '-':
                if (this.matchNextChar('-')) {
                    this.handleLineComment();
                } else {
                    this.addToken(TokenType.MINUS, this.getLexeme());
                }
                break;
            case "!":
                this.addToken(this.matchNextChar("=") ? TokenType.NOT_EQUAL : this.throwError("Unexpected character: !"), this.getLexeme());
                break;
            case "<":
                this.addToken(this.matchNextChar("=") ? TokenType.LESS_EQUAL : this.matchNextChar(">") ? TokenType.NOT_EQUAL : TokenType.LESS, this.getLexeme());
                break;
            case ">":
                this.addToken(this.matchNextChar("=") ? TokenType.GREATER_EQUAL : TokenType.GREATER, this.getLexeme());
                break;
            case '"':
                this.throwError('double quotes are not supported for string literals. Use single quotes instead.');
            case "'":
                this.handleStringLiteral();
                break;
            default:
                if (this.isDigit(char)) {
                    this.handleNumberLiteral();
                } else if (this.isAlpha(char)) {
                    this.handleIdentifier();
                } else {
                    this.throwError(`Unexpected character: ${char}`);
                }
        }
    }

    private throwError(message: string, line: number = this.line, position: number = this.start): never {
        throw new LexerError(message, line, position);
    }

    private matchNextChar(expected: string): boolean {
        if (this.isAtEnd()) return false;
        if (this.text[this.current] !== expected) return false;
        this.current++;
        return true;
    }

    private isAtEnd(): boolean {
        return this.current >= this.text.length;
    }

    private addToken(type: TokenType, value: string, lexeme: string = this.getLexeme(), line: number = this.line, position: number = this.start) {
        this.tokens.push({ type, value, lexeme, line, position });
    }

    private consumeCurrentChar(): string {
        return this.text[this.current++];
    }

    private getCurrentChar(): string {
        if (this.isAtEnd()) return '\0';
        return this.text[this.current];
    }

    private getNextChar(): string {
        return this.current + 1 >= this.text.length ? "\0" : this.text[this.current + 1];
    }

    private handleStringLiteral() {
        let value = "";

        const startPosition = this.start;
        const startLine = this.line;

        while (!this.isAtEnd()) {
            const c = this.getCurrentChar();

            if (c === "'") {
                // Check for escaped single quotes ('' → ')
                if (this.getNextChar() === "'") {
                    value += "'";
                    this.consumeCurrentChar();
                    this.consumeCurrentChar();
                    continue;
                }

                // Single quote → end of string
                this.consumeCurrentChar();
                this.addToken(TokenType.STRING, value, this.getLexeme(), startLine);
                return;
            }

            if (c === "\n") this.line++;

            value += c;
            this.consumeCurrentChar();
        }

        this.throwError("Unterminated string literal", startLine, startPosition);
    }

    private handleNumberLiteral() {
        while (this.isDigit(this.getCurrentChar())) 
            this.consumeCurrentChar(); 

        if (this.getCurrentChar() === '.' && this.isDigit(this.getNextChar())) {
            this.consumeCurrentChar();
            while (this.isDigit(this.getCurrentChar()))
                this.consumeCurrentChar();
        }

        if (this.isAlpha(this.getCurrentChar())) {
            this.throwError("Invalid number format");
        }

        this.addToken(TokenType.NUMBER, this.getLexeme());
    }

    private handleIdentifier() {
        while (this.isAlphaNumeric(this.getCurrentChar())) {
            this.consumeCurrentChar();
        }

        const lexeme = this.getLexeme();
        const value = lexeme.toLowerCase();

        if (value.length > 63) {
            this.throwError('Identifier too long');
        }

        const type = KeywordsMap.get(value) ?? TokenType.IDENTIFIER;

        this.addToken(type, value, lexeme);
    }

    private handleLineComment() {
        while (this.getCurrentChar() !== '\n' && !this.isAtEnd()) {
            this.consumeCurrentChar();
        }
    }

    private isAlpha(char: string): boolean {
        return /[a-zA-Z_]/.test(char);
    }
    private isDigit(char: string): boolean {
        return /\d/.test(char);
    }
    private isAlphaNumeric(char: string): boolean {
        return this.isAlpha(char) || this.isDigit(char);
    }
    
    private getLexeme(): string {
        return this.text.slice(this.start, this.current);
    }

}

