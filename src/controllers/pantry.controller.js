import { AppError } from "../middleware/errorHandler.js";
import { isoDateValue, positiveId, positiveNumber, rejectUnknownFields, requireObjectBody, stringValue } from "../middleware/validate.js";

const allowedFields = ["name", "quantity", "unit", "category", "expiryDate"];
const columns = "id, name, quantity, unit, category, expiry_date, created_at, updated_at";
const updateColumns = { name: "name", quantity: "quantity", unit: "unit", category: "category", expiryDate: "expiry_date" };

function parseItem(body, partial = false) {
  requireObjectBody({ body });
  rejectUnknownFields(body, allowedFields);
  const item = {};
  if (!partial || Object.hasOwn(body, "name")) item.name = stringValue(body.name, "Name", { max: 100 });
  if (!partial || Object.hasOwn(body, "quantity")) item.quantity = positiveNumber(body.quantity, "Quantity");
  if (!partial || Object.hasOwn(body, "unit")) item.unit = stringValue(body.unit ?? "", "Unit", { max: 30, optional: true });
  if (!partial || Object.hasOwn(body, "category")) item.category = stringValue(body.category ?? "", "Category", { max: 50, optional: true });
  if (!partial || Object.hasOwn(body, "expiryDate")) item.expiry_date = isoDateValue(body.expiryDate, "Expiry date", { optional: true });
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
    category: row.category,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getOwnedItem(supabase, userId, id) {
  const { data, error } = await supabase.from("pantry_items").select(columns).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return presentItem(data);
}

function expiryDateAfter(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function handleError(error, next) {
  next(error);
}

export function createPantryController(supabase) {
  return {
    list: async (request, response, next) => {
      try {
        const { data, error } = await supabase.from("pantry_items").select(columns).eq("user_id", request.session.userId).order("name");
        if (error) throw error;
        response.json({ items: data.map(presentItem) });
      } catch (error) {
        handleError(error, next);
      }
    },

    get: async (request, response, next) => {
      try {
        const item = await getOwnedItem(supabase, request.session.userId, positiveId(request.params.id));
        if (!item) return next(new AppError(404, "not_found", "Pantry item was not found."));
        response.json({ item });
      } catch (error) {
        handleError(error, next);
      }
    },

    create: async (request, response, next) => {
      try {
        const item = parseItem(request.body);
        const { data, error } = await supabase.from("pantry_items")
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
        const { data, error } = await supabase.from("pantry_items")
          .update(update)
          .eq("id", id)
          .eq("user_id", request.session.userId)
          .select(columns)
          .maybeSingle();
        if (error) throw error;
        if (!data) return next(new AppError(404, "not_found", "Pantry item was not found."));
        response.json({ item: presentItem(data) });
      } catch (error) {
        handleError(error, next);
      }
    },

    remove: async (request, response, next) => {
      try {
        const { data, error } = await supabase.from("pantry_items")
          .delete()
          .eq("id", positiveId(request.params.id))
          .eq("user_id", request.session.userId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) return next(new AppError(404, "not_found", "Pantry item was not found."));
        response.status(204).end();
      } catch (error) {
        handleError(error, next);
      }
    },

    expiry: async (request, response, next) => {
      try {
        const status = request.query.status;
        if (status !== "soon" && status !== "expired") {
          throw new AppError(400, "validation_error", "Status must be 'soon' or 'expired'.");
        }
        let days = 7;
        if (request.query.days !== undefined) {
          if (!/^\d+$/.test(request.query.days) || Number(request.query.days) < 1 || Number(request.query.days) > 30) {
            throw new AppError(400, "validation_error", "Days must be an integer from 1 to 30.");
          }
          days = Number(request.query.days);
        }

        let query = supabase.from("pantry_items").select(columns)
          .eq("user_id", request.session.userId)
          .not("expiry_date", "is", null);
        if (status === "expired") {
          query = query.lt("expiry_date", new Date().toISOString().slice(0, 10));
        } else {
          query = query.gte("expiry_date", new Date().toISOString().slice(0, 10)).lte("expiry_date", expiryDateAfter(days));
        }
        const { data, error } = await query.order("expiry_date").order("name");
        if (error) throw error;
        response.json({ status, days: status === "soon" ? days : null, items: data.map(presentItem) });
      } catch (error) {
        handleError(error, next);
      }
    }
  };
}