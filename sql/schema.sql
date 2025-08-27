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
