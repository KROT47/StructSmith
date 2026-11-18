-- Generated from schema.ts with bun run db:schema.
CREATE TABLE `activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_activity_workspace` ON `activity` (`workspace_id`,"id" desc);
CREATE TABLE `boundaries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`view_id` text NOT NULL,
	`parent_boundary_id` text,
	`kind` text NOT NULL,
	`layer` text DEFAULT 'deployment' NOT NULL,
	`classification` text,
	`name` text NOT NULL,
	`description` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`properties_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`view_id`) REFERENCES `views`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_boundary_id`) REFERENCES `boundaries`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_boundaries_workspace` ON `boundaries` (`workspace_id`);
CREATE INDEX `idx_boundaries_view` ON `boundaries` (`view_id`);
CREATE INDEX `idx_boundaries_parent` ON `boundaries` (`parent_boundary_id`);
CREATE TABLE `boundary_members` (
	`boundary_id` text NOT NULL,
	`element_id` text NOT NULL,
	PRIMARY KEY(`boundary_id`, `element_id`),
	FOREIGN KEY (`boundary_id`) REFERENCES `boundaries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `elements` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`role` text,
	`name` text NOT NULL,
	`description` text,
	`technology` text,
	`external` integer DEFAULT 0 NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`properties_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_elements_workspace` ON `elements` (`workspace_id`);
CREATE INDEX `idx_elements_parent` ON `elements` (`parent_id`);
CREATE TABLE `record_links` (
	`record_id` text NOT NULL,
	`element_id` text NOT NULL,
	PRIMARY KEY(`record_id`, `element_id`),
	FOREIGN KEY (`record_id`) REFERENCES `records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content_md` text,
	`status` text DEFAULT 'open' NOT NULL,
	`severity` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_records_workspace` ON `records` (`workspace_id`);
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_element_id` text NOT NULL,
	`target_element_id` text NOT NULL,
	`description` text,
	`technology` text,
	`interaction_style` text DEFAULT 'sync' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`properties_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_relationships_workspace` ON `relationships` (`workspace_id`);
CREATE INDEX `idx_relationships_source` ON `relationships` (`source_element_id`);
CREATE INDEX `idx_relationships_target` ON `relationships` (`target_element_id`);
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer NOT NULL,
	`label` text NOT NULL,
	`source` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_snapshots_workspace` ON `snapshots` (`workspace_id`,"created_at" desc);
CREATE TABLE `view_elements` (
	`view_id` text NOT NULL,
	`element_id` text NOT NULL,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`width` real,
	`height` real,
	`hidden` integer DEFAULT 0 NOT NULL,
	`locked` integer DEFAULT 0 NOT NULL,
	`z_index` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`view_id`, `element_id`),
	FOREIGN KEY (`view_id`) REFERENCES `views`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `view_relationships` (
	`view_id` text NOT NULL,
	`relationship_id` text NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`label_position` real,
	`control_points_json` text DEFAULT '[]' NOT NULL,
	`presentation_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`view_id`, `relationship_id`),
	FOREIGN KEY (`view_id`) REFERENCES `views`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`relationship_id`) REFERENCES `relationships`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `views` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`scope_element_id` text,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scope_element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX `idx_views_workspace_key` ON `views` (`workspace_id`,`key`);
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`mode` text DEFAULT 'relaxed' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
