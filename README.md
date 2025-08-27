# Auto-Updating Schedule — Starter Kit

This is a tiny, runnable starter (DB schema + seeds + minimal Express API) that proves the **auto‑updating master schedule** via a SQL view.

## 1) `.env.example`

```
PGHOST=localhost
PGPORT=5432
PGDATABASE=school_sched
PGUSER=your_mac_username
PGPASSWORD=
PORT=8080
```

## 2) `sql/schema.sql`

```sql
-- Drop and create (dev only)
DROP VIEW IF EXISTS effective_schedule;
DROP TABLE IF EXISTS checkins, sub_assignments, absences, timetable, periods, rooms, courses, teachers CASCADE;

CREATE TABLE teachers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  is_sub BOOLEAN DEFAULT false
);

CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT
);

CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

-- Each row is a concrete time slot on a specific date
CREATE TABLE periods (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  block TEXT NOT NULL, -- e.g., P1, P2, or 3-5pm
  start_at TIMESTAMP NOT NULL,
  end_at   TIMESTAMP NOT NULL
);

-- Baseline timetable (who normally teaches where)
CREATE TABLE timetable (
  id SERIAL PRIMARY KEY,
  period_id INT NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  course_id INT NOT NULL REFERENCES courses(id),
  primary_teacher_id INT NOT NULL REFERENCES teachers(id),
  room_id INT NOT NULL REFERENCES rooms(id)
);

-- Teacher absences (approved window)
CREATE TABLE absences (
  id SERIAL PRIMARY KEY,
  teacher_id INT NOT NULL REFERENCES teachers(id),
  start_at TIMESTAMP NOT NULL,
  end_at   TIMESTAMP NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'approved' -- draft|requested|approved|denied
);

-- Sub assignments per affected period
CREATE TABLE sub_assignments (
  id SERIAL PRIMARY KEY,
  absence_id INT NOT NULL REFERENCES absences(id) ON DELETE CASCADE,
  period_id INT NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  sub_teacher_id INT NOT NULL REFERENCES teachers(id),
  status TEXT NOT NULL DEFAULT 'assigned', -- assigned|cancelled
  assigned_by TEXT,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Only one active sub per period
CREATE UNIQUE INDEX one_assignment_per_period
  ON sub_assignments(period_id)
  WHERE status = 'assigned';

-- The magic: master schedule that auto-swaps in the sub when present
CREATE VIEW effective_schedule AS
SELECT
  t.period_id,
  t.course_id,
  COALESCE(sa.sub_teacher_id, t.primary_teacher_id) AS teacher_id,
  t.room_id
FROM timetable t
LEFT JOIN sub_assignments sa
  ON sa.period_id = t.period_id
  AND sa.status = 'assigned';
```

## 3) `sql/seed.sql`

```sql
-- Teachers (2 regular, 2 subs)
INSERT INTO teachers(name, email, is_sub) VALUES
 ('Ms. Rivera','rivera@example.edu', false),
 ('Mr. Chen','chen@example.edu', false),
 ('Alex Suber','alex.sub@example.edu', true),
 ('Jamie Cover','jamie.cover@example.edu', true);

INSERT INTO courses(name, subject) VALUES
 ('Algebra 1','Math'),
 ('Earth Science','Science');

INSERT INTO rooms(name) VALUES ('A101'),('B202');

-- Two periods on 2025-09-01 (P1, P2)
INSERT INTO periods(date, block, start_at, end_at) VALUES
 ('2025-09-01','P1','2025-09-01 08:00','2025-09-01 08:50'),
 ('2025-09-01','P2','2025-09-01 09:00','2025-09-01 09:50');

-- Baseline timetable
-- P1: Algebra with Ms. Rivera in A101
-- P2: Earth Science with Mr. Chen in B202
INSERT INTO timetable(period_id, course_id, primary_teacher_id, room_id) VALUES
 (1, 1, 1, 1),
 (2, 2, 2, 2);

-- Absence: Ms. Rivera absent for the morning → affects P1
INSERT INTO absences(teacher_id, start_at, end_at, reason) VALUES
 (1, '2025-09-01 07:30', '2025-09-01 12:00', 'Appointment');
```

## 4) `server/index.js`

```js
import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
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

// GET effective schedule grid for a date
app.get('/schedule/effective', async (req, res) => {
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
    res.status(500).json({ error: 'failed_to_fetch_schedule' });
  }
});

// POST assign a sub to a specific period (idempotent per period)
app.post('/sub-assignments', async (req, res) => {
  const { absence_id, period_id, sub_teacher_id, assigned_by } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure period isn't already taken
    const taken = await client.query(
      `SELECT 1 FROM sub_assignments WHERE period_id=$1 AND status='assigned'`,
      [period_id]
    );
    if (taken.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'already_assigned' });
    }

    // Insert assignment
    const { rows } = await client.query(
      `INSERT INTO sub_assignments(absence_id, period_id, sub_teacher_id, status, assigned_by)
       VALUES ($1,$2,$3,'assigned',$4)
       RETURNING id, absence_id, period_id, sub_teacher_id, status`,
      [absence_id, period_id, sub_teacher_id, assigned_by || 'admin']
    );

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'assign_failed' });
  } finally {
    client.release();
  }
});

// DELETE unassign
app.delete('/sub-assignments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`UPDATE sub_assignments SET status='cancelled' WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'unassign_failed' });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
```

## 5) `package.json`

```json
{
  "name": "schedule-api",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "node server/index.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "pg": "^8.11.5"
  }
}
```

## 6) How to run (local)

```bash
# 1) Create DB
createdb school_sched
psql school_sched -f sql/schema.sql
psql school_sched -f sql/seed.sql

# 2) Start API (from project root)
npm install
cp .env.example .env   # edit PGUSER
npm run dev

# 3) Prove auto‑update
#   A) See baseline (no subs yet)
curl "http://localhost:8080/schedule/effective?date=2025-09-01" | jq

#   B) Assign a sub (Alex, id=3) to period 1 against absence id=1
curl -X POST http://localhost:8080/sub-assignments \
  -H 'Content-Type: application/json' \
  -d '{"absence_id":1, "period_id":1, "sub_teacher_id":3, "assigned_by":"demo"}'

#   C) Fetch again — P1 teacher should now be Alex Suber automatically
curl "http://localhost:8080/schedule/effective?date=2025-09-01" | jq
```

## 7) What this proves

* The **master schedule updates itself** the moment a sub is assigned.
* All views/exports that read from `effective_schedule` reflect the change instantly.
* No risky overwriting of the baseline timetable.

## 8) Next enhancements

* Absence expansion: generate `period_id`s covered by the time window automatically.
* Candidate list endpoint: filter subs by conflicts, subject, campus.
* WebSocket push to live‑update an admin day view.
* ICS feed generated from `effective_schedule` for staff calendars.

---

### Notes

* This starter keeps things minimal for clarity; we can fold it into a full PERN app next (React day grid + claim link for subs).
