import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Database } from "./client";

export interface AppliedMigration {
  hash: string;
  createdAt: number;
}

export interface KnownMigration {
  tag: string;
  hash: string;
  when: number;
}

/** Why the database's migrations don't match this build. */
export class MigrationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationMismatchError";
  }
}

/**
 * Compares the migrations recorded in the database with this build's files,
 * by position: a changed file (other hash or journal date) at an applied
 * index, or more applied migrations than files (an older build against a
 * newer database) is a mismatch. Committed migrations are frozen; a fix
 * always goes in a new migration.
 */
export function checkMigrations(applied: AppliedMigration[], known: KnownMigration[]): string | null {
  // Drizzle runs only migrations dated after the newest applied one: one dated earlier is skipped without a word.
  for (let i = 1; i < known.length; i++) {
    const [before, k] = [known[i - 1] as KnownMigration, known[i] as KnownMigration];
    if (k.when <= before.when) {
      return `Migration ${k.tag} is dated before ${before.tag} in the journal, so a database that has ${before.tag} would skip it. Regenerate it after the latest migration.`;
    }
  }
  if (applied.length > known.length) {
    return `The database has ${applied.length} migrations but this build knows ${known.length}: it was migrated by a newer version. Deploy that version (or newer) instead.`;
  }
  for (let i = 0; i < applied.length; i++) {
    const a = applied[i] as AppliedMigration;
    const k = known[i] as KnownMigration;
    if (a.hash !== k.hash || a.createdAt !== k.when) {
      return `Migration ${k.tag} was changed after it was applied (the database has another version of it). Committed migrations are frozen: restore the file and put the change in a new migration.`;
    }
  }
  return null;
}

/** This build's migrations, with drizzle's own hashing (sha256 of the SQL file). */
export function knownMigrations(migrationsFolder: string): KnownMigration[] {
  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  const files = readMigrationFiles({ migrationsFolder });
  return journal.entries.map((e, i) => ({ tag: e.tag, when: e.when, hash: files[i]?.hash ?? "" }));
}

/** Migrations recorded in `drizzle.__drizzle_migrations` (none on a fresh database). */
export async function appliedMigrations(db: Database): Promise<AppliedMigration[]> {
  const exists = (await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations') as t`)) as unknown;
  const rows = (Array.isArray(exists) ? exists : (exists as { rows: { t: unknown }[] }).rows) as { t: unknown }[];
  if (!rows[0]?.t) return [];
  const result = (await db.execute(
    sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at, id`,
  )) as unknown;
  const list = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
    hash: string;
    created_at: string | number;
  }[];
  return list.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

/**
 * Migrations this build first shipped under an earlier number and later moved after the newest upstream one (a fork's
 * own tables, numbered again when upstream's migrations took their place), by the sha256 of the SQL that was applied.
 * A database that ran them under the old number has their rows where upstream's now are: `forgetMovedMigrations`
 * drops those rows before the guard, so drizzle runs upstream's migrations in between and then these again at their
 * new place. A row is theirs by its hash and its old journal date together, never the new place's own row. Their SQL
 * there stands being run twice (`IF NOT EXISTS`, a duplicate constraint skipped).
 */
export const MOVED_MIGRATIONS: readonly { tag: string; movedTo: string; hash: string; when: number }[] = [
  {
    tag: "0323_two_factor",
    movedTo: "0365_two_factor",
    hash: "d9745270c09f6c66aa040133f8bda06d9863c24927af20b49034aef869147924",
    when: 1795432975656,
  },
  {
    tag: "0324_plan_limit_alerts",
    movedTo: "0366_plan_limit_alerts",
    hash: "246a5bbdec312d24eecb74e592e5d47e35524e59eb50d18438f009532be6467d",
    when: 1795434346002,
  },
];

/** Forgets the rows of migrations applied under their old number (`MOVED_MIGRATIONS`); how many it forgot. */
export async function forgetMovedMigrations(db: Database, moved = MOVED_MIGRATIONS): Promise<number> {
  if (moved.length === 0) return 0;
  const exists = (await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations') as t`)) as unknown;
  const rows = (Array.isArray(exists) ? exists : (exists as { rows: { t: unknown }[] }).rows) as { t: unknown }[];
  if (!rows[0]?.t) return 0;
  const result = (await db.execute(
    sql`delete from drizzle.__drizzle_migrations where ${sql.join(
      moved.map((m) => sql`(hash = ${m.hash} and created_at = ${m.when})`),
      sql` or `,
    )} returning id`,
  )) as unknown;
  const gone = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as unknown[];
  return gone.length;
}

/** Boot guard: throws (before anything is migrated) when the database and this build disagree. */
export async function assertMigrationsMatch(db: Database, migrationsFolder: string) {
  const problem = checkMigrations(await appliedMigrations(db), knownMigrations(migrationsFolder));
  if (problem) throw new MigrationMismatchError(problem);
}
