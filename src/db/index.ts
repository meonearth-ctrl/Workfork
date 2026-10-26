// Database connection. Production: real Postgres via DATABASE_URL (Supabase,
// Neon, RDS…). Local development: PGlite, an embedded Postgres stored in
// ./.data/pglite, so `npm run dev` works with no database install.
// One connection is kept on globalThis so hot reload doesn't open new ones.

import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export const PGLITE_DIR = process.env.PGLITE_DIR ?? "./.data/pglite";

function connect(): Database {
  const url = process.env.DATABASE_URL;
  if (url) {
    // DATABASE_POOL_MAX: lower it for small hosted plans or serverless poolers.
    return drizzlePostgres(postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10) }), { schema }) as unknown as Database;
  }
  mkdirSync(PGLITE_DIR, { recursive: true });
  return drizzlePglite(new PGlite(PGLITE_DIR), { schema }) as unknown as Database;
}

const globalForDb = globalThis as unknown as { workforceDb?: Database };

export const db: Database = globalForDb.workforceDb ?? connect();
globalForDb.workforceDb = db;

export { schema };
