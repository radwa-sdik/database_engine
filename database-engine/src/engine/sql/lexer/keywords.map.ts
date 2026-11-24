import { TokenType } from "./token-type.enum";

export const KeywordsMap: Map<string, TokenType> = new Map<string, TokenType>([
    // Query keywords
    ["select", TokenType.SELECT],
    ["as", TokenType.AS],
    ["from", TokenType.FROM],
    ["where", TokenType.WHERE],
    ["order", TokenType.ORDER],
    ["by", TokenType.BY],
    ["asc", TokenType.ASC],
    ["desc", TokenType.DESC],
    ["limit", TokenType.LIMIT],

    // DML
    ["insert", TokenType.INSERT],
    ["into", TokenType.INTO],
    ["values", TokenType.VALUES],
    ["update", TokenType.UPDATE],
    ["set", TokenType.SET],
    ["delete", TokenType.DELETE],

    // DDL
    ["create", TokenType.CREATE],
    ["alter", TokenType.ALTER],
    ["drop", TokenType.DROP],
    ["table", TokenType.TABLE],
    ["add", TokenType.ADD],
    ["column", TokenType.COLUMN],
    ["rename", TokenType.RENAME],
    ["to", TokenType.TO],

    // Constraints
    ["primary", TokenType.PRIMARY],
    ["key", TokenType.KEY],
    ["foreign", TokenType.FOREIGN],
    ["references", TokenType.REFERENCES],
    ["unique", TokenType.UNIQUE],
    ["not", TokenType.NOT],
    ["null", TokenType.NULL],

    // Logical keywords
    ["and", TokenType.AND],
    ["or", TokenType.OR],
    ["is", TokenType.IS],
    ["true", TokenType.TRUE],
    ["false", TokenType.FALSE],

    // Data types
    ["integer", TokenType.INTEGER],
    ["serial", TokenType.SERIAL],
    ["double", TokenType.DOUBLE],
    ["char", TokenType.CHAR],
    ["text", TokenType.TEXT],
    ["boolean", TokenType.BOOLEAN],
    ["timestamp", TokenType.TIMESTAMP],
]);