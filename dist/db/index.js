"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.pool = void 0;
exports.requireDb = requireDb;
const node_postgres_1 = require("drizzle-orm/node-postgres");
const pg_1 = require("pg");
const schema_1 = require("./schema");
const connectionString = process.env.DATABASE_URL;
exports.pool = connectionString
    ? new pg_1.Pool({ connectionString, max: 5, ssl: { rejectUnauthorized: false } })
    : null;
exports.db = exports.pool ? (0, node_postgres_1.drizzle)(exports.pool, { schema: schema_1.schema }) : null;
function requireDb() {
    if (!exports.db)
        throw new Error("DATABASE_URL is not configured");
    return exports.db;
}
