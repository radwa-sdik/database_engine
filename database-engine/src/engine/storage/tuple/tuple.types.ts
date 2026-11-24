import { ColumnDataType, ValueTypes } from "../../../common/types/common.types";

export interface TupleValue {
    type: TupleColumnDataType;
    value: ValueTypes;
}

export interface TupleColumnDataType {
    dataType: ColumnDataType | "NULL";
    length?: number;
    name: string;
}

export type Tuple = TupleValue[];