import "server-only";

import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// The Cloudflare D1 database (SQLite).

type Row = Record<string, unknown>;
type Value = string | number | boolean | null | undefined;

const toDb = (v: Value) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);

export const env = () => getCloudflareContext().env;

export const stmt = (sql: string, ...params: Value[]) => env().DB.prepare(sql).bind(...params.map(toDb));

export async function all<T = Row>(sql: string, ...params: Value[]): Promise<T[]> {
  const { results } = await stmt(sql, ...params).all<Row>();
  return results as T[];
}

export async function first<T = Row>(sql: string, ...params: Value[]): Promise<T | null> {
  return ((await stmt(sql, ...params).first<Row>()) as T) ?? null;
}

/** Runs one write and returns how many rows it changed. */
export async function run(sql: string, ...params: Value[]): Promise<number> {
  return (await stmt(sql, ...params).run()).meta.changes;
}

/** Runs several statements together: they all apply, or none do. */
export const batch = (statements: D1PreparedStatement[]) => env().DB.batch<Row>(statements);

/** Runs something after the response has gone, so a visitor never waits for it. */
export function later(work: Promise<unknown>) {
  const safe = work.catch((e) => console.error("background work failed", e));
  try {
    getCloudflareContext().ctx.waitUntil(safe);
  } catch {
    // Outside a request: it still runs, just not held open.
  }
}

export const nowIso = () => new Date().toISOString();
