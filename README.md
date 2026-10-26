# Workforce Planner

Workforce management for shops, warehouses and service teams: **shift scheduling**,
**demand forecasting**, **time & attendance** and **leave management** in one web app.

| Module | What it does |
|---|---|
| **Schedule** | Weekly roster grid; shift templates; drafts vs published; open shifts; one-click **auto-planning** from the forecast; live labour-rule checks (overlaps, minimum rest, max hours per day/week, consecutive days, qualifications, approved leave, contract hours); staffing coverage per day. |
| **Forecast** | Workload per hour forecast from history (same weekday, recency-weighted, damped trend, holidays closed) → people needed per hour → compared with the plan. Hourly chart, week overview, CSV import of history. |
| **Time** | Clock in/out, manual entries, statutory breaks (>6 h → 30 min, >9 h → 45 min), daily target from contract hours, overtime balance, manager approval. |
| **Leave** | Vacation, sick, unpaid and other leave; working-day counting with holidays; yearly balance checks; approvals that show who else is away; team calendar (colleagues see "away", only managers see the reason). |
| **Admin** | Employees, contracts, qualifications, logins and roles (employee / manager / admin); location settings, labour rules, templates, holidays. |

## Quick start (local, no database needed)

```bash
npm install
npm run dev          # creates ./.data/pglite with demo data, then starts http://localhost:3000
```

Demo logins (password `demo1234`):

* `manager@example.com` — store manager (plans, approves)
* `admin@example.com` — administrator (also manages roles)
* `ben.mueller@example.com` — employee (own schedule, time clock, leave)

`npm run db:reset` deletes the local database and creates fresh demo data.

## Production

1. Create a Postgres database (Supabase, Neon, RDS, your own server…).
2. Set environment variables:

   | Variable | Purpose |
   |---|---|
   | `DATABASE_URL` | Postgres connection string |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first administrator (password ≥ 12 characters), used only on first setup |
   | `LOCATION_NAME`, `TIMEZONE` | optional, first location (default "Main location", `Europe/Berlin`) |
   | `DATABASE_POOL_MAX` | optional, connection pool size (default 10) |

3. `npm run db:setup` — applies migrations and creates the location and administrator
   (no demo data; set `SEED_DEMO=1` if you want it). Safe to re-run on every deploy.
4. `npm run build && npm start` (or deploy to any Node host, e.g. Vercel, Render, Fly).

Sign in as the administrator, then add employees, shift templates and holidays under
**Employees** and **Settings**, and import demand history under **Forecast**
(`date,hour,volume` per line).

## Development

```bash
npm test             # unit tests for rules, forecast, auto-planner, time accounts, leave
npm run lint
npm run db:generate  # after changing src/db/schema.ts: writes a new SQL migration
```

Code map:

* `src/lib/domain/` — pure business logic (no database): `rules.ts`, `forecast.ts`,
  `autoschedule.ts`, `timeaccount.ts`, `leave.ts`, `dates.ts`; tested in `__tests__/`.
* `src/lib/data/` — database queries that feed the domain functions.
* `src/lib/auth/` — scrypt passwords, sessions (only a hash of the token is stored).
* `src/app/(app)/<module>/` — pages and Server Actions per module; every action
  re-checks the session and role.
* `src/db/schema.ts` — tables; `drizzle/` — SQL migrations; `scripts/setup.ts` — setup/seed.

Stack: Next.js 16 (App Router, Server Actions), React 19, TypeScript, Tailwind CSS 4,
Drizzle ORM, Postgres (PGlite locally), Vitest.

## Notes and limits

* Labour-rule defaults follow common EU/German practice (11 h rest, 10 h/day, 48 h/week);
  change them per location in Settings. They are planning checks, not legal advice.
* The forecast is deliberately simple and explainable. It needs a few weeks of history;
  with less, the schedule shows a warning.
* One location per manager in this version; admins see the first location.
