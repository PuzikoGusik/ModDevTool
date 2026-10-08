CREATE TABLE "account_profiles" (
	"user_id" text PRIMARY KEY,
	"nickname" text NOT NULL,
	"nickname_key" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
