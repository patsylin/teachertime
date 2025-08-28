import { pool } from "../db/pool.js";

export async function getEffectiveSchedule(date) {
  const { rows } = await pool.query(
    `SELECT p.id as period_id, p.date, p.block, p.start_at, p.end_at,
            c.name as course_name, r.name as room, t.name as teacher_name
     FROM effective_schedule es
     JOIN periods p ON p.id = es.period_id
     JOIN courses c ON c.id = es.course_id
     JOIN rooms r   ON r.id = es.room_id
     JOIN teachers t ON t.id = es.teacher_id
     WHERE ($1::date IS NULL OR p.date = $1::date)
     ORDER BY p.start_at`,
    [date || null]
  );
  return rows;
}

export async function assignSub({
  absence_id,
  period_id,
  sub_teacher_id,
  assigned_by = "admin",
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const taken = await client.query(
      "SELECT 1 FROM sub_assignments WHERE period_id=$1 AND status='assigned'",
      [period_id]
    );
    if (taken.rowCount) {
      throw Object.assign(new Error("already_assigned"), { status: 409 });
    }

    const { rows } = await client.query(
      `INSERT INTO sub_assignments(absence_id, period_id, sub_teacher_id, status, assigned_by)
       VALUES ($1,$2,$3,'assigned',$4)
       RETURNING id, absence_id, period_id, sub_teacher_id, status`,
      [absence_id, period_id, sub_teacher_id, assigned_by]
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelAssignment(id) {
  await pool.query(
    "UPDATE sub_assignments SET status='cancelled' WHERE id=$1",
    [id]
  );
  return { ok: true };
}
