import { TokenType } from "./token-type.enum";

export interface Token {
    type: TokenType;
    value: string;
    lexeme: string;
    line: number;
    position: number;
}