import { AppError } from "../middleware/errorHandler.js";
import { rejectUnknownFields, requireObjectBody, stringValue } from "../middleware/validate.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

function publicUser(row) {
  return { id: Number(row.id), name: row.name, email: row.email, createdAt: row.created_at };
}

function normalizeEmail(value) {
  const email = stringValue(value, "Email", { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, "validation_error", "Email must be a valid email address.");
  }
  return email;
}

export function createAuthController(supabase) {
  return {
    register: async (request, response, next) => {
      try {
        const body = requireObjectBody(request);
        rejectUnknownFields(body, ["name", "email", "password"]);
        const name = stringValue(body.name, "Name", { max: 80 });
        const email = normalizeEmail(body.email);
        if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
          throw new AppError(400, "validation_error", "Password must be between 8 and 128 characters.");
        }

        const passwordHash = await hashPassword(body.password);
        const { data: user, error } = await supabase
          .from("users")
          .insert({ name, email, password_hash: passwordHash })
          .select("id, name, email, created_at")
          .single();
        if (error) throw error;
        response.status(201).json({ user: publicUser(user) });
      } catch (error) {
        if (error.code === "23505") {
          next(new AppError(409, "email_in_use", "An account with that email already exists."));
          return;
        }
        next(error);
      }
    },

    login: async (request, response, next) => {
      try {
        const body = requireObjectBody(request);
        rejectUnknownFields(body, ["email", "password"]);
        const email = normalizeEmail(body.email);
        if (typeof body.password !== "string" || body.password.length < 1 || body.password.length > 128) {
          throw new AppError(400, "validation_error", "Password is required and must be at most 128 characters.");
        }

        const { data: row, error } = await supabase
          .from("users")
          .select("id, name, email, password_hash, created_at")
          .eq("email", email)
          .maybeSingle();
        if (error) throw error;
        if (!row || !(await verifyPassword(body.password, row.password_hash))) {
          throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
        }

        request.session.regenerate((regenerateError) => {
          if (regenerateError) return next(regenerateError);
          request.session.userId = Number(row.id);
          request.session.save((saveError) => {
            if (saveError) return next(saveError);
            response.json({ user: publicUser(row) });
          });
        });
      } catch (error) {
        next(error);
      }
    },

    logout: (request, response, next) => {
      if (!request.session) {
        response.status(204).end();
        return;
      }
      request.session.destroy((error) => {
        if (error) return next(error);
        response.clearCookie("smartpantry.sid", {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/"
        });
        response.status(204).end();
      });
    },

    currentUser: async (request, response, next) => {
      try {
        const { data: row, error } = await supabase
          .from("users")
          .select("id, name, email, created_at")
          .eq("id", request.session.userId)
          .maybeSingle();
        if (error) throw error;
        if (!row) {
          next(new AppError(401, "authentication_required", "Please log in to continue."));
          return;
        }
        response.json({ user: publicUser(row) });
      } catch (error) {
        next(error);
      }
    }
  };
}