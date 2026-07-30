import postgres from "postgres";
import type { PipelineRunLock } from "../../ports/pipeline-run-lock.js";
import type { EnvReader } from "../../ports/env.js";

type LockState = "idle" | "acquired" | "contended" | "released";

export class PgPipelineRunLock implements PipelineRunLock {
  private state: LockState = "idle";
  private key: string | null = null;
  private client: ReturnType<typeof postgres> | null = null;
  private reserved: Awaited<ReturnType<ReturnType<typeof postgres>["reserve"]>> | null = null;

  constructor(private readonly env: EnvReader) {}

  async acquire(key: string): Promise<"acquired" | "already_running"> {
    if (!key || key.trim() === "") {
      throw new Error("Lock key must be a non-empty string");
    }
    if (this.state !== "idle") {
      throw new Error(`Cannot acquire lock: current state is '${this.state}'`);
    }

    const connectionString = this.env.get("DATABASE_URL");
    const pgMaxConnections = this.env.getOptional("PG_MAX_CONNECTIONS");
    const parsed = parseInt(pgMaxConnections ?? "", 10);
    const max = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
    const pgSsl = this.env.getOptional("PG_SSL");
    const ssl = pgSsl === "false" ? false : { rejectUnauthorized: false };

    const client = postgres(connectionString, {
      connection: {
        search_path: "intelligence"
      },
      ssl,
      idle_timeout: 30,
      max_lifetime: 1800,
      connect_timeout: 10,
      max
    });

    let reserved: Awaited<ReturnType<typeof client.reserve>> | null = null;

    try {
      reserved = await client.reserve();
      const result = await reserved<
        { acquired: boolean }[]
      >`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired`;
      const acquired = Boolean(result[0]?.acquired);

      if (acquired) {
        this.client = client;
        this.reserved = reserved;
        this.key = key;
        this.state = "acquired";
        return "acquired";
      } else {
        this.state = "contended";
        await this.cleanupResources(reserved, client);
        return "already_running";
      }
    } catch (error) {
      this.state = "contended";
      try {
        await this.cleanupResources(reserved, client);
      } catch {
        // preserve original acquisition error as primary
      }
      throw error;
    }
  }

  async release(): Promise<void> {
    if (this.state !== "acquired" || !this.reserved || !this.client || !this.key) {
      throw new Error(`Cannot release lock: current state is '${this.state}'`);
    }

    const key = this.key;
    const reserved = this.reserved;
    const client = this.client;

    this.state = "released";
    this.reserved = null;
    this.client = null;
    this.key = null;

    let primaryError: unknown = null;

    try {
      const result = await reserved<
        { released: boolean }[]
      >`SELECT pg_advisory_unlock(hashtextextended(${key}, 0)) AS released`;
      if (!result[0]?.released) {
        primaryError = new Error(`pg_advisory_unlock returned false for key '${key}'`);
      }
    } catch (err) {
      primaryError = err;
    }

    try {
      await reserved.release();
    } catch (err) {
      if (!primaryError) {
        primaryError = err;
      }
    }

    try {
      await client.end();
    } catch (err) {
      if (!primaryError) {
        primaryError = err;
      }
    }

    if (primaryError) {
      throw primaryError;
    }
  }

  private async cleanupResources(
    reserved: Awaited<ReturnType<ReturnType<typeof postgres>["reserve"]>> | null,
    client: ReturnType<typeof postgres>
  ): Promise<void> {
    let primaryError: unknown = null;
    if (reserved) {
      try {
        await reserved.release();
      } catch (err) {
        primaryError = err;
      }
    }
    try {
      await client.end();
    } catch (err) {
      if (!primaryError) {
        primaryError = err;
      }
    }
    if (primaryError) {
      throw primaryError;
    }
  }
}
