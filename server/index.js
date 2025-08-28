import express from "express";
import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD || undefined,
});

const app = express();
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// GET effective schedule grid for a date
app.get("/schedule/effective", async (req, res) => {
  const { date } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT p.id as period_id, p.date, p.block, p.start_at, p.end_at,
              c.name as course_name, r.name as room,
              t.name as teacher_name
       FROM effective_schedule es
       JOIN periods p ON p.id = es.period_id
       JOIN courses c ON c.id = es.course_id
       JOIN rooms r   ON r.id = es.room_id
       JOIN teachers t ON t.id = es.teacher_id
       WHERE ($1::date IS NULL OR p.date = $1::date)
       ORDER BY p.start_at`,
      [date || null]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed_to_fetch_schedule" });
  }
});

// POST assign a sub to a specific period (idempotent per period)
app.post("/sub-assignments", async (req, res) => {
  const { absence_id, period_id, sub_teacher_id, assigned_by } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ensure period isn't already taken
    const taken = await client.query(
      `SELECT 1 FROM sub_assignments WHERE period_id=$1 AND status='assigned'`,
      [period_id]
    );
    if (taken.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "already_assigned" });
    }

    // Insert assignment
    const { rows } = await client.query(
      `INSERT INTO sub_assignments(absence_id, period_id, sub_teacher_id, status, assigned_by)
       VALUES ($1,$2,$3,'assigned',$4)
       RETURNING id, absence_id, period_id, sub_teacher_id, status`,
      [absence_id, period_id, sub_teacher_id, assigned_by || "admin"]
    );

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "assign_failed" });
  } finally {
    client.release();
  }
});

// DELETE unassign
app.delete("/sub-assignments/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE sub_assignments SET status='cancelled' WHERE id=$1`,
      [id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "unassign_failed" });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
