import { RankerDB } from "./schema";

/**
 * Singleton Dexie database instance.
 * Import this throughout the app — Dexie handles connection lifecycle internally.
 */
export const db = new RankerDB();
