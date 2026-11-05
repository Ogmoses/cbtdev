# CBT & School Management Platform (multi-school)

A deployable Next.js (App Router) + Supabase platform for computer-based
testing and school management. **One deployment hosts many independent
schools** — each with its own people, exams, results, branding and link.
Originally built for Soaring Fountain Group of Schools, which is now simply
school #1 on the platform.

> **Standing rule: this README is updated with every change** (the "Current
> state" section below, plus a new entry at the bottom). If something here
> disagrees with the code, the code is right and this file is a bug — fix it.

**Deploying? See [`DEPLOYMENT.md`](./DEPLOYMENT.md)** (and
`DEPLOYMENT-MOBILE.md` for doing it from a phone).

## Current state (read this first)

### Who uses it, and where they go
| Role | Sees | Lives at |
|---|---|---|
| `platform_owner` | the **Command Center**: live overview + Exam Radar, every school's status and counts (never their data); adds, approves, suspends and deletes schools; broadcasts; support inbox; maintenance / sign-up switches; rate-limit security view; audit log; owner settings | `/owner`, `/owner/broadcasts`, `/owner/support`, `/owner/controls`, `/owner/security`, `/owner/audit-logs`, `/owner/settings` |
| `super_admin` | **one** school's admin: people, academics, batches, results, settings | `/admin/...` |
| `teacher` | their own questions, exams, grading, analytics | `/teacher/...` |
| `student` | their exams, results, review | `/student/...` |

Each school's entry link is **`/s/<school-code>`** (e.g. `/s/soaring-fountain`).
The plain `/login` still works and remembers the last school used on that device.
Schools can register themselves at `/register-school`; they stay **pending** until
the owner approves them (their admin must confirm their email first).

### How schools are kept apart (three layers)
1. **Row Level Security** — every policy requires `school_id = active_school_id()`;
   a pending/suspended school is locked out at the database level.
2. **Composite foreign keys** — a row can never point at another school's row.
3. **Auto-fill + lock** — `school_id` is filled from the signed-in user and can never be changed.
Server routes that use the service role (which ignores RLS) all start with
`getCallerContext()` (`lib/auth/callerContext.ts`) and filter every query by the
caller's school. Details: [`docs/MULTI_TENANT_BACKEND.md`](./docs/MULTI_TENANT_BACKEND.md).

### Environment variables (Vercel + `.env.local`)
| Variable | Purpose | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser key (RLS still gates everything) | no |
| `SUPABASE_SECRET_KEY` | server-only; bypasses RLS | **yes** |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | outgoing email (invites, confirmations). Currently **Brevo** (`smtp-relay.brevo.com`, 587) | pass is secret |
| `SMTP_FROM_EMAIL` / `SMTP_FROM_NAME` | sender; must be verified with the provider | no |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | optional Cloudflare robot check on `/register-school`; skipped if unset | secret key is |

A local `npm run build` needs `.env.local` with at least the first two (it is
git-ignored, so a fresh Codespace never has it):
`NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>` — otherwise the build stops
at "Generating static pages" with "Your project's URL and API key are required".
Vercel has its own copy, so deployments are unaffected.

### Database migrations (`database/migrations/`) — all applied to the live project
| # | What it does |
|---|---|
| 002–008 | access tokens, admin results access, exam cache/pass-mark/review, theme color, import grouping |
| 009 | a teacher can only attach their **own** questions to their own exams |
| 010 | storage buckets `question-images`, `school-assets` |
| 011 | `platform_owner` role |
| 012a | **backup** of the pre-multi-tenant rules (`mt_backup_ddl`) — run before 012 |
| 012 | multi-tenant: `schools`, `school_id` everywhere, composite FKs, tenant RLS, per-school storage paths, branding + stats functions |
| 012_rollback | puts the database back to pre-012 (only valid with ONE school and before 013) — tooling, not applied |
| 013 | dropped the old single-school `school_profile` |
| 014 | a newly activated school gets the standard grading scale (A 70+ … F below 40) |
| 015 | `verify` token type (school-signup email confirmation) |
| 016 | `delete_school_permanently()` — wipes a whole school in one transaction |
| 017 | `platform_settings` — the owner's own theme + background color |
| 018 | `rate_limits` + `rate_limit_hit()` / `rate_limit_blocked()` |
| 019 | `resolve_student_login()` — exact student-ID match (no wildcards) |
| 020 | `revoke_school_sessions()` — signs a school's people out when it is suspended |
| 021 | security hardening from the Supabase advisor: backup table closed to the public, trigger/internal functions no longer callable over the API, fixed `search_path`s |
| 022 | `audit_logs` — append-only, hash-chained record of owner-level actions; `log_audit()` / `verify_audit_chain()` (server only) |
| 023 | `platform_flags` — one row: maintenance mode + message, school sign-ups open/paused (changed only through the owner API) |
| 024 | broadcasts: `announcements`, `announcement_schools`, `announcement_dismissals` (staff see only live ones aimed at their role + school; students never) |
| 025 | support desk: `support_tickets`, `support_ticket_attachments`, private `support-attachments` bucket |
| 026 | live telemetry: `platform_events` (sign-in log: school + role only, 7 days), `platform_telemetry()`, `record_login_event()` |
| 027 | `support_ticket_views` — who has read which ticket update (drives the bell + sidebar alert for admins/teachers) |
| 028 | `revoke_user_sessions()` — signs one person out everywhere (used after a password reset) |
| 030 | `school_exports` + private `school-exports` bucket — ZIP exports of a school's data, kept 30 days, owner sees all (even of deleted schools), a school admin only their own school's |
| 029 | `edit_announcement()` — edits a live/scheduled broadcast (content, audience, schools, schedule, optional "show again") in one all-or-nothing step |
Tests (both roll themselves back; safe on the live database): `database/tests/multi_tenant_isolation_test.sql` (33 checks) and `database/tests/command_center_isolation_test.sql` (42 checks: audit log, flags, broadcasts, support, telemetry access).

### How a change gets to production
Unzip the update over the repo (`unzip -o <zip>`), `npm run build`, `git add -A`,
commit, `git push` — Vercel deploys on push. Apply any new migration in Supabase
**before** deploying code that needs it (unless the migration says otherwise), and
never while an exam is running if it touches exam tables. Delete each zip after use
(`rm -f *.zip`) — Codespaces storage is metered and the free allowance is small.

### Known limitations / still open
- ~~No self-service "forgot password"~~ — **done for teachers and school admins** (Pass 12): "Forgot password?"
  on the staff login. **The platform owner has no self-service reset by design** (the reset tokens need a
  school, and the owner account is the most powerful one): to recover it, use Supabase dashboard →
  Authentication → Users → the owner → send/set a new password.
- **No backup / recovery plan confirmed.** Deleting a student or a whole school is permanent
  (cascades). Check the Supabase plan for daily backups / point-in-time recovery yourself (it is a
  dashboard/plan setting). The **school data export** (Pass 12) now exists as a copy-out path: the owner is
  offered one in the delete dialog (not required), and each school admin can export their own school from
  Settings. It is a spreadsheet export, not a database backup — it can't restore a school by itself.
- ~~No audit log~~ — done (Pass 12, `/owner/audit-logs`). Billing is not part of the platform yet, so nothing bills or logs billing.
- Students' passwords are derived from full name + student ID (by design, no PIN): anyone who
  knows both can sign in as that student. A per-student PIN would close it.
- Leaked Password Protection (Supabase Auth setting) is off — a manual dashboard switch
  (may need a paid plan).
- Performance items to revisit only at scale (flagged by the advisor, irrelevant today):
  RLS rules call `auth.uid()` per row instead of `(select auth.uid())`; the composite foreign
  keys' child columns have no covering index; several tables have multiple permissive policies.
- Untested in a real browser by the author: the photo editor's touch gestures, the bell,
  auto sign-out on suspend. No automated tests for app code (only the database isolation tests).
- No custom domain yet: the site runs on `*.vercel.app`, and emails are sent from a free-provider
  address verified as a single sender in Brevo. Brevo's own guidance is that mail from a free address
  (gmail etc.) is more likely to be filtered to spam, and it substitutes its own sending address for
  those senders — so **some emails (invites, resets, support replies) will land in spam** until an
  owned domain is authenticated. Mitigations already in place: every email now carries a plain-text
  version, and the forgot-password screen tells people to check spam. **When a domain exists**, the
  real fix is: (1) buy/attach it (Vercel → project `cbtdev` → Domains); (2) in Brevo → Senders,
  Domains → add the domain, copy the records it shows (Brevo code, DKIM, DMARC) into the domain's DNS
  (Vercel DNS if the nameservers are on Vercel); (3) set `SMTP_FROM_EMAIL` to an address on that domain
  in Vercel and redeploy; (4) in Supabase → Authentication → URL configuration, set the new Site URL.
- The bell is an **action list** computed live (no history, no push; the only read/unread state is for support-ticket updates).
- Question/diagram cropping is aspect-preset + pan/zoom, not free-form corner handles.
- Leaked Password Protection (Supabase dashboard) is a manual switch.
- Report-card PDFs use Liberation Sans (bundled in `assets/fonts`), so Yoruba/Igbo/Hausa letters and tone marks print; see `public/fonts/README.md`.

## Built so far (the original single-school build; see "Current state" above for today's architecture)
| Area | File |
|---|---|
| Database schema | `database/schema.sql` |
| Tailwind design tokens | `tailwind.config.ts` |
| App shell (sidebar/navbar) | `components/layout/*.tsx` |
| Login (student PIN + staff password) | `components/auth/LoginForm.tsx`, `app/login/page.tsx` |
| Student Exam Launchpad | `components/student/ExamLaunchpad.tsx`, `app/student/page.tsx` |
| Live CBT Exam runner | `components/exam/ExamInterface.tsx` |
| Teacher: Question Bank (create/edit/delete, image upload) | `components/teacher/QuestionBankManager.tsx`, `QuestionEditor.tsx`, `app/teacher/questions/page.tsx` |
| Teacher: Exam Builder (rules, question picker, batch scheduling) | `components/teacher/ExamBuilder.tsx`, `app/teacher/exams/page.tsx` |
| Teacher: Grading Queue (manual marking, save & next) | `components/teacher/GradingQueue.tsx`, `GradingPanel.tsx`, `app/teacher/grading/page.tsx` |
| Teacher: Class Analytics (stats, distribution, hardest questions, roster) | `components/teacher/ClassAnalytics.tsx`, `app/teacher/analytics/page.tsx` |

Teacher portal is now complete end to end.

| Admin: Overview (stats + today's batches, lab-conflict flagging) | `components/admin/AdminOverview.tsx`, `app/admin/page.tsx` |
| Admin: Students & Teachers (CRUD + bulk CSV import) | `components/admin/PeopleManager.tsx`, `PersonEditor.tsx`, `BulkImportModal.tsx`, `csv.ts`, `app/admin/people/page.tsx` |
| Admin: Classes & Subjects (sessions, terms, classes, subjects) | `components/admin/AcademicsManager.tsx`, `AcademicsEditors.tsx`, `app/admin/academics/page.tsx` |
| Admin: Lab Batches (rooms + reusable time templates) | `components/admin/LabBatchesManager.tsx`, `app/admin/batches/page.tsx` |
| Admin: Results & Analytics (publish queue, class/subject performance) | `components/admin/ResultsAnalytics.tsx`, `app/admin/results/page.tsx` |
| Admin: Settings (school profile, grading scale) | `components/admin/SettingsManager.tsx`, `app/admin/settings/page.tsx` |

**All three portals (Student, Teacher, Admin) are now fully built.**

| Backend: Supabase client factories | `lib/supabase/client.ts`, `server.ts` |
| Backend: pure grading logic (auto-mark, grade-letter lookup, weighted CA/terminal rollup) | `lib/grading.ts` |
| Backend: seeded shuffle (stable per-session question/option order) | `lib/shuffle.ts` |
| Backend: start a session — batch-window check, roster check, single-active-session enforcement, stale-session reclaim | `app/api/exam-sessions/start/route.ts` |
| Backend: autosave endpoint (called every 5s by ExamInterface) | `app/api/exam-sessions/answers/route.ts` |
| Backend: submit endpoint — persists final answers, auto-marks objective questions, writes the `results` row | `app/api/exam-sessions/submit/route.ts` |
| Backend: manual-grading endpoint — records a teacher's mark, rolls up `results` once a session is fully graded | `app/api/student-answers/grade/route.ts` |
| Student exam page wired to the above (device fingerprint, loading/error states) | `app/student/exam/[examId]/page.tsx` |

## Still to build (historical — superseded by "Current state" above)
- ~~Teacher creation not populating `teacher_subjects`~~ — resolved: the
  People screen has a per-teacher subject-and-class assignment editor.
- ~~Logo / question image uploads saved as `data:` URLs~~ — resolved in
  Pass 8 (Supabase Storage).
- Supabase's **Leaked Password Protection** (checks new passwords against
  HaveIBeenPwned) is off by default and isn't something the project-level
  connector can toggle — Dashboard → Authentication → Policies to enable it.
- Minor performance-only lints remain (a few unindexed foreign keys, some
  policies that re-evaluate `auth.uid()` per row instead of once per query)
  — fine at this school's scale, not worth the migration churn yet.

| Auth: real Supabase sign-in (student PIN + staff password), pre-auth admission-number lookup | `app/login/page.tsx`, `app/api/auth/resolve-student-email/route.ts`, `lib/supabase/admin.ts` |
| Auth: session-refresh + route-protection proxy (Next.js 16 renamed `middleware.ts` to `proxy.ts`) | `proxy.ts` |
| Auth: shared "who's signed in" hook, used instead of hardcoded userName props | `lib/useAuthUser.ts` |
| Schema: added the three tables Lab Batches/Settings needed (`lab_rooms`, `batch_templates`, singleton `school_profile`) + their RLS policies | `database/schema.sql` §8 |
| Admin: every screen now runs on real Supabase queries | `app/admin/**/page.tsx` |
| Teacher: every screen (Question Bank, Exam Builder, Grading Queue, Class Analytics) now runs on real Supabase queries | `app/teacher/**/page.tsx` |
| Student: Exam Launchpad now shows the signed-in student's actual batches/results, not hardcoded sample data | `app/student/page.tsx` |
| Exam Builder: added the missing `isTerminal` toggle — without it, every exam defaulted to "not terminal" and report cards' Terminal column would always show 0 | `components/teacher/ExamBuilder.tsx` |

**Critical fixes found via Supabase's own security linter and a full RLS
audit** (these were live bugs, not applied to a copy — caught after the
first real deploy):
- 8 tables had **no RLS policy at all** (`academic_sessions`, `terms`,
  `classes`, `subjects`, `class_subjects`, `teacher_subjects`,
  `exam_questions`, `grading_scale`) — wide open to the publishable key.
  4 more (`exams`, `exam_batches`, `batch_students`, `term_subject_results`)
  had RLS *enabled* with zero policies — locked shut, even for admins.
- `question_options` was the same "locked shut" case — fixed by design to
  stay that way for direct client reads (`is_correct` must never be
  queryable by a student), with app code reading it via the service-role
  client instead.
- **The exam-taking flow itself was broken**: `/api/exam-sessions/start`,
  `/answers`, and `/submit` all queried `questions`/`question_options`
  using the RLS-bound client — but students have no SELECT policy on
  either table. In practice this meant empty exams, autosave silently
  mis-filing every multiple-choice answer as free text, and every
  objective question auto-graded as wrong regardless of the real answer.
  All three routes now use the service-role client, since each already
  re-implements its own authorization in code (batch window, roster,
  single-session enforcement) — that's the real boundary, not RLS.
- `/api/student-answers/grade` had the identical issue for the *write*
  side: a teacher grading another student's answer would have the update
  silently affect zero rows under RLS — no error, nothing saved. Same fix.
- Added a `teacher_read_student_answers` policy so Grading Queue and Class
  Analytics can read (never write) other students' answers directly —
  the one case where extending RLS was cleaner than another API route.

**Every screen across all three portals is now wired to real Supabase —
none of the sample-data constants from earlier passes remain anywhere in
`app/`.**

**Since the first live deploy, two more real bugs surfaced and got fixed:**
- A stray extra `)` in `app/student/page.tsx`'s Supabase select string —
  these strings are type-checked at compile time, so a malformed one
  produces a `ParserError` type rather than a normal syntax error.
- `teacher_subjects` was a real, working table with nothing populating or
  reading it — Question Bank and Exam Builder showed every teacher every
  subject in the school. Closed the loop both ways: the People screen now
  has a real subject-and-class assignment editor per teacher (writing to
  `teacher_subjects`), and Question Bank/Exam Builder now filter to a
  signed-in teacher's actual assignments — falling back to showing
  everything only if a teacher has zero assignments yet, so nobody's ever
  completely stuck.

**The Super Admin bootstrap is done** — Moses (`ogmoses321@gmail.com`) is
`super_admin` in `public.users`, matching the Supabase Auth user created
by hand. Grading scale defaults (A–F) are seeded. Classes, subjects, and
real students/teachers still need creating through the app.

**Deliberately not done, and why:** Settings' logo upload still saves a
`data:` URL instead of uploading to Supabase Storage. Fixing it properly
means creating a bucket, writing its RLS policies, and rewriting the
upload handlers in two components — real work with real risk of new bugs,
and unlike everything above, a `data:` URL logo doesn't break anything,
it's just inefficient. Left for a dedicated pass rather than rushed here.

## Pass 4: two real 404s, loading states, mobile overflow, and the invite flow

**Two pages the app promised and never built:**
- `app/teacher/page.tsx` (Teacher Overview) didn't exist at all — the
  sidebar linked to it *and* the login flow redirected every teacher
  straight there, so signing in as a teacher was a guaranteed 404. Built
  it for real: stat cards, today's batches across the teacher's own
  exams, quick links to the other four teacher screens.
- `app/student/batches/page.tsx` and `app/student/results/page.tsx` —
  same story, linked from the student sidebar since the beginning, routes
  never created. Built as focused pages (full history/schedule, not just
  the launchpad's summary), not just redirects back to `/student`.

**Blank-screen-during-load, fixed everywhere at once:** every dashboard
page used to `return null` while its data fetched, which read as the app
freezing rather than loading. Added `components/layout/PageLoading.tsx`
and swapped it into all 12 pages that had the old pattern, plus the 3
new ones — `DashboardLayout` (sidebar/navbar) now renders immediately
either way, only the content area shows the loading state.

**Mobile layout overflow** (the screenshots): `SettingsManager`'s grading
scale editor forced 5 fixed grid columns with no mobile fallback — wide
enough to overflow a phone screen and drag the *whole page* into
horizontal scroll, which is why unrelated content looked clipped/shifted
in the screenshots too, not just that one table. Rebuilt it with a real
mobile layout (stacked cards) below `sm:`, kept the grid table above it.
Also found `PersonEditor`'s subject/class dropdowns missing `min-w-0` —
native `<select>` elements don't shrink below their content's width in a
flex row without it, a second real contributor to the same symptom.
Audited the whole project for both patterns (fixed-column grids without
a mobile breakpoint; flex-1 inputs/selects without min-w-0) — these were
the only instances. Added `overflow-x: hidden` on `html`/`body` in
`globals.css` as a backstop regardless.

**Teacher accounts now use a real invite-by-email flow, students a
4-digit PIN:**
- Creating a teacher (single or via bulk import) now calls Supabase's
  `inviteUserByEmail` instead of generating a password — no credential
  exists for the admin to share; the teacher gets an actual email, clicks
  it, and lands on the new `app/register/page.tsx` to set their own
  password, then routes to `/teacher` (or `/admin` if invited as an
  admin).
- Students dropped from a 6-digit to a 4-digit PIN, still admin-generated
  and shown once.
- **Needs one manual step to actually work**: Supabase → Authentication →
  URL Configuration → **Redirect URLs** needs the deployed domain's
  `/register` path added (e.g. `https://your-app.vercel.app/register`),
  or invite links will fail to redirect. Also worth knowing: Supabase's
  built-in email sender is rate-limited and meant for testing — a school
  actually inviting many teachers wants real SMTP configured under
  Authentication → Emails.

## Pass 5: the mobile overflow's actual root cause, and a resend-access action

**The mobile overflow bug had a specific, identifiable cause**, not just
"needs more responsive tweaking": iOS Safari auto-detects and auto-links
plain-text emails/phone numbers/dates in page content by default — which
is why the teacher's email rendered as an unstyled blue underlined link
in the screenshots, and very likely why its `text-overflow: ellipsis`
truncation broke (a known WebKit quirk: the auto-injected `<a>` tag
disrupts the parent's ellipsis calculation). Added `format-detection:
telephone=no, email=no, address=no, date=no` to the root layout's
metadata, which disables this globally in one place rather than needing
a per-component workaround.

**Audited every list-row-with-action-buttons pattern in the app** for the
underlying structural risk (name/email text competing horizontally with
multiple buttons in a row that doesn't stack on mobile) — `PeopleManager`
was the only one actually broken (4 possible buttons + two lines of
often-long text), but rebuilt it and 4 other, lower-risk rows
(`AcademicsManager`'s classes/subjects, `LabBatchesManager`'s
templates/rooms) to stack vertically below `sm:` regardless, since a
`ReportCardsManager` row already used this pattern from the start and it
held up fine.

**Added a real "resend access" action** for teacher rows — sends a
password-reset email (via `resetPasswordForEmail`, which works whether
or not the account already has a password) and reuses the existing
`/register` page to complete it. This is the actual fix for "the
credentials I set aren't working": the account's own history in
`auth.users` showed a password *was* set successfully once already — the
issue was a forgotten/mistyped password, not a broken flow, and there
was previously no way to recover from that without me manually
intervening in the database. Now there is.

## Pass 6: a real session race condition in /register, not account confusion

**What looked like password confusion was an actual bug.** `/register`
called `supabase.auth.getUser()` immediately on mount, assuming it would
reflect whichever invite/recovery link was just clicked. It doesn't
reliably — the token lives in the URL's hash fragment, which Supabase's
client parses *asynchronously*, and an immediate `getUser()` call can
race that process and resolve using whatever session already existed in
cookies instead (e.g. an admin still logged in on the same device).
That's exactly what happened: clicking a teacher's invite link while
already signed in as admin showed — and let the form overwrite the
password for — the *admin* account instead of the invited teacher's.

Fixed by never trusting an ambient session on this page: if the URL has
no invite/recovery token at all, the page shows "invalid link" rather
than falling back to whoever's already logged in; if it does, the page
waits specifically for the `SIGNED_IN`/`PASSWORD_RECOVERY` auth event
that fires once Supabase finishes processing *that* token, instead of
racing it.

**The admin account's password was reset directly** (via SQL, since the
UI path was untrustworthy until the fix above landed) to a known value —
see the conversation for what it was set to; change it once back in.

**Still open**: data (teachers/students/subjects) not showing up in admin
list pages even though it demonstrably exists in the database — ruled
out RLS policies (checked live, correct), the query code in both
`app/admin/people/page.tsx` and `app/admin/academics/page.tsx` (clean),
and an in-app-browser cookie theory (reproduced in plain Chrome too).
Current best lead is a stale session cookie from one of the admin
account's several recreations during this debugging — needs a genuinely
fresh sign-out/sign-in to confirm or rule out.

## Pass 7: the actual root cause — infinite recursion in current_role_is()

**Found it, definitively, by simulating the exact RLS-bound request the
app makes** (`set role authenticated` + a forged JWT claim, then running
the same query) rather than continuing to guess from symptoms. It
crashed with `stack depth limit exceeded`.

The bug: `current_role_is()` — the helper nearly every admin-facing RLS
policy calls to check "is this caller a super_admin" — queries `users`
internally. That internal query is *itself* subject to `users`' own RLS
policies, one of which (`admin_full_access_users`) calls
`current_role_is()` to decide access. Evaluating the function invokes
the function. Forever, until Postgres's stack overflows. This wasn't
limited to the `users` table — **every table whose policies reference
`current_role_is()`** hit the same crash, which by this point in the
build was most of the schema.

Two things compounded it into "empty lists with no visible error"
instead of an obvious crash:
- Writes going through the API routes (`/api/admin/people`, the exam-
  session routes, grading) use the **service-role client**, which
  bypasses RLS entirely — so those never triggered the recursion and kept
  working, which is exactly why creating accounts worked while the list
  showing them back didn't.
- Nearly every direct `supabase.from(...)` call in the admin/teacher
  pages destructured only `data`, discarding `error` — so when a query
  *did* hit the crash, the code treated the failed call as empty data
  instead of surfacing Postgres's actual error message.

**Both are fixed.** `current_role_is()` is now `SECURITY DEFINER` (the
standard Postgres fix for exactly this "RLS policy function queries its
own protected table" pattern), which runs its internal check with the
function owner's privileges, bypassing RLS for that one check and
breaking the cycle. Verified by re-running the same simulated request —
clean result, no crash. Separately, added `lib/supabaseErrors.ts`
(`orThrow`) and applied it across every write call in `app/admin/**` and
`app/teacher/**` that wasn't already checking `error`, so a real failure
shows up as a message in the UI instead of silently doing nothing —
this exact failure mode is what let the recursion bug hide as long as
it did.

**Also fixed while investigating:** `/register` had a second, genuine
bug — mail security scanners (common in schools/enterprises) "click"
links in emails to scan them for safety, which consumes Supabase's
one-time invite/recovery token before the real user gets to it. Added a
manual code-entry fallback (`supabase.auth.verifyOtp`) for when the link
itself comes back invalid. **Requires a one-time dashboard change this
code can't make itself**: Supabase → Authentication → Email Templates →
add `{{ .Token }}` to both the "Invite user" and "Reset Password"
templates, or there's no code for the fallback form to check against.

## Pass 5: replaced the invite/reset flow entirely with custom tokens

The scanner-eats-the-token problem above was worked around, not fixed —
it still relied on Supabase Auth's invite/recovery links, which are
consumed the instant they're *opened*, scanner or not. Replaced that whole
mechanism:

- New `access_tokens` table (`database/migrations/002_access_tokens.sql`)
  stores a hashed, single-use token per purpose (`invite` / `reset`) with
  its own expiry. See `lib/accessTokens.ts`.
- The token is only ever consumed when a password is actually submitted
  (`app/api/auth/set-password`, `app/api/auth/reset-password`) — never on
  page load. Opening the link does nothing, so a scanner opening it first
  no longer matters at all. No dashboard email-template change needed
  anymore, and the old manual code-entry fallback is gone since there's
  nothing left for it to work around.
- Teacher accounts are created directly (`admin.auth.admin.createUser`
  with a random, never-shared password) instead of via
  `inviteUserByEmail`; the real invite email is sent by us, via SMTP
  (`lib/mailer.ts`, provider-agnostic — configured for SendGrid via
  `SMTP_*` env vars, see `.env.example`), using our own branded template
  (`lib/emailTemplates.ts`).
- `resetPasswordForEmail` in `resend-access` is replaced the same way —
  issues a fresh `reset`-purpose token and emails it directly.
- `/register` (with its race-condition/stale-listener/fallback-tab fixes
  from earlier passes) is removed entirely, replaced by two simpler,
  purpose-specific pages: `/set-password` (new teacher) and
  `/reset-password` (existing teacher, admin-triggered). Neither needs any
  of the `onAuthStateChange` / hash-fragment handling `/register` needed,
  because there's no Supabase Auth session-from-URL step left to race.

## Pass 6: results publishing, dark mode, site theming, math rendering, bulk question import

A much larger batch of work than earlier passes — grouped here by area
rather than strictly chronologically, since that's more useful to read
back later. Everything below is live and has been deployed; see each
section for what's genuinely tested vs. best-effort.

### Results publishing & exam integrity
- **Admin couldn't see or publish any results, ever** — `results` had RLS
  policies for students (their own, published only) and teachers (their
  own exams), but none for admins at all, so the Admin → Results page's
  queries silently returned zero rows under RLS (not an error — just
  nothing). Fixed with an `admin_manage_results` policy
  (`database/migrations/003_admin_access_to_results.sql`).
- **Student exam page crashed (infinite "Loading…", no error) once
  results actually started getting published** — `fetchExamMaxScores`
  computed a question bank's point total by joining into `questions`
  directly, which students have no RLS access to (it holds answer keys).
  The joined field came back `null`, and `.points` on `null` threw, with
  no try/catch anywhere in the chain. Fixed by caching `max_score`
  directly on `exams`, kept in sync by triggers whenever questions change
  (`database/migrations/004_exam_max_score_cache.sql`) — reading a plain
  column students already have access to, instead of needing a grant
  that couldn't safely be given. Also added `components/layout/ErrorState.tsx`
  and wrapped page loaders in try/catch generally, so a future failure
  shows a retry button instead of hanging forever.
- **Class Analytics pass rate was silently always 100%, permanently, for
  any exam where that happened once** — `pass_mark` could be saved as `0`
  (clearing the field in the exam builder turned it into `0`, not an
  error, and nothing validated it), and `score% >= 0` is trivially true
  for every score. Fixed with a builder-side validation and a DB
  constraint (`exams_pass_mark_range`,
  `database/migrations/005_exam_pass_mark_guard.sql`) requiring
  `0 < pass_mark <= 100`.
- **A student flagging a question during the exam went nowhere** —
  `student_answers.is_flagged` was captured at submit time but nothing
  ever displayed it. Added `components/teacher/StudentReview.tsx`, a
  full per-student review screen (every question, their answer vs.
  correct, points, flagged badge) opened by tapping a submitted student
  in the exam roster.
- **New: teacher-controlled student review.** `exams.allow_review`
  (`database/migrations/006_exam_allow_review.sql`) lets a teacher allow
  students to see which answers were right after an exam ends —
  independent of `show_result_instantly` (that only reveals the score).
  Gated server-side (`app/api/exam-sessions/review`) on every batch of
  the exam having ended, not just the requesting student's own sitting —
  otherwise an early finisher could leak correct answers to classmates
  who haven't sat it yet.
- **Device clock can't be trusted for "is this exam open."** A wrong or
  deliberately fast-forwarded device clock could hide a genuinely open
  exam, or make a closed one *look* available (though not actually start
  it — `app/api/exam-sessions/start` already validated against the
  server's own clock). `app/api/server-time` + `lib/serverTime.ts` now
  correct the student-facing display for this too, by computing the
  offset from the server's clock once per page load.
- **Editing any field on a question broke once a student had answered
  it** — saving unconditionally deleted and reinserted every option on
  every save, and `question_options.id` is what
  `student_answers.selected_option_id` points to. Fixed with a proper
  diff (update existing options in place, insert only new ones, delete
  only removed ones — and if a removal itself is blocked by that same
  foreign key, it's kept with a message instead of failing the whole
  save) in `app/teacher/questions/page.tsx`'s `syncOptions`.
- Question editor: typing into the last option now appends a fresh empty
  one automatically (capped at 8), and any option left empty on save is
  silently dropped — no more repeated taps on "Add option".

### Dark mode, site accent color, and a few real bugs found along the way
- Full light/dark/system toggle (`lib/colorScheme.ts`,
  `components/ColorSchemeSync.tsx`), per-person and stored in the
  browser — covers the shared chrome, all three portals' main pages, the
  exam-taking screen, grading, question bank, admin pages, and the
  pre-login screens. **Known bug found and fixed along the way**: an
  early broad regex sweep matched `bg-crimson-600` even inside unrelated
  hover-only classes and wrongly changed 13 files' worth of icon
  buttons' resting-state text color — now corrected.
- **Site accent color is fully admin-configurable**, not fixed to the
  original crimson — `lib/themes.ts` generates a full 50–900 shade ramp
  from a single chosen color at read time. Originally shipped as an open
  color picker; **changed back to a curated, fixed palette of 18 colors**
  on request, since an arbitrary color (especially something pale, or
  even white) made some button text unreadable. That contrast problem
  is now fixed at the root either way: `getOnAccentColor()` picks
  whichever of white or near-black text actually has better WCAG
  contrast against the chosen color, exposed as `--color-on-crimson` /
  the `on-crimson` Tailwind color, used by every button/badge instead of
  a hardcoded `text-white`.
- Admin Settings and the exam-taking question column were both capped at
  a flat ~672px width regardless of screen size, which read as "stuck in
  mobile layout" on a real desktop monitor — widened for large screens.
  The student exam-card grid had the same issue for a different reason
  (a 3-column grid with 1 card leaves two dead equal-width tracks) —
  switched to `flex-wrap` with a fixed-ish card width instead.

### Math formula rendering
- `lib/mathDetect.ts` auto-detects math inside ordinary prose with zero
  required markup (`x^2`, `H_2O`, `sqrt(16)`, whole equations like
  `2x + 5 = 11`), rendered via KaTeX (`components/common/MathText.tsx`).
  An explicit `\(...\)` or `$...$` always works as a trusted override for
  anything the heuristic doesn't catch. Wired into every place a
  question/option/reference-answer is shown: question bank, exam
  builder, the live exam screen, grading, both review screens — plus a
  live preview while typing in the question editor.

### Bulk question import (Word or CSV)
- First version assumed the wrong document shape entirely (numbered
  question, options each on their own lettered line) — **rebuilt against
  two real exam documents** once available, which actually use Word's
  own auto-numbering (never appears in extracted text at all) with every
  option inline on the same line as the question
  (`"...is A. Newton B. Pascal-second C. Joule D. Watt"`). Verified
  against those two real files: 60/60 and 51/51 objective questions
  correctly split, up from "didn't parse at all" and "4 questions, all
  wrong" respectively. Full detection + reasoning in
  `lib/questionImportParser.ts`'s file header.
- Deliberately never guesses which option is correct — parsing only
  extracts prompt + option text; a teacher taps the correct answer for
  every question on a review screen before anything saves, same as
  creating one by hand.
- Diagrams in the source `.docx` are detected per-question and flagged
  (mammoth tags every image's position during extraction — see
  `app/api/teacher/questions/parse-import` and
  `lib/mammothHtmlToText.ts`); Word's native Equation Editor objects
  don't survive text extraction at all and get one upfront notice
  instead of an unreliable per-question flag.
- **Known, accepted limitation**: multi-part theory/essay questions (a
  numbered question with lettered or `i./ii./iii.` sub-parts) get
  grouped into one combined free-response question rather than split —
  there's no reliable marker to split them further. Expect more manual
  cleanup on a theory-heavy import than an objectives-heavy one.
- **Review progress is no longer lost if you close before finishing.**
  Closing the review screen mid-way saves it as a resumable batch
  (`question_import_batches` table, RLS-scoped to the owning teacher) —
  shows up under a "Reviewing" section at the top of the Question Bank,
  tap "Resume" to pick back up exactly where you left off.
- **Every question from one import shares an `import_group_id` /
  `import_group_label`** (`questions.import_group_id`,
  `database/migrations/008_question_import_grouping_and_batches.sql`),
  so a 60-question import shows as one collapsible "Subject — Class"
  entry in the bank instead of 60 separate rows crowding out hand-typed
  questions — and in the Exam Builder's question picker, the whole group
  can be added to an exam in one tap instead of 60 individual ones.

## Still to build (continued; historical)
- Bulk question import's theory/essay-section splitting is best-effort
  only — see above. Worth revisiting with more real documents if a
  teacher hits a case it handles badly.
- No way yet to pull *individual* questions back out of an import group
  once grouped (e.g. "I only want 12 of these 60 in this exam, not all
  of them") without expanding the group in the bank and adding them one
  at a time from there — the Exam Builder's picker only offers
  "add the whole group" or the normal one-at-a-time flow for ungrouped
  questions.
- The original `teacher_subjects` gap noted above (teacher creation not
  collecting which *classes* a subject is taught to) is still open —
  unrelated to anything in this pass.
- Vercel's GitHub auto-deploy integration has intermittently stopped
  firing on push at least twice during this project (no error on either
  side — GitHub just never notifies Vercel), requiring a manual
  redeploy to recover each time. Worth a Vercel Support ticket if it
  keeps recurring; nothing in this codebase can detect or fix that from
  the outside.

## Pass 8: picking single questions from an import group, Storage uploads, bulk-import reporting, teacher-owned questions

- **Import review screen**: "Add question" (header + bottom of list) for
  questions not in the original file; switching a question to multiple
  choice now shows blank option fields, with a new one appearing as each
  last field is filled (same behaviour as the single-question form). Blank
  options are dropped on save; multiple choice needs 2+ filled options and a
  correct one.
- **Teacher isolation**: verified live RLS on `questions`, `question_options`
  and `question_import_batches` was already owner-only, with no cross-teacher
  data. `database/migrations/009_exam_questions_ownership_check.sql` closes
  the one gap found — a teacher could attach someone else's question to
  their own exam through the API.
- **Exam Builder**: import groups now expand to pick individual questions
  ("Add all" still adds the whole group). This also fixes a bug where
  `lib/useTeacherExamFormData.ts` never fetched `import_group_id`/`label`,
  so groups never actually appeared in the Exam Builder.
- **Supabase Storage** (`database/migrations/010_storage_buckets.sql`):
  `question-images` (teachers write only inside their own `<user id>/`
  folder, 5 MB) and `school-assets` (admin-only, 2 MB, PNG/JPEG only because
  the report-card PDF renderer can't draw SVG/WebP). Both public-read.
  `lib/uploadImage.ts` validates, downsizes large phone photos, uploads, and
  returns the public URL. Images are uploaded when picked, so a picture
  chosen and then abandoned leaves an orphaned file — harmless, tiny.
- **Report cards now actually use the Settings school profile** (name,
  motto, address, logo). `lib/reportCard.ts` previously used a hardcoded
  stand-in and ignored `school_profile` entirely.
- **People bulk import**: failed rows are listed by name/ID with a plain
  reason, and "Retry failed" resends only those — rows that went through are
  never resent (previously a retry resubmitted everything and the successes
  failed as duplicates).

### Still open (Pass 8; historical)
- ~~Report card fonts~~ — resolved twice: first built-in Helvetica (Latin-1 only), then (Pass 12) the bundled
  Liberation Sans so ẹ ọ ṣ ị ụ ɓ ɗ ƙ and tone marks print (`lib/reportFonts.ts`, `next.config.ts`).
- Leaked Password Protection (Supabase dashboard) and the Vercel auto-deploy
  ticket remain manual.

## Pass 9: multi-tenant SaaS, owner console, self-signup, safety nets

- **Multi-tenant platform** (migrations 011–014): `schools` table, `school_id` on all 22 tenant tables, composite foreign keys, tenant-scoped RLS and storage, per-school uniqueness of student IDs / staff IDs / subject codes (one email = one school), default grading scale for new schools. Verified with a rolled-back dry run (33/33 isolation checks) and a verified rollback script.
- **Server routes** (`lib/auth/callerContext.ts`): every service-role route scopes by the caller's school; the grading route reads only that school's grading scale; student login emails now include the school code (`<code>.<id>@students.internal`) — existing students keep their stored emails.
- **Branding everywhere comes from `schools`** (`lib/schoolBranding.ts`, `components/SchoolProvider.tsx`, `lib/useSchoolProfile.ts`): sidebar, headers, report cards, emails; per-school accent colour and **background (secondary) colour** (Settings has both pickers). `/s/<code>` pages are branded server-side.
- **Owner console** (`/owner`): schools list with counts, add a school (with invite-link fallback if email fails), approve / suspend / reactivate, copy link, **delete a whole school** (type its code to confirm; refused during a live exam; irreversible), clear old unconfirmed sign-ups, owner Settings (own theme + background).
- **School self-signup** (`/register-school` → `/verify-school`): school stays pending with its admin banned until the email is confirmed; the owner approves (refused if email unconfirmed) and the admin is emailed their school link.
- **Suspend = sign everyone out** (migration 020): suspending ends every sign-in at that school immediately; open pages notice within ~30 s (or when the tab returns) and land on the school's "access is paused" page.
- **Abuse protection** (migrations 018–019): honeypot + per-IP limits on signup, per-IP/per-email limits on resend, failed-lookup limit on the student-ID check (misses only — a class shares one Wi-Fi), optional Turnstile, and a fix so `%`/`*` can no longer match every student ID.
- **Photo editor** (`components/ui/ImageCropModal.tsx`): after choosing a logo → round WhatsApp-style crop (saved as a transparent-cornered PNG); question diagrams → framed crop with shapes, rotate, flip, zoom. No new packages; animated GIFs skip it.
- **Bell** (`lib/useActionItems.ts`): live "needs your attention" list per role (owner: approvals; admin: results to publish, batches today; teacher: answers to mark, batches today; student: upcoming exams, recent results).
- **Email**: moved from SendGrid (trial ended) to Brevo; `docs/MULTI_TENANT_BACKEND.md` has the details.

## Pass 10: dark-mode audit and fixes

- **Paused/pending school notice** (`app/s/[schoolCode]/layout.tsx`) used dark text with no dark-mode colour, so it was nearly invisible on the dark background — fixed.
- **Form fields** had no background set, so in dark mode they stayed browser-white (the password eye icon, light grey in dark mode, vanished against them). A zero-weight base rule in `app/globals.css` now gives every text box, text area and dropdown a proper dark default (any field that styles itself still wins), and `color-scheme: dark` makes native controls follow.
- **Exam screens** (`ExamInterface`, student exam page): full-screen cream backgrounds had no dark variant, leaving white text on cream for a student in dark mode — fixed. Same for the teacher/admin/register screens flagged by the audit (about 40 class strings across 11 files).
- **Accent text** (the school's dark-red accent used as text/icons/badges) is hard to read on dark: one rule in `globals.css` now lightens it in dark mode on elements that don't set their own dark colour.
- Deliberately left as-is: the printable report-card "paper" (always light) and the white button on the always-dark photo editor.
- Audit method: `python3` scan of every `className` string for `bg-white`, `text-ink`, `border-black/…`, `bg-background-muted`, `bg-cream-*`, coloured text and unstyled form fields, with and without a `dark:` counterpart. Rerun it after adding screens.

## Pass 11: security hardening (migration 021)

- The Supabase security advisor found real exposure created during the multi-tenant work, now closed:
  `mt_backup_ddl` (the pre-multi-tenant rule backup) was readable by the public API — RLS enabled and all
  public access revoked; the trigger/internal functions (`set_school_id_default`, `seed_school_defaults`,
  the two max-score triggers, and especially `recompute_exam_max_score(uuid)`, which let any caller
  recompute any school's exam) are no longer callable over the API; the RLS helper functions
  (`current_role_is`, `current_user_*`) are no longer callable by signed-out visitors; two trigger
  functions got a fixed `search_path`.
- Verified in a rolled-back dry run before applying: a teacher still reads/writes questions and exams
  (all triggers fire), a student still reads their exams, signed-out visitors are refused,
  `get_school_branding` still works for the login page, the server still recomputes scores,
  and a newly activated school still gets its default grading scale.
- What the advisor still lists is intentional: `access_tokens`, `rate_limits`, `mt_backup_ddl` have RLS with
  no policies on purpose (service role only); `get_school_branding` is public for login pages; the
  remaining signed-in-callable functions are the RLS helpers, `get_user_school_id`, and the owner-only
  `platform_school_stats`.

## Pass 12: Owner Command Center, support desk, staff password reset (migrations 022–028)

**What was built** (all owner-facing pages are under `/owner`; every owner-level change is written to the audit log
*first* — if the record can't be written, the action is not performed):
- **Live overview + Exam Radar** (`/owner`, `components/owner/OwnerTelemetry.tsx`, `/api/owner/telemetry`, migration 026):
  active schools, total students, live exams now (+ students writing), submitted today; the exams running right now;
  a privacy-safe feed (school + role only — never a student's name or id). Polls every 10 s while the tab is visible.
  Definitions: *total students* = active student accounts in active schools; *live exam* = published exam inside a
  scheduled batch window, or with a student actively writing; *writing* = session still `active` with a heartbeat in
  the last 30 min; *today* = the owner's local midnight. Sign-ins are recorded by `POST /api/auth/track-login`
  (called by the login screen; one entry per person per 10 min; stores school + role only).
- **Broadcasts** (`/owner/broadcasts`, migration 024): title, message, importance, audience (admins & teachers /
  admins / teachers), all schools or chosen schools, optional schedule and end time. **Edit** (live or scheduled ones; a live
  broadcast keeps its start time; tick "show again" to re-show it to people who already closed it) and **Reuse** (loads an
  old broadcast — ended or not — into the composer as a fresh one that starts now) are on each card; dismissible banners in
  `components/layout/AnnouncementBanner.tsx` (up to 3, most urgent first, dismissal remembered per person).
- **Support desk** (`/owner/support`, `/admin/support`, `/teacher/support`, migrations 025 + 027): one-way tickets
  (subject, category, priority, message, up to 3 screenshots, shrunk in the browser; stored privately). The owner
  writes one reply + a status (open / in progress / resolved); the school is emailed (sender, header and footer use
  the **school's name**; a teacher's ticket also emails that school's admins). A teacher sees only their tickets; an
  admin sees the whole school's. **Alerts**: the owner's bell + sidebar badge stay on while a ticket is open or in
  progress; admins/teachers are alerted when the owner moves their ticket to in progress / resolved or replies, until
  they open Help & Support (`lib/supportAttention.ts`, `/api/support/attention`, `/api/support/seen`).
- **Emergency controls** (`/owner/controls`, migration 023): **maintenance mode** (everyone except the owner sees
  `/maintenance`; APIs answer 503; students already in an exam keep access to the exam page + exam APIs for as long as
  their session is active with a heartbeat in the last hour; fails open if the flag can't be read) and **school
  sign-ups** (page shows "paused" and `/api/schools/register` refuses). Switch changes reach every server instance
  within ~5 s. *Caveat*: maintenance blocks the app's pages and API routes — requests the browser sends straight to
  Supabase are not blocked (that is what keeps a mid-exam student's page working).
- **Security** (`/owner/security`): the `rate_limits` counters with a Blocked label and a Clear action. The allowances
  shown are **copied** into `app/api/owner/security/rate-limits/route.ts` (`RULES`) — if you change a limit in the
  routes that enforce it, change it there too.
- **Audit log** (`/owner/audit-logs`, migration 022): append-only (triggers refuse UPDATE/DELETE/TRUNCATE for
  everyone), hash-chained, with a "Verify integrity" button. Logged: school create/approve/suspend/reactivate/delete
  (a delete records *started* before anything is erased, then *completed/failed*), stale sign-up clean-ups, maintenance
  and sign-up switches, broadcasts, support replies/status changes, rate-limit clears.
- **Staff "Forgot password?"** (migration 028; `/api/auth/forgot-password`, `components/auth/LoginForm.tsx`): teachers and
  school admins of an active school get the existing 2-hour, single-use reset link by email. The answer is identical
  (and instant) whether or not the email exists; limits are 8/h per connection and 3/h per email; completing a reset
  signs the person out everywhere. The email says "We received a request to reset the password for your account" when
  the person asked themselves, and "Your admin … requested a password reset" only when an admin sent it from People
  (`requestedBy` in `resetEmailHtml`). Students have no email (name + ID); the owner recovers via the Supabase dashboard.
- **Email**: `lib/mailer.ts` now sends a plain-text version of every message (HTML-only mail is judged more harshly by
  spam filters). Emails other than support replies and password resets still use the platform sender name; the
  school-name sender is a one-line `fromName` change per route if wanted.

**Delivery workflow**: each update zip is cumulative (everything changed so far), `unzip -o <zip>` over the repo,
`npm run build`, commit, push. Migrations were applied to the live project by the assistant after a rolled-back dry run
and the owner's go-ahead.
- **Report-card fonts**: the PDF now uses the bundled Liberation Sans (`assets/fonts`, registered in `lib/reportFonts.ts`, shipped
  by `outputFileTracingIncludes` in `next.config.ts`) instead of Helvetica, so names with ẹ ọ ṣ (and Igbo / Hausa letters, with
  tone marks) print. Same letter widths as Helvetica, so the layout is unchanged; hyphenation is switched off so a break can never
  split a letter from its accent. If the font files are missing the PDF falls back to Helvetica and logs a server error.
- **School data export** (migration 030; `lib/schoolExport.ts`, `/api/owner/exports`, `/api/admin/exports`,
  `/api/exports/[id]/download`, `components/exports/SchoolExports.tsx`, owner page `/owner/exports`, admin Settings section):
  a ZIP of readable spreadsheets (`students.csv`, `staff.csv`, `results.csv`, `term_results.csv`), every table as
  `raw/<table>.csv`, `school.csv`, the logo + question images (`files/`, capped at 30 MB total / 5 MB each, the rest listed
  in `files/manifest.csv`) and a `README.txt`. Built in the background (`after()`, up to 60 s), saved in the private
  `school-exports` bucket (50 MB limit) and downloaded through a 5-minute signed link. The owner can export any school
  (button on each school card and inside the delete dialog — offered, never required); a school admin only their own.
  Kept 30 days, then removed the next time a list is opened (there is no scheduled job); exports of a deleted school
  stay downloadable for their 30 days. Max 3 exports per school per hour. Every export / download / removal is audit-logged
  before it happens. **What is exported is an allow-list** (`TABLES` in `lib/schoolExport.ts`): `users.pin_hash` and
  `student_exam_sessions.device_fingerprint` are deliberately left out, and a column added to a table later is NOT exported
  until it is added there. Text starting with `= + - @` gets a leading `'` so a spreadsheet can't run it as a formula, and
  each CSV starts with a UTF-8 marker so Excel shows Yoruba/Igbo/Hausa letters correctly. `lib/zip.ts` is a small
  dependency-free ZIP writer (tested against Python's `zipfile` and `unzip`).

