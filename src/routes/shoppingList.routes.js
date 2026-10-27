import { Router } from "express";
import { createShoppingListController } from "../controllers/shoppingList.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

export function createShoppingListRouter(supabase) {
  const router = Router();
  const controller = createShoppingListController(supabase);
  router.use(requireAuth);
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.get("/:id", controller.get);
  router.put("/:id", controller.update);
  router.patch("/:id", controller.update);
  router.delete("/:id", controller.remove);
  return router;
}