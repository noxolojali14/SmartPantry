import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { createFakeSupabase } from "./support/fakeSupabase.js";

describe("SmartPantry API", () => {
  let supabase;
  let server;
  let baseUrl;

  before(async () => {
    supabase = createFakeSupabase();
    const previousRender = process.env.RENDER;
    let app;
    try {
      process.env.RENDER = "true";
      app = createApp({ supabase, sessionSecret: "test-secret-with-more-than-32-characters" });
    } finally {
      if (previousRender === undefined) delete process.env.RENDER;
      else process.env.RENDER = previousRender;
    }
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function request(url, { method = "GET", body, cookie, origin, forwardedProto } = {}) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    if (origin) headers.origin = origin;
    if (forwardedProto) headers["x-forwarded-proto"] = forwardedProto;
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { response, data: response.status === 204 ? null : await response.json() };
  }

  async function createAccount(email) {
    const registration = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Pantry User", email, password: "correct-password-1" }
    });
    assert.equal(registration.response.status, 201);

    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email, password: "correct-password-1" }
    });
    assert.equal(login.response.status, 200);
    return login.response.headers.get("set-cookie").split(";")[0];
  }

  it("hashes passwords and supports login, current user, and logout", async () => {
    const registration = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Casey", email: "casey@example.com", password: "correct-password-1" }
    });
    assert.equal(registration.response.status, 201);
    assert.equal("password" in registration.data.user, false);

    const storedHash = supabase.rows("users").find((user) => user.email === "casey@example.com").password_hash;
    assert.match(storedHash, /^scrypt\$/);
    assert.notEqual(storedHash, "correct-password-1");

    const duplicate = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Casey", email: "casey@example.com", password: "correct-password-1" }
    });
    assert.equal(duplicate.response.status, 409);

    const badLogin = await request("/api/auth/login", {
      method: "POST",
      body: { email: "casey@example.com", password: "wrong-password" }
    });
    assert.equal(badLogin.response.status, 401);

    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email: "casey@example.com", password: "correct-password-1" }
    });
    assert.equal(login.response.status, 200);
    assert.match(login.response.headers.get("set-cookie"), /HttpOnly/i);
    assert.match(login.response.headers.get("set-cookie"), /SameSite=Lax/i);
    const cookie = login.response.headers.get("set-cookie").split(";")[0];

    const currentUser = await request("/api/auth/me", { cookie });
    assert.equal(currentUser.response.status, 200);
    assert.deepEqual(Object.keys(currentUser.data.user).sort(), ["createdAt", "email", "id", "name"]);

    const logout = await request("/api/auth/logout", { method: "POST", cookie, body: {} });
    assert.equal(logout.response.status, 204);
    assert.equal((await request("/api/auth/me", { cookie })).response.status, 401);
  });

  it("accepts same-origin HTTPS writes forwarded by Render", async () => {
    const registration = await request("/api/auth/register", {
      method: "POST",
      origin: `https://127.0.0.1:${server.address().port}`,
      forwardedProto: "https",
      body: { name: "Render User", email: "render@example.com", password: "correct-password-1" }
    });
    assert.equal(registration.response.status, 201);
  });

  it("requires authentication and rejects invalid or cross-origin writes", async () => {
    assert.equal((await request("/api/pantry")).response.status, 401);
    const cookie = await createAccount("validation@example.com");
    const invalidQuantity = await request("/api/pantry", {
      method: "POST", cookie, body: { name: "Rice", quantity: 0 }
    });
    assert.equal(invalidQuantity.response.status, 400);
    assert.equal(invalidQuantity.data.error.code, "validation_error");

    const invalidDate = await request("/api/pantry", {
      method: "POST", cookie, body: { name: "Rice", quantity: 1, expiryDate: "2025-02-30" }
    });
    assert.equal(invalidDate.response.status, 400);

    const crossOrigin = await request("/api/pantry", {
      method: "POST", cookie, origin: "https://attacker.example", body: { name: "Rice", quantity: 1 }
    });
    assert.equal(crossOrigin.response.status, 403);

    const wrongContentType = await fetch(`${baseUrl}/api/pantry`, { method: "POST", headers: { cookie, "content-type": "text/plain" }, body: "name=Rice" });
    assert.equal(wrongContentType.status, 415);
  });

  it("rejects missing fields, unexpected input, malformed JSON, and hides internal errors", async () => {
    const missingRegistrationField = await request("/api/auth/register", {
      method: "POST", body: { email: "missing-name@example.com", password: "correct-password-1" }
    });
    assert.equal(missingRegistrationField.response.status, 400);
    assert.equal(missingRegistrationField.data.error.code, "validation_error");

    const invalidEmail = await request("/api/auth/register", {
      method: "POST", body: { name: "Casey", email: "not-an-email", password: "correct-password-1" }
    });
    assert.equal(invalidEmail.response.status, 400);

    const unexpectedInput = await request("/api/auth/register", {
      method: "POST", body: { name: "Casey", email: "unexpected@example.com", password: "correct-password-1", isAdmin: true }
    });
    assert.equal(unexpectedInput.response.status, 400);
    assert.equal(unexpectedInput.data.error.code, "unknown_field");

    const shortPassword = await request("/api/auth/register", {
      method: "POST", body: { name: "Casey", email: "short@example.com", password: "short" }
    });
    assert.equal(shortPassword.response.status, 400);

    const malformedJson = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{"
    });
    assert.equal(malformedJson.status, 400);
    const malformedBody = await malformedJson.json();
    assert.equal(malformedBody.error.code, "invalid_json");
    assert.equal("stack" in malformedBody, false);
    assert.equal(JSON.stringify(malformedBody).includes("at "), false);

    const unknownRoute = await request("/api/not-a-route");
    assert.equal(unknownRoute.response.status, 404);
    assert.equal(unknownRoute.data.error.code, "not_found");
  });

  it("keeps pantry records private and supports expiry filtering and CRUD", async () => {
    const ownerCookie = await createAccount("pantry-owner@example.com");
    const otherCookie = await createAccount("pantry-other@example.com");
    const dayFromNow = (offset) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };

    const created = await request("/api/pantry", {
      method: "POST", cookie: ownerCookie,
      body: { name: "Pear", quantity: 4, unit: "pieces", expiryDate: dayFromNow(2) }
    });
    assert.equal(created.response.status, 201);
    const itemId = created.data.item.id;
    assert.equal((await request(`/api/pantry/${itemId}`, { cookie: ownerCookie })).data.item.name, "Pear");
    assert.equal((await request("/api/pantry", { cookie: otherCookie })).data.items.length, 0);
    assert.equal((await request(`/api/pantry/${itemId}`, { cookie: otherCookie })).response.status, 404);
    const expired = await request("/api/pantry", {
      method: "POST", cookie: ownerCookie, body: { name: "Expired pear", quantity: 1, expiryDate: dayFromNow(-1) }
    });
    const farFuture = await request("/api/pantry", {
      method: "POST", cookie: ownerCookie, body: { name: "Later pear", quantity: 1, expiryDate: dayFromNow(20) }
    });
    assert.equal(expired.response.status, 201);
    assert.equal(farFuture.response.status, 201);
    const soonItems = (await request("/api/pantry/expiry?status=soon&days=7", { cookie: ownerCookie })).data.items;
    const expiredItems = (await request("/api/pantry/expiry?status=expired", { cookie: ownerCookie })).data.items;
    assert.deepEqual(soonItems.map((item) => item.name), ["Pear"]);
    assert.deepEqual(expiredItems.map((item) => item.name), ["Expired pear"]);
    assert.equal((await request("/api/pantry/expiry?status=soon&days=7", { cookie: ownerCookie })).data.items.length, 1);
    assert.equal((await request("/api/pantry/expiry?status=soon&days=31", { cookie: ownerCookie })).response.status, 400);
    assert.equal((await request("/api/pantry/expiry?status=expired", { cookie: ownerCookie })).response.status, 200);

    const updated = await request(`/api/pantry/${itemId}`, {
      method: "PATCH", cookie: ownerCookie, body: { quantity: 6 }
    });
    assert.equal(updated.data.item.quantity, 6);
    assert.equal((await request(`/api/pantry/${itemId}`, { method: "DELETE", cookie: ownerCookie })).response.status, 204);
    assert.equal((await request(`/api/pantry/${itemId}`, { cookie: ownerCookie })).response.status, 404);
  });

  it("supports shopping-list CRUD and validates purchased state", async () => {
    const cookie = await createAccount("shopping@example.com");
    const created = await request("/api/shopping-list", {
      method: "POST", cookie, body: { name: "Oats", quantity: 1, unit: "bag" }
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.item.isPurchased, false);
    assert.equal((await request("/api/shopping-list", { cookie })).data.items.length, 1);
    assert.equal((await request(`/api/shopping-list/${created.data.item.id}`, { cookie })).data.item.name, "Oats");

    const updated = await request(`/api/shopping-list/${created.data.item.id}`, {
      method: "PATCH", cookie, body: { isPurchased: true, quantity: 2 }
    });
    assert.equal(updated.data.item.isPurchased, true);
    assert.equal(updated.data.item.quantity, 2);

    const invalid = await request(`/api/shopping-list/${created.data.item.id}`, {
      method: "PATCH", cookie, body: { isPurchased: "yes" }
    });
    assert.equal(invalid.response.status, 400);
    const missingName = await request("/api/shopping-list", {
      method: "POST", cookie, body: { quantity: 1 }
    });
    assert.equal(missingName.response.status, 400);
    assert.equal((await request(`/api/shopping-list/${created.data.item.id}`, { method: "DELETE", cookie })).response.status, 204);
  });

  it("manages meals and ingredients without crossing meal ownership", async () => {
    const ownerCookie = await createAccount("meal-owner@example.com");
    const otherCookie = await createAccount("meal-other@example.com");
    const created = await request("/api/meals", {
      method: "POST", cookie: ownerCookie,
      body: { name: "Soup", instructions: "Simmer gently", ingredients: [{ name: "Carrot", quantity: 2, unit: "pieces" }] }
    });
    assert.equal(created.response.status, 201);
    const meal = created.data.meal;
    assert.equal(meal.ingredients.length, 1);
    assert.equal((await request("/api/meals", { cookie: ownerCookie })).data.meals.length, 1);
    assert.equal((await request(`/api/meals/${meal.id}`, { cookie: ownerCookie })).data.meal.name, "Soup");
    assert.equal((await request(`/api/meals/${meal.id}`, { cookie: otherCookie })).response.status, 404);
    const invalidMeal = await request("/api/meals", {
      method: "POST", cookie: ownerCookie, body: { name: "Invalid meal", ingredients: [{ name: "Salt", quantity: 0 }] }
    });
    assert.equal(invalidMeal.response.status, 400);

    const ingredient = await request(`/api/meals/${meal.id}/ingredients`, {
      method: "POST", cookie: ownerCookie, body: { name: "Water", quantity: 2, unit: "cups" }
    });
    assert.equal(ingredient.response.status, 201);
    const updatedIngredient = await request(`/api/meals/${meal.id}/ingredients/${ingredient.data.ingredient.id}`, {
      method: "PATCH", cookie: ownerCookie, body: { quantity: 3 }
    });
    assert.equal(updatedIngredient.data.ingredient.quantity, 3);
    assert.equal((await request(`/api/meals/${meal.id}/ingredients`, { cookie: ownerCookie })).data.ingredients.length, 2);
    assert.equal((await request(`/api/meals/${meal.id}/ingredients/${ingredient.data.ingredient.id}`, {
      method: "DELETE", cookie: otherCookie
    })).response.status, 404);

    const replaced = await request(`/api/meals/${meal.id}`, {
      method: "PATCH", cookie: ownerCookie, body: { ingredients: [{ name: "Potato" }] }
    });
    assert.deepEqual(replaced.data.meal.ingredients.map((entry) => entry.name), ["Potato"]);
    const updated = await request(`/api/meals/${meal.id}`, {
      method: "PATCH", cookie: ownerCookie, body: { name: "Potato soup" }
    });
    assert.equal(updated.data.meal.name, "Potato soup");
    assert.equal((await request(`/api/meals/${meal.id}`, { method: "DELETE", cookie: ownerCookie })).response.status, 204);
  });

  it("prevents cross-user access to shopping items and meal ingredients", async () => {
    const ownerCookie = await createAccount("resource-owner@example.com");
    const otherCookie = await createAccount("resource-other@example.com");
    const pantry = await request("/api/pantry", {
      method: "POST", cookie: ownerCookie, body: { name: "Owner's apples", quantity: 5 }
    });
    const shopping = await request("/api/shopping-list", {
      method: "POST", cookie: ownerCookie, body: { name: "Owner's milk", quantity: 1 }
    });
    const mealResult = await request("/api/meals", {
      method: "POST", cookie: ownerCookie, body: { name: "Owner's meal", ingredients: [{ name: "Rice" }] }
    });
    const meal = mealResult.data.meal;
    const ingredientId = meal.ingredients[0].id;

    assert.equal((await request(`/api/pantry/${pantry.data.item.id}`, {
      method: "PATCH", cookie: otherCookie, body: { quantity: 99 }
    })).response.status, 404);
    assert.equal((await request(`/api/pantry/${pantry.data.item.id}`, {
      method: "DELETE", cookie: otherCookie
    })).response.status, 404);
    assert.equal((await request(`/api/pantry/${pantry.data.item.id}`, { cookie: ownerCookie })).data.item.quantity, 5);

    assert.equal((await request("/api/shopping-list", { cookie: otherCookie })).data.items.length, 0);
    assert.equal((await request(`/api/shopping-list/${shopping.data.item.id}`, { cookie: otherCookie })).response.status, 404);
    assert.equal((await request(`/api/shopping-list/${shopping.data.item.id}`, {
      method: "PATCH", cookie: otherCookie, body: { quantity: 99 }
    })).response.status, 404);
    assert.equal((await request(`/api/shopping-list/${shopping.data.item.id}`, {
      method: "DELETE", cookie: otherCookie
    })).response.status, 404);
    assert.equal((await request("/api/shopping-list", { cookie: ownerCookie })).data.items[0].quantity, 1);

    assert.equal((await request("/api/meals", { cookie: otherCookie })).data.meals.length, 0);
    assert.equal((await request(`/api/meals/${meal.id}/ingredients`, { cookie: otherCookie })).response.status, 404);
    assert.equal((await request(`/api/meals/${meal.id}/ingredients/${ingredientId}`, {
      method: "PATCH", cookie: otherCookie, body: { name: "Changed" }
    })).response.status, 404);
    assert.equal((await request(`/api/meals/${meal.id}/ingredients/${ingredientId}`, {
      method: "DELETE", cookie: otherCookie
    })).response.status, 404);
    assert.equal((await request(`/api/meals/${meal.id}`, {
      method: "PATCH", cookie: otherCookie, body: { name: "Stolen meal" }
    })).response.status, 404);
    assert.equal((await request(`/api/meals/${meal.id}`, { method: "DELETE", cookie: otherCookie })).response.status, 404);
    assert.equal((await request(`/api/meals/${meal.id}`, { cookie: ownerCookie })).data.meal.name, "Owner's meal");
    assert.equal((await request(`/api/meals/${meal.id}/ingredients/${ingredientId}`, {
      method: "DELETE", cookie: ownerCookie
    })).response.status, 204);
    assert.equal((await request(`/api/meals/${meal.id}`, { cookie: ownerCookie })).data.meal.ingredients.length, 0);
  });

  it("serves the existing frontend", async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
  });
});