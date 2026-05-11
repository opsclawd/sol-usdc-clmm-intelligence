import type { Db } from "../db/db.js";

export interface DbConnection {
  db: Db;
  close(): Promise<void>;
}
