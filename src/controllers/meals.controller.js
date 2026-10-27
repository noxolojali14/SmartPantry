import { AppError } from "../middleware/errorHandler.js";
import { positiveId, positiveNumber, rejectUnknownFields, requireObjectBody, stringValue } from "../middleware/validate.js";

const mealFields = ["name", "instructions", "ingredients"];
const ingredientFields = ["name", "quantity", "unit"];
const mealColumns = "id, user_id, name, instructions, created_at, updated_at";
const ingredientColumns = "id, meal_id, user_id, name, quantity, unit, created_at";

function parseIngredient(value, partial = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "validation_error", "Each ingredient must be an object.");
  }
  rejectUnknownFields(value, ingredientFields);
  const ingredient = {};
  if (!partial || Object.hasOwn(value, "name")) ingredient.name = stringValue(value.name, "Ingredient name", { max: 100 });
  if (Object.hasOwn(value, "quantity")) ingredient.quantity = positiveNumber(value.quantity, "Ingredient quantity", { optional: true });
  else if (!partial) ingredient.quantity = null;
  if (Object.hasOwn(value, "unit")) ingredient.unit = stringValue(value.unit, "Ingredient unit", { max: 30, optional: true });
  else if (!partial) ingredient.unit = "";
  if (partial && Object.keys(ingredient).length === 0) throw new AppError(400, "validation_error", "Provide at least one field to update.");
  return ingredient;
}

function parseMeal(body, partial = false) {
  requireObjectBody({ body });
  rejectUnknownFields(body, mealFields);
  const meal = {};
  if (!partial || Object.hasOwn(body, "name")) meal.name = stringValue(body.name, "Name", { max: 100 });
  if (!partial || Object.hasOwn(body, "instructions")) {
    meal.instructions = stringValue(body.instructions ?? "", "Instructions", { max: 2000, optional: true });
  }
  if (Object.hasOwn(body, "ingredients")) {
    if (!Array.isArray(body.ingredients) || body.ingredients.length > 50) {
      throw new AppError(400, "validation_error", "Ingredients must be a list with no more than 50 entries.");
    }
    meal.ingredients = body.ingredients.map((ingredient) => parseIngredient(ingredient));
  }
  if (partial && Object.keys(meal).length === 0) throw new AppError(400, "validation_error", "Provide at least one field to update.");
  return meal;
}

function presentMeal(row, ingredients = []) {
  return {
    id: Number(row.id),
    name: row.name,
    instructions: row.instructions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ingredients
  };
}

function presentIngredient(row) {
  return {
    id: Number(row.id),
    mealId: Number(row.meal_id),
    name: row.name,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
    createdAt: row.created_at
  };
}

async function getOwnedMeal(supabase, userId, mealId) {
  const { data: meal, error: mealError } = await supabase.from("meals")
    .select(mealColumns)
    .eq("id", mealId)
    .eq("user_id", userId)
    .maybeSingle();
  if (mealError) throw mealError;
  if (!meal) return undefined;

  const { data: ingredients, error: ingredientError } = await supabase.from("meal_ingredients")
    .select(ingredientColumns)
    .eq("meal_id", mealId)
    .eq("user_id", userId)
    .order("id");
  if (ingredientError) throw ingredientError;
  return presentMeal(meal, ingredients.map(presentIngredient));
}

async function getOwnedIngredient(supabase, userId, mealId, ingredientId) {
  const { data, error } = await supabase.from("meal_ingredients")
    .select(ingredientColumns)
    .eq("id", ingredientId)
    .eq("meal_id", mealId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? presentIngredient(data) : undefined;
}

function reportError(error, next) {
  if (error.code === "P0002" || error.message === "meal_not_found") {
    next(new AppError(404, "not_found", "Meal was not found."));
    return;
  }
  next(error);
}

export function createMealsController(supabase) {
  return {
    list: async (request, response, next) => {
      try {
        const { data, error } = await supabase.from("meals")
          .select(mealColumns)
          .eq("user_id", request.session.userId)
          .order("name");
        if (error) throw error;
        const meals = await Promise.all(data.map((meal) => getOwnedMeal(supabase, request.session.userId, meal.id)));
        response.json({ meals });
      } catch (error) {
        reportError(error, next);
      }
    },

    get: async (request, response, next) => {
      try {
        const meal = await getOwnedMeal(supabase, request.session.userId, positiveId(request.params.id));
        if (!meal) return next(new AppError(404, "not_found", "Meal was not found."));
        response.json({ meal });
      } catch (error) {
        reportError(error, next);
      }
    },

    create: async (request, response, next) => {
      try {
        const meal = parseMeal(request.body);
        const { data: mealId, error } = await supabase.rpc("create_meal_with_ingredients", {
          p_user_id: request.session.userId,
          p_name: meal.name,
          p_instructions: meal.instructions,
          p_ingredients: meal.ingredients || []
        });
        if (error) throw error;
        const created = await getOwnedMeal(supabase, request.session.userId, mealId);
        if (!created) throw new Error("Created meal could not be loaded.");
        response.status(201).json({ meal: created });
      } catch (error) {
        reportError(error, next);
      }
    },

    update: async (request, response, next) => {
      try {
        const id = positiveId(request.params.id);
        const meal = parseMeal(request.body, true);
        const fields = Object.fromEntries(Object.entries(meal).filter(([field]) => field !== "ingredients"));
        const { data: updatedId, error } = await supabase.rpc("update_meal_with_ingredients", {
          p_user_id: request.session.userId,
          p_meal_id: id,
          p_fields: fields,
          p_replace_ingredients: Object.hasOwn(meal, "ingredients"),
          p_ingredients: meal.ingredients || []
        });
        if (error) throw error;
        const updated = await getOwnedMeal(supabase, request.session.userId, updatedId);
        if (!updated) return next(new AppError(404, "not_found", "Meal was not found."));
        response.json({ meal: updated });
      } catch (error) {
        reportError(error, next);
      }
    },

    remove: async (request, response, next) => {
      try {
        const { data, error } = await supabase.from("meals")
          .delete()
          .eq("id", positiveId(request.params.id))
          .eq("user_id", request.session.userId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) return next(new AppError(404, "not_found", "Meal was not found."));
        response.status(204).end();
      } catch (error) {
        reportError(error, next);
      }
    },

    listIngredients: async (request, response, next) => {
      try {
        const mealId = positiveId(request.params.mealId, "mealId");
        const meal = await getOwnedMeal(supabase, request.session.userId, mealId);
        if (!meal) return next(new AppError(404, "not_found", "Meal was not found."));
        response.json({ ingredients: meal.ingredients });
      } catch (error) {
        reportError(error, next);
      }
    },

    addIngredient: async (request, response, next) => {
      try {
        const mealId = positiveId(request.params.mealId, "mealId");
        const meal = await getOwnedMeal(supabase, request.session.userId, mealId);
        if (!meal) return next(new AppError(404, "not_found", "Meal was not found."));
        const ingredient = parseIngredient(request.body);
        const { data, error } = await supabase.from("meal_ingredients")
          .insert({ ...ingredient, meal_id: mealId, user_id: request.session.userId })
          .select(ingredientColumns)
          .single();
        if (error) throw error;
        response.status(201).json({ ingredient: presentIngredient(data) });
      } catch (error) {
        reportError(error, next);
      }
    },

    updateIngredient: async (request, response, next) => {
      try {
        const mealId = positiveId(request.params.mealId, "mealId");
        const ingredientId = positiveId(request.params.ingredientId, "ingredientId");
        const ingredient = parseIngredient(request.body, true);
        const { data, error } = await supabase.from("meal_ingredients")
          .update(ingredient)
          .eq("id", ingredientId)
          .eq("meal_id", mealId)
          .eq("user_id", request.session.userId)
          .select(ingredientColumns)
          .maybeSingle();
        if (error) throw error;
        if (!data) return next(new AppError(404, "not_found", "Ingredient was not found."));
        response.json({ ingredient: presentIngredient(data) });
      } catch (error) {
        reportError(error, next);
      }
    },

    removeIngredient: async (request, response, next) => {
      try {
        const { data, error } = await supabase.from("meal_ingredients")
          .delete()
          .eq("id", positiveId(request.params.ingredientId, "ingredientId"))
          .eq("meal_id", positiveId(request.params.mealId, "mealId"))
          .eq("user_id", request.session.userId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) return next(new AppError(404, "not_found", "Ingredient was not found."));
        response.status(204).end();
      } catch (error) {
        reportError(error, next);
      }
    }
  };
}