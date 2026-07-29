CREATE TABLE `activity_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`activity_id` text NOT NULL,
	`activity_revision` integer NOT NULL,
	`global_revision` integer NOT NULL,
	`action` text NOT NULL,
	`changes` text NOT NULL,
	`snapshot` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_audit_activity_idx` ON `activity_audit` (`activity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_audit_global_revision_idx` ON `activity_audit` (`global_revision`);--> statement-breakpoint
CREATE TABLE `activity_state` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`global_revision` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text DEFAULT 'Operador PCM' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_state_global_revision_idx` ON `activity_state` (`global_revision`);--> statement-breakpoint
CREATE INDEX `activity_state_position_idx` ON `activity_state` (`deleted`,`position`);--> statement-breakpoint
CREATE TABLE `sync_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text DEFAULT 'Sistema' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `shared_state` ADD `global_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `shared_state`
SET `global_revision` = `revision`
WHERE `id` = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `activity_state`
  (`id`, `payload`, `revision`, `global_revision`, `position`, `deleted`, `updated_at`, `updated_by`)
SELECT
  CAST(json_extract(item.value, '$.id') AS text),
  item.value,
  1,
  state.`global_revision`,
  CAST(item.key AS integer),
  0,
  state.`updated_at`,
  state.`updated_by`
FROM `shared_state` AS state, json_each(state.`payload`, '$.activities') AS item
WHERE state.`id` = 1
  AND json_extract(item.value, '$.id') IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `sync_meta` (`id`, `revision`, `updated_at`, `updated_by`)
SELECT 1, `global_revision`, `updated_at`, `updated_by`
FROM `shared_state`
WHERE `id` = 1;
