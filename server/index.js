import express from "express";
import dotenv from "dotenv";
import autoScheduleRouter from "./routes/autoSchedule.router.js";

dotenv.config();
const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

// ✅ mount the auto-schedule endpoints
app.use("/api", autoScheduleRouter);

const port = process.env.PORT || 8080;
app.listen(port, () =>
  console.log(`Server running on http://localhost:${port}`)
);
