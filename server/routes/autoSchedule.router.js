import { Router } from "express";
import {
  getEffectiveSchedule,
  assignSub,
  cancelAssignment,
} from "../services/effectiveSchedule.js";

const r = Router();

r.get("/schedule/effective", async (req, res) => {
  try {
    const data = await getEffectiveSchedule(req.query.date);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed_to_fetch_schedule" });
  }
});

r.post("/sub-assignments", async (req, res) => {
  try {
    const created = await assignSub(req.body);
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res
      .status(e.status || 500)
      .json({ error: e.status === 409 ? "already_assigned" : "assign_failed" });
  }
});

r.delete("/sub-assignments/:id", async (req, res) => {
  try {
    const ok = await cancelAssignment(req.params.id);
    res.json(ok);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "unassign_failed" });
  }
});

export default r;
