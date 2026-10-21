// SAP's node-hdb ships no typings; this is the little of it the SAP HANA driver uses.
declare module 'hdb' {
  export interface ClientOptions {
    host: string;
    port: number;
    user: string;
    password: string;
    databaseName?: string;
    useTLS?: boolean;
    rejectUnauthorized?: boolean;
    connectTimeout?: number;
  }
  /** A result set column as the protocol describes it: the type as a code (lib/protocol/common/TypeCode), its scale and length. */
  export interface ColumnMetadata {
    columnDisplayName: string;
    columnName: string;
    dataType: number;
    fraction: number;
    length: number;
  }
  export interface Rows extends Array<unknown[]> {
    metadata?: ColumnMetadata[];
  }
  export interface Client {
    connect(cb: (err: Error | null) => void): void;
    exec(sql: string, options: { rowsAsArray?: boolean }, cb: (err: Error | null, rows?: Rows | number) => void): void;
    end(): void;
    on(event: 'error', listener: (err: Error) => void): void;
  }
  export function createClient(options: ClientOptions): Client;
}
