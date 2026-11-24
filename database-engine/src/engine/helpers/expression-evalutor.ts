import { ValueTypes } from "../../common/types/common.types";
import { ExpressionEvaluationError as ExpressionEvaluationError } from "../errors";
import { Expr } from "../sql/parser/expression.types";

export class ExpressionEvaluator {
    static evaluate(expr: Expr, row?: ValueTypes[]): ValueTypes {
        switch (expr.type) {
            case "Literal":
                return expr.value;

            case "ColumnRef":
                throw new ExpressionEvaluationError(`Cannot evalute value for column reference "${expr.name}". Column references are not allowed in this context.`);
            
            case "BoundColumnRef":
                if (!row) {
                    throw new ExpressionEvaluationError(`Cannot evaluate value for bound column reference at index ${expr.columnIndex}. Row data is not provided.`);
                }
                if (expr.columnIndex < 0 || expr.columnIndex >= row.length) {
                    throw new ExpressionEvaluationError(`Invalid column index ${expr.columnIndex}.`);
                }
                return row[expr.columnIndex];

            case "Binary":
                const leftValue = ExpressionEvaluator.evaluate(expr.left, row);
                const rightValue = ExpressionEvaluator.evaluate(expr.right, row);
                const operator = expr.operator;

                if(leftValue === null || rightValue === null) return null;

                const arthmeticOperators = ['+', '-', '*', '/'];
                if (arthmeticOperators.includes(operator)) {
                    if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
                        throw new ExpressionEvaluationError(`Arithmetic operations can only be performed on numeric values.`);
                    }
                }

                const numericLeftValue = leftValue as number;
                const numericRightValue = rightValue as number;

                switch (operator) {
                    case '+':
                        return numericLeftValue + numericRightValue;
                    case '-':
                        return numericLeftValue - numericRightValue;
                    case '*':
                        return numericLeftValue * numericRightValue;
                    case '/':                        
                        if (numericRightValue === 0) {
                            throw new ExpressionEvaluationError("Division by zero.");
                        }
                        if(Number.isInteger(numericLeftValue) && Number.isInteger(numericRightValue)) {
                            return Math.trunc(numericLeftValue / numericRightValue);
                        }
                        
                        return numericLeftValue / numericRightValue;
                    case '=':
                        return leftValue === rightValue;
                    case '!=':
                        return leftValue !== rightValue;
                    case '<':
                        return leftValue < rightValue;
                    case '>':
                        return leftValue > rightValue;
                    case '<=':
                        return leftValue <= rightValue;
                    case '>=':
                        return leftValue >= rightValue;
                    default:
                        throw new ExpressionEvaluationError(`Unsupported binary operator: ${operator}`);
                }

            case "Logical": {
                const left = this.evaluate(expr.left, row);
                const operator = expr.operator;

                if (typeof left !== "boolean" && left !== null) {
                    throw new ExpressionEvaluationError("Logical operations can only be performed on boolean values.");
                }

                if (operator === "AND" && left === false) return false;
                if (operator === "OR" && left === true) return true;

                const right = this.evaluate(expr.right, row);

                if (typeof right !== "boolean" && right !== null) {
                    throw new ExpressionEvaluationError("Logical operations can only be performed on boolean values.");
                }

                switch (operator) {
                    case "AND":
                        if (right === false) return false;
                        if (left === null || right === null) return null;
                        return true;

                    case "OR":
                        if (right === true) return true;
                        if (left === null || right === null) return null;
                        return false;

                    default:
                        throw new ExpressionEvaluationError(`Unsupported logical operator: ${operator}`);
                }
            }

            case "Unary":
                const operandValue = ExpressionEvaluator.evaluate(expr.operand, row);
                if (operandValue === null) return null;

                const unaryOperator = expr.operator;
                switch (unaryOperator) {
                    case 'NOT':
                        if (typeof operandValue !== 'boolean') {
                            throw new ExpressionEvaluationError(`NOT operator can only be applied to boolean values.`);
                        }
                        return !operandValue;
                    case '-':
                        if (typeof operandValue !== 'number') {
                            throw new ExpressionEvaluationError(`minus operator can only be applied to numeric values.`);
                        }
                        return -operandValue;
                    default:
                        throw new ExpressionEvaluationError(`Unsupported unary operator: ${unaryOperator}`);
                }
            case "IsNull":
                const operandIsNullValue = ExpressionEvaluator.evaluate(expr.operand, row);
                return expr.isNot ? operandIsNullValue !== null : operandIsNullValue === null;
            default:
                throw new ExpressionEvaluationError(`Unsupported expression type`);
        }
    }

}
    