//Expression AST nodes
export type Expr = LiteralExpr  | LogicalExpr | ColumnRefExpr | BinaryExpr | UnaryExpr | IsNullExpr | BoundColumnRefExpr;

export interface LiteralExpr {
    type: "Literal";
    value: string | number | boolean | null;
}

export interface ColumnRefExpr {
    type: "ColumnRef";
    name: string;
}

export interface LogicalExpr {
    type: "Logical";
    operator: 'AND' | 'OR'; // The operator token (e.g., AND, OR)
    left: Expr;
    right: Expr;
}

export interface BinaryExpr {
    type: "Binary";
    operator: '+' | '-' | '*' | '/' | '=' | '<' | '>' | '<=' | '>=' | '!='; // The operator token (e.g., +, -, *, /, =, <, >, etc.)
    left: Expr;
    right: Expr;
}

export interface UnaryExpr {
    type: "Unary";
    operator: 'NOT' | '-';
    operand: Expr;
}

export interface IsNullExpr {
    type: "IsNull";
    isNot: boolean;
    operand: Expr;
}

export interface BoundColumnRefExpr {
    type: "BoundColumnRef";
    columnIndex: number;
}