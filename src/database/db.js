import { createClient } from "@supabase/supabase-js";

export function createSupabaseClient({
  url = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
} = {}) {
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured on the server.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL.");
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
    throw new Error("SUPABASE_URL must use HTTPS outside local development.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}

export async function verifySupabaseConnection(supabase) {
  const { error } = await supabase.from("users").select("id").limit(1);
  if (!error) return;

  if (error.code === "42P01" || error.code === "PGRST205") {
    throw new Error("Supabase is reachable, but public.users is missing. Run supabase/schema.sql in the Supabase SQL Editor.");
  }

  const details = error.code ? `${error.code}: ${error.message}` : error.message;
  throw new Error(`Supabase connection check failed. Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ${details}`);
}