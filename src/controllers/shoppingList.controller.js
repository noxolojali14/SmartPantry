import { AppError } from "../middleware/errorHandler.js";
import { booleanValue, positiveId, positiveNumber, rejectUnknownFields, requireObjectBody, stringValue } from "../middleware/validate.js";

const allowedFields = ["name", "quantity", "unit", "isPurchased"];
const columns = "id, name, quantity, unit, is_purchased, created_at, updated_at";
const updateColumns = { name: "name", quantity: "quantity", unit: "unit", isPurchased: "is_purchased" };

function parseItem(body, partial = false) {
  requireObjectBody({ body });
  rejectUnknownFields(body, allowedFields);
  const item = {};
  if (!partial || Object.hasOwn(body, "name")) item.name = stringValue(body.name, "Name", { max: 100 });
  if (!partial || Object.hasOwn(body, "quantity")) item.quantity = positiveNumber(body.quantity, "Quantity");
  if (!partial || Object.hasOwn(body, "unit")) item.unit = stringValue(body.unit ?? "", "Unit", { max: 30, optional: true });
  if (Object.hasOwn(body, "isPurchased")) item.is_purchased = booleanValue(body.isPurchased, "isPurchased");
  else if (!partial) item.is_purchased = false;
  if (partial && Object.keys(item).length === 0) throw new AppError(400, "validation_error", "Provide at least one field to update.");
  return item;
}

function presentItem(row) {
  if (!row) return row;
  return {
    id: Number(row.id),
    name: row.name,
    quantity: Number(row.quantity),
    unit: row.unit,
    isPurchased: row.is_purchased,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getOwnedItem(supabase, userId, id) {
  const { data, error } = await supabase.from("shopping_list_items").select(columns).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return presentItem(data);
}

function handleError(error, next) {
  next(error);
}

export function createShoppingListController(supabase) {
  return {
    list: async (request, response, next) => {
      try {
        const { data, error } = await supabase.from("shopping_list_items")
          .select(columns)
          .eq("user_id", request.session.userId)
          .order("is_purchased")
          .order("name");
        if (error) throw error;
        response.json({ items: data.map(presentItem) });
      } catch (error) {
        handleError(error, next);
      }
    },

    get: async (request, response, next) => {
      try {
        const item = await getOwnedItem(supabase, request.session.userId, positiveId(request.params.id));
        if (!item) return next(new AppError(404, "not_found", "Shopping-list item was not found."));
        response.json({ item });
      } catch (error) {
        handleError(error, next);
      }
    },

    create: async (request, response, next) => {
      try {
        const item = parseItem(request.body);
        const { data, error } = await supabase.from("shopping_list_items")
          .insert({ ...item, user_id: request.session.userId })
          .select(columns)
          .single();
        if (error) throw error;
        response.status(201).json({ item: presentItem(data) });
      } catch (error) {
        handleError(error, next);
      }
    },

    update: async (request, response, next) => {
      try {
        const id = positiveId(request.params.id);
        const item = parseItem(request.body, true);
        const update = Object.fromEntries(Object.entries(item).map(([field, value]) => [updateColumns[field] || field, value]));
        const { data, error } = await supabase.from("shopping_list_items")
          .update(update)
          .eq("id", id)
          .eq("user_id", request.session.userId)
          .select(columns)
          .maybeSingle();
        if (error) throw error;
        if (!data) return next(new AppError(404, "not_found", "Shopping-list item was not found."));
        response.json({ item: presentItem(data) });
      } catch (error) {
        handleError(error, next);
      }
    },

    remove: async (request, response, next) => {
      try {
        const { data, error } = await supabase.from("shopping_list_items")
          .delete()
          .eq("id", positiveId(request.params.id))
          .eq("user_id", request.session.userId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) return next(new AppError(404, "not_found", "Shopping-list item was not found."));
        response.status(204).end();
      } catch (error) {
        handleError(error, next);
      }
    }
  };
}