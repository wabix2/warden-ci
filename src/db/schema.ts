import { boolean, integer, jsonb, pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";

export const installations = pgTable("warden_installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  githubInstallationId: integer("github_installation_id").notNull().unique(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const repositories = pgTable("warden_repositories", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull(),
  githubRepositoryId: integer("github_repository_id").notNull().unique(),
  fullName: text("full_name").notNull(),
  defaultBranch: text("default_branch").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const policies = pgTable("warden_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().unique(),
  mode: text("mode").notNull().default("block"),
  minimumSeverity: text("minimum_severity").notNull().default("high"),
  blockSecrets: boolean("block_secrets").notNull().default(true),
  blockMaliciousPackages: boolean("block_malicious_packages").notNull().default(true),
  blockDangerousExec: boolean("block_dangerous_exec").notNull().default(true),
  requireCleanBaseline: boolean("require_clean_baseline").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const entitlements = pgTable("warden_entitlements", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull(),
  provider: text("provider").notNull().default("gumroad"),
  providerReference: text("provider_reference").notNull().unique(),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scanRuns = pgTable("warden_scan_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id").notNull(),
  githubDeliveryId: text("github_delivery_id").unique(),
  pullRequestNumber: integer("pull_request_number"),
  commitSha: text("commit_sha").notNull(),
  status: text("status").notNull().default("queued"),
  verdict: text("verdict"),
  findingsCount: integer("findings_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const findings = pgTable("warden_findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  scanRunId: uuid("scan_run_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  severity: text("severity").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  filePath: text("file_path"),
  lineNumber: integer("line_number"),
  remediation: text("remediation"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ uniqueFinding: unique().on(table.scanRunId, table.fingerprint) }));

export const auditEvents = pgTable("warden_audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull(),
  actor: text("actor").notNull(),
  eventType: text("event_type").notNull(),
  target: text("target"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { installations, repositories, policies, entitlements, scanRuns, findings, auditEvents };
