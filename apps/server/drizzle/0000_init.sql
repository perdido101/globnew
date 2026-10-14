CREATE TABLE "clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_item_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"breaking" boolean DEFAULT false NOT NULL,
	"importance" real DEFAULT 0 NOT NULL,
	"source_count" integer DEFAULT 1 NOT NULL,
	"place" text,
	"country" text,
	"lat" double precision,
	"lon" double precision,
	"first_seen_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"outlet" text NOT NULL,
	"author" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"image_url" text,
	"published_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lang" text,
	"engagement" jsonb,
	"subreddit" text,
	"verified" boolean DEFAULT true NOT NULL,
	"weight" real DEFAULT 0.7 NOT NULL,
	"region_hint" text,
	"place" text,
	"country" text,
	"lat" double precision,
	"lon" double precision,
	"geo_precision" text,
	"geo_confidence" real,
	"geo_method" text,
	"category" text,
	"breaking" boolean DEFAULT false NOT NULL,
	"importance" real,
	"cluster_id" text,
	"processed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "og_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"image" text,
	"title" text,
	"site_name" text,
	"ok" boolean NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_health" (
	"source_id" text PRIMARY KEY NOT NULL,
	"last_fetch_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"items_total" integer DEFAULT 0 NOT NULL,
	"items_last_fetch" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "clusters_first_seen_idx" ON "clusters" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "items_first_seen_idx" ON "items" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "items_cluster_idx" ON "items" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "items_url_idx" ON "items" USING btree ("url");