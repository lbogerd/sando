CREATE SCHEMA IF NOT EXISTS "sando";
--> statement-breakpoint
CREATE TYPE "sando"."agent_kind" AS ENUM('codex');--> statement-breakpoint
CREATE TYPE "sando"."audit_event_type" AS ENUM('agent.registered', 'host.registered', 'project.initialized', 'grant.requested', 'grant.approved', 'grant.denied', 'capability.executed', 'run.created', 'workspace.archived', 'sandbox.created', 'command.started', 'command.finished', 'artifact.uploaded', 'diff.created', 'sandbox.destroyed', 'grant.expired');--> statement-breakpoint
CREATE TYPE "sando"."grant_scope" AS ENUM('one_shot', 'project_window');--> statement-breakpoint
CREATE TYPE "sando"."grant_status" AS ENUM('pending', 'approved', 'denied', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "sando"."host_platform" AS ENUM('linux-wsl');--> statement-breakpoint
CREATE TYPE "sando"."network_mode" AS ENUM('none', 'default');--> statement-breakpoint
CREATE TYPE "sando"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TYPE "sando"."sandbox_runtime" AS ENUM('podman', 'docker', 'kubernetes');--> statement-breakpoint
CREATE TABLE "sando"."account" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sando"."agent" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"host_id" varchar(128) NOT NULL,
	"kind" "sando"."agent_kind" NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sando"."artifact" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"run_id" varchar(128) NOT NULL,
	"project_id" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"storage_key" text NOT NULL,
	"private" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sando"."audit_event" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"type" "sando"."audit_event_type" NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"project_id" varchar(128),
	"host_id" varchar(128),
	"agent_id" varchar(128),
	"grant_id" varchar(128),
	"run_id" varchar(128),
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sando"."grant" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"project_id" varchar(128) NOT NULL,
	"host_id" varchar(128) NOT NULL,
	"agent_id" varchar(128) NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope" "sando"."grant_scope" NOT NULL,
	"status" "sando"."grant_status" NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sando"."host" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"platform" "sando"."host_platform" NOT NULL,
	"runtime" "sando"."sandbox_runtime" NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sando"."project" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"local_fingerprint" text NOT NULL,
	"policy_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sando"."run" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"project_id" varchar(128) NOT NULL,
	"host_id" varchar(128) NOT NULL,
	"agent_id" varchar(128) NOT NULL,
	"grant_id" varchar(128) NOT NULL,
	"command" text NOT NULL,
	"template" text NOT NULL,
	"runtime" "sando"."sandbox_runtime" NOT NULL,
	"network" "sando"."network_mode" NOT NULL,
	"status" "sando"."run_status" NOT NULL,
	"exit_code" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "sando"."session" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" varchar(128) NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sando"."user" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sando"."verification" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sando"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sando"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."agent" ADD CONSTRAINT "agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sando"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."agent" ADD CONSTRAINT "agent_host_id_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "sando"."host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."artifact" ADD CONSTRAINT "artifact_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "sando"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."artifact" ADD CONSTRAINT "artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "sando"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."audit_event" ADD CONSTRAINT "audit_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sando"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."audit_event" ADD CONSTRAINT "audit_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "sando"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."audit_event" ADD CONSTRAINT "audit_event_host_id_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "sando"."host"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."audit_event" ADD CONSTRAINT "audit_event_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "sando"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."audit_event" ADD CONSTRAINT "audit_event_grant_id_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "sando"."grant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."audit_event" ADD CONSTRAINT "audit_event_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "sando"."run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."grant" ADD CONSTRAINT "grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sando"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."grant" ADD CONSTRAINT "grant_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "sando"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."grant" ADD CONSTRAINT "grant_host_id_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "sando"."host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."grant" ADD CONSTRAINT "grant_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "sando"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."host" ADD CONSTRAINT "host_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sando"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."project" ADD CONSTRAINT "project_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sando"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."run" ADD CONSTRAINT "run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sando"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."run" ADD CONSTRAINT "run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "sando"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."run" ADD CONSTRAINT "run_host_id_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "sando"."host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."run" ADD CONSTRAINT "run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "sando"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."run" ADD CONSTRAINT "run_grant_id_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "sando"."grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sando"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sando"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_host_kind_display_name_unique" ON "sando"."agent" USING btree ("host_id","kind","display_name");--> statement-breakpoint
CREATE INDEX "artifact_run_idx" ON "sando"."artifact" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_storage_key_unique" ON "sando"."artifact" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_run_path_unique" ON "sando"."artifact" USING btree ("run_id","path");--> statement-breakpoint
CREATE INDEX "audit_event_user_timestamp_idx" ON "sando"."audit_event" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX "audit_event_run_timestamp_idx" ON "sando"."audit_event" USING btree ("run_id","timestamp");--> statement-breakpoint
CREATE INDEX "grant_authorization_lookup_idx" ON "sando"."grant" USING btree ("project_id","host_id","agent_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "host_user_fingerprint_unique" ON "sando"."host" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "project_user_local_fingerprint_unique" ON "sando"."project" USING btree ("user_id","local_fingerprint");--> statement-breakpoint
CREATE INDEX "run_project_status_idx" ON "sando"."run" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "run_grant_idx" ON "sando"."run" USING btree ("grant_id");
