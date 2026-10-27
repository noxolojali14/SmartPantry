import { AppError } from "./errorHandler.js";

export function requireAuth(request, response, next) {
  if (!Number.isInteger(request.session?.userId)) {
    next(new AppError(401, "authentication_required", "Please log in to continue."));
    return;
  }

  next();
}