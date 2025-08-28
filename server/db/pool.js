import pg from "pg";

export const pool = new pg.Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "school_sched",
  user: process.env.PGUSER || process.env.USER,
  password: process.env.PGPASSWORD || undefined,
});
