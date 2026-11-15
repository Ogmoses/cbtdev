-- 033 — Covering indexes for every foreign key that lacked one (the Supabase performance advisor's
-- "unindexed foreign keys": 41 of them).
--
-- WHY: a foreign key is checked on every change to the parent row. With no index on the child's matching
-- columns, each check scans the whole child table. That is invisible with a few hundred rows, but with thousands of
-- students it makes things like deleting a school (which removes many rows) or editing/removing a question slow,
-- and it slows the joins behind results and reports. Most keys here are (school_id, x) pairs, because every table
-- carries its school; each index follows its key's column order.
--
-- WHAT THIS DOES (purely additive: nothing is changed or removed; the data and the rules are untouched):
--   * 41 plain indexes, created only if they don't exist yet (safe to re-run).
--   * The tables are small today (the largest, student_answers, has about 1,300 rows), so each index builds in
--     milliseconds. On a much larger table this would be built CONCURRENTLY outside a migration instead.
--   * Trade-off: every index adds a little work to each write. For the busiest table during an exam
--     (student_answers) that is four small indexes; at this scale it is negligible and the delete/join speed-up is worth it.

create index if not exists idx_fk_access_tokens_school_id_user_id on access_tokens (school_id, user_id);
create index if not exists idx_fk_announcement_dismissals_user_id on announcement_dismissals (user_id);
create index if not exists idx_fk_batch_students_school_id_batch_id on batch_students (school_id, batch_id);
create index if not exists idx_fk_batch_students_school_id_student_id on batch_students (school_id, student_id);
create index if not exists idx_fk_class_subjects_school_id_class_id on class_subjects (school_id, class_id);
create index if not exists idx_fk_class_subjects_school_id_subject_id on class_subjects (school_id, subject_id);
create index if not exists idx_fk_email_change_requests_school_id on email_change_requests (school_id);
create index if not exists idx_fk_exam_batches_school_id_exam_id on exam_batches (school_id, exam_id);
create index if not exists idx_fk_exam_questions_school_id_exam_id on exam_questions (school_id, exam_id);
create index if not exists idx_fk_exam_questions_school_id_question_id on exam_questions (school_id, question_id);
create index if not exists idx_fk_exams_school_id_class_id on exams (school_id, class_id);
create index if not exists idx_fk_exams_school_id_created_by on exams (school_id, created_by);
create index if not exists idx_fk_exams_school_id_subject_id on exams (school_id, subject_id);
create index if not exists idx_fk_exams_school_id_term_id on exams (school_id, term_id);
create index if not exists idx_fk_platform_events_school_id on platform_events (school_id);
create index if not exists idx_fk_question_import_batches_school_id_class_id on question_import_batches (school_id, class_id);
create index if not exists idx_fk_question_import_batches_school_id_created_by on question_import_batches (school_id, created_by);
create index if not exists idx_fk_question_import_batches_school_id_subject_id on question_import_batches (school_id, subject_id);
create index if not exists idx_fk_question_options_school_id_question_id on question_options (school_id, question_id);
create index if not exists idx_fk_questions_school_id_class_id on questions (school_id, class_id);
create index if not exists idx_fk_questions_school_id_created_by on questions (school_id, created_by);
create index if not exists idx_fk_questions_school_id_subject_id on questions (school_id, subject_id);
create index if not exists idx_fk_results_school_id_exam_id on results (school_id, exam_id);
create index if not exists idx_fk_results_school_id_session_id on results (school_id, session_id);
create index if not exists idx_fk_results_school_id_student_id on results (school_id, student_id);
create index if not exists idx_fk_student_answers_school_id_graded_by on student_answers (school_id, graded_by);
create index if not exists idx_fk_student_answers_school_id_question_id on student_answers (school_id, question_id);
create index if not exists idx_fk_student_answers_school_id_selected_option_id on student_answers (school_id, selected_option_id);
create index if not exists idx_fk_student_answers_school_id_session_id on student_answers (school_id, session_id);
create index if not exists idx_fk_student_exam_sessions_school_id_batch_id on student_exam_sessions (school_id, batch_id);
create index if not exists idx_fk_student_exam_sessions_school_id_exam_id on student_exam_sessions (school_id, exam_id);
create index if not exists idx_fk_student_exam_sessions_school_id_student_id on student_exam_sessions (school_id, student_id);
create index if not exists idx_fk_support_ticket_views_user_id on support_ticket_views (user_id);
create index if not exists idx_fk_teacher_subjects_school_id_class_id on teacher_subjects (school_id, class_id);
create index if not exists idx_fk_teacher_subjects_school_id_subject_id on teacher_subjects (school_id, subject_id);
create index if not exists idx_fk_teacher_subjects_school_id_teacher_id on teacher_subjects (school_id, teacher_id);
create index if not exists idx_fk_term_subject_results_school_id_student_id on term_subject_results (school_id, student_id);
create index if not exists idx_fk_term_subject_results_school_id_subject_id on term_subject_results (school_id, subject_id);
create index if not exists idx_fk_term_subject_results_school_id_term_id on term_subject_results (school_id, term_id);
create index if not exists idx_fk_terms_school_id_academic_session_id on terms (school_id, academic_session_id);
create index if not exists idx_fk_users_school_id_class_id on users (school_id, class_id);
