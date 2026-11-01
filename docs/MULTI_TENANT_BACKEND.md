# Multi-tenant: backend & query changes

Status: **migrations dry-run tested (33/33 isolation checks, rolled back); only `011` has been applied to the live database. `012`, `013`, `014` are waiting for your go-ahead.** Files: `database/migrations/011–014`,
`database/tests/multi_tenant_isolation_test.sql`, `lib/schoolBranding.ts`, `lib/schoolServer.ts`,
`components/SchoolProvider.tsx`, `app/s/[schoolCode]/layout.tsx`.

## The three layers of isolation

1. **RLS** — every policy requires `school_id = (select active_school_id())`. Browser queries therefore
   *cannot* cross schools, and a pending/suspended school sees nothing.
2. **Composite foreign keys** — `(school_id, subject_id) → subjects(school_id, id)` etc. A row can't point at
   another school's row even if code tries (including service-role code).
3. **Auto-fill + lock** — `school_id` is filled from the signed-in user on insert, and can never be changed.

## Browser queries (components, hooks) — almost no change

Because of (1) and (3), existing `supabase.from("questions").select(...)`, `.insert(...)` calls keep working
**unchanged**: reads are filtered by RLS, inserts get the caller's `school_id` automatically.
Only these change:

| Where | Change |
|---|---|
| `lib/useSchoolProfile.ts`, `app/admin/settings/page.tsx`, `app/admin/page.tsx` | read/write `schools` (own row) instead of `school_profile`; use `useSchool()` |
| `app/layout.tsx` | replace the `school_profile` theme fetch with `getCurrentSchoolServer()` + `<SchoolProvider initialSchool>` + `brandingStyleText()` |
| `lib/uploadImage.ts` | paths become `<school_id>/<user_id>/<file>` (question-images) and `<school_id>/<file>` (school-assets) — the storage policies require it |
| `tailwind.config.ts`, `app/globals.css` | `background` and the body color use `rgb(var(--color-secondary-rgb) / <alpha-value>)` instead of fixed `#fff7d3` |
| `app/admin/page.tsx`, `lib/reportCard.ts`, `app/layout.tsx` metadata | remove hardcoded "Soaring Fountain…" strings; use the school's name |

## Server routes using the service role (these bypass RLS — they MUST scope by hand)

Add one helper, `getCallerContext()`: reads the signed-in user, returns `{ userId, role, schoolId }`, and
**rejects if the school isn't active**. Every route below calls it first and then:

| Route | Must do |
|---|---|
| `api/admin/people` (POST), `bulk-import` | caller must be `super_admin`; pass `school_id: ctx.schoolId` on every `users` insert (there is no auto-fill for `users`); student internal email becomes `studentInternalEmail(schoolCode, id)` = `<code>.<id>@students.internal` |
| `api/admin/people` (PATCH/DELETE), `resend-access` | add `.eq("school_id", ctx.schoolId)` to every lookup, so an admin can't touch another school's person by guessing an id |
| `api/exam-sessions/start` | pass `school_id` on the `student_exam_sessions` insert; `.eq("school_id", ctx.schoolId)` on exam/batch lookups |
| `api/exam-sessions/answers`, `submit` | pass `school_id` on `student_answers` / `results` upserts; scope reads |
| `api/exam-sessions/review`, `api/student-answers/grade` | `.eq("school_id", ctx.schoolId)` on reads/updates |
| `api/auth/resolve-student-email` | body becomes `{ schoolCode, studentId }`; look the school up by code, then match `admission_number` **within that school** |
| `api/auth/reset-password`, `set-password`, `lib/accessTokens.ts` | tokens carry the user's `school_id`; emails use that school's name (`getSchoolNameServer` takes a school id) |
| `api/report-cards/...`, `lib/reportCard.ts` | read the **student's** school (name, motto, address, logo) instead of the hardcoded stand-in; scope every query |

If a service-role insert forgets `school_id`, the database rejects it (loudly) rather than guessing.

## New routes

- `app/s/[schoolCode]/…` — each school's entry point (`/s/soaring-fountain`). Move `login`, `register`,
  `set-password`, `reset-password` under it. After sign-in the portals stay at `/admin`, `/teacher`,
  `/student` (the school then comes from the user's account, not the URL, so URL tampering can't switch schools).
- `app/api/schools/register` — public self-signup: creates the auth user, a `pending` school, and its
  `super_admin` user. Rate-limited. The admin can't use anything until you approve (the database enforces it).
- `app/owner/…` + `app/api/owner/…` — platform-owner console: list schools (`platform_school_stats()`),
  approve (set `status='active'`, `approved_at`), suspend, add a school manually, edit a pending school's code.
  These routes verify `role = 'platform_owner'`, then use the service role for the status changes.
- `proxy.ts` — also redirect `platform_owner` away from the school portals, and everyone else away from `/owner`.

## Rollback (verified)

`012a_snapshot_original_schema.sql` copies your live pre-change security rules and constraints into a table
(`mt_backup_ddl`), straight from the database catalog. `012_rollback.sql` removes everything 012/014 added and
replays that backup. Dry run (apply 012 + 014, roll back, compare): policies, constraints, columns, indexes,
triggers, functions, tables, types and the data of users / questions / subjects / grading_scale / exams /
results / school_profile all came back IDENTICAL. Only valid while ONE school exists and before 013.

## Deploy order (so the live site never breaks)

1. Run the isolation test on a branch (or as a dry run) → all PASS.
2. Apply `011` (done), then `012a`, `012`, `014`. Take care: during the gap before the code is live, answer autosave, submit and exam start FAIL — only do this when no exam is open (none is today).
3. **Immediately** deploy the code above (until then, creating people/exam sessions from the app fails
   because those server routes don't send `school_id` yet; reading and browsing still work).
4. Apply `013` (drops the old `school_profile`).
5. Create your platform-owner account (separate from your school-admin account):
   create the auth user, then
   `insert into users (id, role, full_name, email, school_id) values ('<auth user id>', 'platform_owner', '<name>', '<email>', null);`

## Decisions made (from your answers)

- **School URLs**: `/s/<code>` per school, issued after approval; the code is locked once approved.
- **Roles**: `super_admin` stays = admin of ONE school; new `platform_owner` = you (separate account, no school, sees counts only).
- **Self-signup**: school name + admin name + email + password; the email must be **verified** before the request is accepted; the school then waits as `pending` until you approve it. You can also add a school manually from the owner console.
- **New school defaults (014)**: on approval it gets a standard grading scale — A 70–100, B 60–69, C 50–59, D 45–49, E 40–44, F 0–39 (remarks Excellent / Very Good / Good / Fair / Pass / Fail; D and E remarks are editable suggestions).
- **Existing student logins are NOT rewritten**: the login looks the student's email up by ID, so only *new* students get the `<code>.<id>@students.internal` form.
- **One email = one school**; student IDs, staff IDs and subject codes are unique per school.

## Done in this round (server side)

`lib/auth/callerContext.ts` (one shared "who is calling, which school" check, rejects pending/suspended schools),
and every service-role route now filters by the caller's school and sends `school_id` on inserts:
`api/admin/people` (POST/PATCH/DELETE), `bulk-import`, `resend-access`, `exam-sessions/{start,answers,submit,review}`,
`student-answers/grade` (which now reads only THIS school's grading scale — before, scales would have been mixed),
`auth/resolve-student-email` (optional `schoolCode`), `lib/accessTokens.ts`, `lib/studentCredential.ts`
(`studentInternalEmail(id, schoolCode)`), `lib/schoolProfileServer.ts` (by school id), `lib/uploadImage.ts` (school-scoped paths).

Branding (layout, sidebar, settings, login, report cards) still reads the old `school_profile` table, which 012
deliberately leaves in place — so the app is fully working for your one school until the branding phase below.

## Still to build (after the migrations are applied and these routes are live)

Edit the server routes listed above, the owner console, the `/s/<code>` login/register pages, the self-signup
flow with email verification, and swap the hardcoded school names for `useSchool()`.

## School self-signup (built)

`/register-school` (public) -> `POST /api/schools/register` creates the school as PENDING, its first admin with
sign-in BANNED until they confirm their email, and emails a confirmation link (`/verify-school?token=…`, token
type `verify`, consumed only on the button press, like invite/reset). `POST /api/schools/verify` lifts the ban and
emails the platform owner. The owner console shows pending schools with "email confirmed / not confirmed"; approval
is refused until the email is confirmed, then emails the admin their `/s/<code>` link (and hands the owner the link
to send by hand if the email fails). Pending/suspended schools are blocked at sign-in and, independently, by the
database (`active_school_id()`). `POST /api/schools/resend-verification` answers identically for any address.
Migrations: `013` (old school_profile dropped), `015` (`verify` token type) — both applied.

## Abuse protection on public endpoints (built)

Public endpoints and their limits (counts live in the `rate_limits` table via `rate_limit_hit()`, migration 018; the
limiter fails OPEN so a broken limiter never locks real people out):

| Endpoint | Protection |
|---|---|
| `POST /api/schools/register` | hidden honeypot field; 5 sign-ups per IP per hour; optional Cloudflare Turnstile; global cap of 30 pending sign-ups per hour as a last resort |
| `POST /api/schools/resend-verification` | 5 per IP and 3 per email per hour; answers identically whether or not it sent |
| `POST /api/auth/resolve-student-email` | only MISSES are counted (100 per IP per 10 minutes; a class often shares one Wi-Fi address); exact ID match via `resolve_student_login()` (migration 019) so wildcards like `%` or `*` match nothing |

**Turnstile (optional, free):** create a widget at Cloudflare -> Turnstile, add your site's hostname(s), copy the keys, then in
Vercel set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET_KEY` (secret) and redeploy. With no keys set the check is skipped.
