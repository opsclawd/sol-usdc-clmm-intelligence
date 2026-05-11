import type { DbConnection } from "../../src/ports/db.js";

export class FakeDbConnection implements DbConnection {
  private closed = false;

  async close(): Promise<void> {
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
