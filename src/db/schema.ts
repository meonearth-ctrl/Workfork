// Database schema (Drizzle ORM, Postgres dialect — also used by PGlite locally).
// Shifts are stored as a calendar date plus minutes from that day's midnight in
// the location's local time, so overnight shifts simply end after minute 1440.
// Clock-in/out times are real instants (timestamptz).

import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "manager", "employee"]);
export const leaveType = pgEnum("leave_type", ["vacation", "sick", "unpaid", "other"]);
export const leaveStatus = pgEnum("leave_status", ["pending", "approved", "rejected", "cancelled"]);

// ── Organisation ─────────────────────────────────────────────────────────────
// A location also holds its planning parameters and labour rules.
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  openHour: integer("open_hour").notNull().default(8),
  closeHour: integer("close_hour").notNull().default(20),
  // Demand units (customers, orders, calls…) one person handles per hour.
  productivity: real("productivity").notNull().default(20),
  minStaff: integer("min_staff").notNull().default(1),
  minRestHours: real("min_rest_hours").notNull().default(11),
  maxDailyHours: real("max_daily_hours").notNull().default(10),
  maxWeeklyHours: real("max_weekly_hours").notNull().default(48),
  maxConsecutiveDays: integer("max_consecutive_days").notNull().default(6),
});

export const qualifications = pgTable("qualifications", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  locationId: integer("location_id").notNull().references(() => locations.id),
  jobTitle: text("job_title").notNull().default(""),
  contractHoursWeek: real("contract_hours_week").notNull().default(40),
  annualLeaveDays: integer("annual_leave_days").notNull().default(25),
  active: boolean("active").notNull().default(true),
});

export const employeeQualifications = pgTable(
  "employee_qualifications",
  {
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    qualificationId: integer("qualification_id").notNull().references(() => qualifications.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.qualificationId] })],
);

// ── Accounts ─────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("employee"),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "set null" }),
});

// Only a SHA-256 hash of the session token is stored, never the token itself.
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ── Planning ─────────────────────────────────────────────────────────────────
export const shiftTemplates = pgTable("shift_templates", {
  id: serial("id").primaryKey(),
  locationId: integer("location_id").notNull().references(() => locations.id),
  name: text("name").notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
  breakMinutes: integer("break_minutes").notNull().default(30),
  qualificationId: integer("qualification_id").references(() => qualifications.id, { onDelete: "set null" }),
  color: text("color").notNull().default("#3b82f6"),
});

export const shifts = pgTable(
  "shifts",
  {
    id: serial("id").primaryKey(),
    locationId: integer("location_id").notNull().references(() => locations.id),
    // Null = open shift that still needs someone.
    employeeId: integer("employee_id").references(() => employees.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    qualificationId: integer("qualification_id").references(() => qualifications.id, { onDelete: "set null" }),
    templateId: integer("template_id").references(() => shiftTemplates.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
    published: boolean("published").notNull().default(false),
  },
  (t) => [index("shifts_location_date").on(t.locationId, t.date), index("shifts_employee_date").on(t.employeeId, t.date)],
);

// Historic workload per hour, the input to demand forecasting.
export const demandHistory = pgTable(
  "demand_history",
  {
    id: serial("id").primaryKey(),
    locationId: integer("location_id").notNull().references(() => locations.id),
    date: date("date").notNull(),
    hour: integer("hour").notNull(),
    volume: real("volume").notNull(),
  },
  (t) => [uniqueIndex("demand_location_date_hour").on(t.locationId, t.date, t.hour)],
);

export const holidays = pgTable("holidays", {
  id: serial("id").primaryKey(),
  // Null = applies to every location.
  locationId: integer("location_id").references(() => locations.id),
  date: date("date").notNull(),
  name: text("name").notNull(),
});

// ── Time & attendance ────────────────────────────────────────────────────────
// endAt is null while the employee is clocked in.
export const timeEntries = pgTable(
  "time_entries",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    breakMinutes: integer("break_minutes").notNull().default(0),
    approved: boolean("approved").notNull().default(false),
    note: text("note").notNull().default(""),
  },
  (t) => [index("time_entries_employee_start").on(t.employeeId, t.startAt)],
);

// ── Absence ──────────────────────────────────────────────────────────────────
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    type: leaveType("type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: leaveStatus("status").notNull().default("pending"),
    reason: text("reason").notNull().default(""),
    decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leave_employee_dates").on(t.employeeId, t.startDate)],
);
