import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
	throw new Error(
		"Missing Supabase environment variables.\n" +
			"Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env.local",
	);
}

/**
 * Typed Supabase client singleton.
 * Import this everywhere in the app — never call createClient() directly.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
	realtime: {
		params: {
			// Reduces heartbeat noise in the browser console during development
			eventsPerSecond: 10,
		},
	},
});
