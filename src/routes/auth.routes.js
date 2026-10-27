import { Router } from "express";
import { createAuthController } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

export function createAuthRouter(supabase) {
  const router = Router();
  const controller = createAuthController(supabase);

  router.post("/register", controller.register);
  router.post("/login", controller.login);
  router.post("/logout", controller.logout);
  router.get("/me", requireAuth, controller.currentUser);
  return router;
}