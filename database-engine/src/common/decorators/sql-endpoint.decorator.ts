import { SetMetadata } from '@nestjs/common';

export const SQL_ENDPOINT_KEY = 'sql_endpoint';

export type SqlEndpointType = 'ddl' | 'dml';

export const SqlEndpoint = (type: SqlEndpointType) => SetMetadata(SQL_ENDPOINT_KEY, type);