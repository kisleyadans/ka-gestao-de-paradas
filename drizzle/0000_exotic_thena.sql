CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`client_key` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text DEFAULT 'Operador PCM' NOT NULL
);
