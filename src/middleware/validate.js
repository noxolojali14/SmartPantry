import { AppError } from "./errorHandler.js";

export function requireObjectBody(request) {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    throw new AppError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return request.body;
}

export function rejectUnknownFields(body, allowedFields) {
  const unknown = Object.keys(body).find((field) => !allowedFields.includes(field));
  if (unknown) {
    throw new AppError(400, "unknown_field", `The field '${unknown}' is not allowed.`);
  }
}

export function stringValue(value, field, { min = 1, max, optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return "";
    throw new AppError(400, "validation_error", `${field} is required.`);
  }

  if (typeof value !== "string") {
    throw new AppError(400, "validation_error", `${field} must be text.`);
  }

  const result = value.trim();
  if ((!optional && result.length < min) || result.length > max) {
    throw new AppError(400, "validation_error", `${field} must be ${min === 1 ? "between 1 and " + max : "at least " + min + " and at most " + max} characters.`);
  }
  return result;
}

export function positiveNumber(value, field, { optional = false } = {}) {
  if ((value === undefined || value === null || value === "") && optional) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new AppError(400, "validation_error", `${field} must be a number greater than zero.`);
  }
  return value;
}

export function isoDateValue(value, field, { optional = false } = {}) {
  if ((value === undefined || value === null || value === "") && optional) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, "validation_error", `${field} must be a date in YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, "validation_error", `${field} must be a real calendar date.`);
  }
  return value;
}

export function booleanValue(value, field) {
  if (typeof value !== "boolean") {
    throw new AppError(400, "validation_error", `${field} must be true or false.`);
  }
  return value;
}

export function positiveId(value, field = "id") {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new AppError(400, "validation_error", `${field} must be a positive integer.`);
  }
  return Number(value);
}