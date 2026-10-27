import { AppError } from "./errorHandler.js";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function protectApiRequests(request, response, next) {
  if (!stateChangingMethods.has(request.method)) return next();
  if (request.method !== "DELETE" && !request.is("application/json")) {
    next(new AppError(415, "unsupported_media_type", "State-changing API requests must use application/json."));
    return;
  }

  if (request.get("sec-fetch-site") === "cross-site") {
    next(new AppError(403, "cross_site_request", "Cross-site API requests are not allowed."));
    return;
  }

  const origin = request.get("origin");
  if (origin) {
    try {
      const expectedOrigin = `${request.protocol}://${request.get("host")}`;
      if (new URL(origin).origin !== expectedOrigin) {
        next(new AppError(403, "cross_origin_request", "Cross-origin API requests are not allowed."));
        return;
      }
    } catch {
      next(new AppError(403, "invalid_origin", "The request origin is invalid."));
      return;
    }
  }

  next();
}