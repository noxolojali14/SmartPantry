export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFoundHandler(request, response, next) {
  next(new AppError(404, "not_found", "The requested resource was not found."));
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    response.status(400).json({ error: { code: "invalid_json", message: "Request body must be valid JSON." } });
    return;
  }

  if (error.type === "entity.too.large") {
    response.status(413).json({ error: { code: "payload_too_large", message: "Request body is too large." } });
    return;
  }

  if (error.code === "23505" || error.code === "23503") {
    response.status(409).json({ error: { code: "conflict", message: "The request conflicts with existing data." } });
    return;
  }

  if (error.code === "23514" || error.code === "22P02" || error.code === "22007" || error.code === "22008") {
    response.status(400).json({ error: { code: "invalid_data", message: "One or more values are invalid." } });
    return;
  }

  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : "internal_error";
  const message = error instanceof AppError ? error.message : "An unexpected error occurred.";

  if (status >= 500) {
    console.error(error);
  }

  response.status(status).json({ error: { code, message } });
}