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
