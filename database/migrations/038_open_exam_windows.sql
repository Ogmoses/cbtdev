-- 038 — Open sitting windows + a server-enforced personal timer.
--
-- WHAT THIS DOES (purely additive — nothing existing is removed or changed in meaning):
--   * exam_batches.stays_open : a sitting that stays open until the teacher closes it (default false = today's fixed window).
--   * exam_batches.closed_at  : set when the teacher closes a sitting; cleared when he reopens it.
--   * student_exam_sessions.deadline_at : each student's OWN finishing time (start + exam duration), kept by the server
--     so refreshing the page or switching computers can no longer restart someone's clock.
--   * Sessions that already exist get their deadline worked out from when they started.
-- "One attempt per student per exam" is untouched: unique (exam_id, student_id) on student_exam_sessions still holds.
alter table exam_batches add column if not exists stays_open boolean not null default false;
alter table exam_batches add column if not exists closed_at timestamptz;

alter table student_exam_sessions add column if not exists deadline_at timestamptz;

update student_exam_sessions s
   set deadline_at = s.started_at + make_interval(mins => e.duration_minutes)
  from exams e
 where e.id = s.exam_id and s.deadline_at is null;
