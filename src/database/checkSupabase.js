import "dotenv/config";
import { createSupabaseClient, verifySupabaseConnection } from "./db.js";

try {
  const supabase = createSupabaseClient();
  await verifySupabaseConnection(supabase);
  console.log("Supabase connection and public.users table are available.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}