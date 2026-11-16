import * as m0001 from "./0001_init";

export interface Migration {
  /** Sorts lexically, so the numeric prefix is the order. Never rename one. */
  id: string;
  sql: string;
}

/**
 * Every migration, oldest first. To change the schema, add a new file and
 * append it here — never edit one that has already been applied somewhere,
 * because a database that ran the old version will not run it again.
 */
export const MIGRATIONS: Migration[] = [m0001];
