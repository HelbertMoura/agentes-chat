-- Idempotent: a server that ran these features before the upstream migrations already has their tables and column.
CREATE TABLE IF NOT EXISTS "two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "two_factors_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_limit_alerts" (
	"org_id" uuid NOT NULL,
	"account_key" text NOT NULL,
	"window_key" text NOT NULL,
	"resets_at" timestamp with time zone,
	"alerted_at" timestamp with time zone NOT NULL,
	"rearmed_at" timestamp with time zone,
	CONSTRAINT "plan_limit_alerts_org_id_account_key_window_key_pk" PRIMARY KEY("org_id","account_key","window_key")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'two_factors_user_id_users_id_fk') THEN
		ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_limit_alerts_org_id_organizations_id_fk') THEN
		ALTER TABLE "plan_limit_alerts" ADD CONSTRAINT "plan_limit_alerts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
