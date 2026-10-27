import { Router } from "express";
import { createPantryController } from "../controllers/pantry.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

export function createPantryRouter(supabase) {
  const router = Router();
  const controller = createPantryController(supabase);
  router.use(requireAuth);
  router.get("/expiry", controller.expiry);
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.get("/:id", controller.get);
  router.put("/:id", controller.update);
  router.patch("/:id", controller.update);
  router.delete("/:id", controller.remove);
  return router;
}