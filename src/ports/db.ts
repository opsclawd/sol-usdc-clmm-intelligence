export interface DbConnection {
  close(): Promise<void>;
}
