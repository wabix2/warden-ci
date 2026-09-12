import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./schema";

const connectionString = process.env.DATABASE_URL;

export const pool = connectionString
  ? new Pool({ connectionString, max: 5, ssl: { rejectUnauthorized: false } })
  : null;

export const db = pool ? drizzle(pool, { schema }) : null;

export function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}
