import { pgSchema } from "drizzle-orm/pg-core";

export const PG_SCHEMA_NAME = "intelligence";

export const intelligence = pgSchema(PG_SCHEMA_NAME);
