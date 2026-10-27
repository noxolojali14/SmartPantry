import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SupabaseSessionStore } from "./database/supabaseSessionStore.js";
import { protectApiRequests } from "./middleware/apiSecurity.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createMealsRouter } from "./routes/meals.routes.js";
import { createPantryRouter } from "./routes/pantry.routes.js";
import { createShoppingListRouter } from "./routes/shoppingList.routes.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(sourceDirectory, "..");

export function createApp({ supabase, sessionSecret = process.env.SESSION_SECRET } = {}) {
  if (!supabase) throw new Error("A Supabase client is required.");
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }

  const app = express();
  const production = process.env.NODE_ENV === "production";
  if (production) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use(session({
    name: "smartpantry.sid",
    secret: sessionSecret,
    store: new SupabaseSessionStore(supabase),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: production,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/"
    }
  }));

  app.use("/api", protectApiRequests);
  app.use("/api/auth", createAuthRouter(supabase));
  app.use("/api/pantry", createPantryRouter(supabase));
  app.use("/api/shopping-list", createShoppingListRouter(supabase));
  app.use("/api/meals", createMealsRouter(supabase));
  app.use(express.static(path.join(projectDirectory, "public", "pages")));
  app.use(express.static(path.join(projectDirectory, "public")));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}