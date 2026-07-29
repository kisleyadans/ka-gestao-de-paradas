import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sharedState = sqliteTable("shared_state", {
  id: integer("id").primaryKey(),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull().default(1),
  globalRevision: integer("global_revision").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull().default("Operador PCM"),
});

export const syncMeta = sqliteTable("sync_meta", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull().default("Sistema"),
});

export const activityState = sqliteTable(
  "activity_state",
  {
    id: text("id").primaryKey(),
    payload: text("payload").notNull(),
    revision: integer("revision").notNull().default(1),
    globalRevision: integer("global_revision").notNull().default(1),
    position: integer("position").notNull().default(0),
    deleted: integer("deleted").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").notNull().default("Operador PCM"),
  },
  (table) => [
    index("activity_state_global_revision_idx").on(table.globalRevision),
    index("activity_state_position_idx").on(table.deleted, table.position),
  ],
);

export const activityAudit = sqliteTable(
  "activity_audit",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    activityId: text("activity_id").notNull(),
    activityRevision: integer("activity_revision").notNull(),
    globalRevision: integer("global_revision").notNull(),
    action: text("action").notNull(),
    changes: text("changes").notNull(),
    snapshot: text("snapshot").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("activity_audit_activity_idx").on(table.activityId, table.createdAt),
    index("activity_audit_global_revision_idx").on(table.globalRevision),
  ],
);

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  revision: integer("revision").notNull(),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull(),
});

export const authAttempts = sqliteTable("auth_attempts", {
  clientKey: text("client_key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
});
