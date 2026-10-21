// node-oracledb ships no typings; this is the little of it the Oracle driver uses (thin mode, no client install).
declare module 'oracledb' {
  export interface DbType {
    num: number;
    name: string;
    columnTypeName: string;
  }
  export interface Metadata {
    name: string;
    dbType?: DbType;
    dbTypeName?: string;
    precision?: number;
    scale?: number;
    byteSize?: number;
    nullable?: boolean;
  }
  export interface ExecuteOptions {
    outFormat?: number;
    fetchTypeHandler?: (metaData: Metadata) => { type?: DbType; converter?: (v: unknown) => unknown } | undefined;
    maxRows?: number;
  }
  export interface Result {
    rows?: unknown[][];
    metaData?: Metadata[];
  }
  export interface Connection {
    execute(sql: string, binds?: unknown[], options?: ExecuteOptions): Promise<Result>;
    close(): Promise<void>;
    readonly oracleServerVersionString: string;
  }
  export interface ConnectionAttributes {
    user?: string;
    password?: string;
    connectString?: string;
    connectTimeout?: number;
  }
  export function getConnection(attrs: ConnectionAttributes): Promise<Connection>;
  export const OUT_FORMAT_ARRAY: number;
  export const STRING: DbType;
  export const BUFFER: DbType;
  export const DB_TYPE_NUMBER: DbType;
  export const DB_TYPE_CLOB: DbType;
  export const DB_TYPE_NCLOB: DbType;
  export const DB_TYPE_BLOB: DbType;
  export const DB_TYPE_LONG_RAW: DbType;
  export const DB_TYPE_INTERVAL_DS: DbType;
  export const DB_TYPE_INTERVAL_YM: DbType;
  export let fetchAsString: DbType[];
  export let fetchAsBuffer: DbType[];
  const oracledb: {
    getConnection: typeof getConnection;
    OUT_FORMAT_ARRAY: number;
    STRING: DbType;
    BUFFER: DbType;
    DB_TYPE_NUMBER: DbType;
    DB_TYPE_CLOB: DbType;
    DB_TYPE_NCLOB: DbType;
    DB_TYPE_BLOB: DbType;
    DB_TYPE_LONG_RAW: DbType;
    DB_TYPE_INTERVAL_DS: DbType;
    DB_TYPE_INTERVAL_YM: DbType;
  };
  export default oracledb;
}
