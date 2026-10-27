import { Router } from "express";
import { createMealsController } from "../controllers/meals.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

export function createMealsRouter(supabase) {
  const router = Router();
  const controller = createMealsController(supabase);
  router.use(requireAuth);
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.get("/:mealId/ingredients", controller.listIngredients);
  router.post("/:mealId/ingredients", controller.addIngredient);
  router.patch("/:mealId/ingredients/:ingredientId", controller.updateIngredient);
  router.put("/:mealId/ingredients/:ingredientId", controller.updateIngredient);
  router.delete("/:mealId/ingredients/:ingredientId", controller.removeIngredient);
  router.get("/:id", controller.get);
  router.put("/:id", controller.update);
  router.patch("/:id", controller.update);
  router.delete("/:id", controller.remove);
  return router;
}