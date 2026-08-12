CREATE TABLE "branch" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_specialization" boolean DEFAULT false NOT NULL,
	"axis" text NOT NULL,
	"target" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"type" text NOT NULL,
	"branch_id" text NOT NULL,
	"difficulty" integer NOT NULL,
	"est_minutes" integer NOT NULL,
	"micro" text NOT NULL,
	"extended" text,
	"stub" boolean DEFAULT false NOT NULL,
	"deprecated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_competency" (
	"node_id" text NOT NULL,
	"axis" text NOT NULL,
	"points" integer NOT NULL,
	CONSTRAINT "node_competency_node_id_axis_pk" PRIMARY KEY("node_id","axis")
);
--> statement-breakpoint
CREATE TABLE "node_prereq" (
	"node_id" text NOT NULL,
	"prereq_id" text NOT NULL,
	CONSTRAINT "node_prereq_node_id_prereq_id_pk" PRIMARY KEY("node_id","prereq_id")
);
--> statement-breakpoint
CREATE TABLE "notebook" (
	"node_id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"account" text NOT NULL,
	"artifacts" text[] NOT NULL,
	"checked_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource" (
	"node_id" text NOT NULL,
	"id" text NOT NULL,
	"url" text NOT NULL,
	"format" text NOT NULL,
	"lang" text NOT NULL,
	"minutes" integer NOT NULL,
	"why" text NOT NULL,
	CONSTRAINT "resource_node_id_id_pk" PRIMARY KEY("node_id","id")
);
--> statement-breakpoint
CREATE TABLE "rubric_criterion" (
	"node_id" text NOT NULL,
	"id" text NOT NULL,
	"criterion" text NOT NULL,
	"how_to_check" text NOT NULL,
	CONSTRAINT "rubric_criterion_node_id_id_pk" PRIMARY KEY("node_id","id")
);
--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "node_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_competency" ADD CONSTRAINT "node_competency_node_id_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_prereq" ADD CONSTRAINT "node_prereq_node_id_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_prereq" ADD CONSTRAINT "node_prereq_prereq_id_node_id_fk" FOREIGN KEY ("prereq_id") REFERENCES "public"."node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook" ADD CONSTRAINT "notebook_node_id_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_node_id_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criterion" ADD CONSTRAINT "rubric_criterion_node_id_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."node"("id") ON DELETE no action ON UPDATE no action;