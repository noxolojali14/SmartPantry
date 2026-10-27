import "dotenv/config";
import { createApp } from "./app.js";
import { createSupabaseClient, verifySupabaseConnection } from "./database/db.js";

const port = Number(process.env.PORT || 3000);
const host = "0.0.0.0";
let server;

try {
  const supabase = createSupabaseClient();
  await verifySupabaseConnection(supabase);
  const app = createApp({ supabase });
  server = app.listen(port, host, () => {
    console.log(`SmartPantry is listening at http://${host}:${port}.`);
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function stop() {
  if (!server) return;
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);