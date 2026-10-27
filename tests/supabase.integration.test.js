import "dotenv/config";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { createSupabaseClient } from "../src/database/db.js";

const testUrl = process.env.SUPABASE_TEST_URL;
const testKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const runSupabaseTests = testUrl && testKey ? describe : describe.skip;

runSupabaseTests("Supabase live integration", () => {
  let activeServer;

  after(async () => {
    if (activeServer) await new Promise((resolve) => activeServer.server.close(resolve));
  });

  it("keeps auth, ownership, CRUD, sessions, and records across server restarts", async () => {
    const supabase = createSupabaseClient({ url: testUrl, serviceRoleKey: testKey });
    const sessionSecret = process.env.SUPABASE_TEST_SESSION_SECRET || "isolated-supabase-integration-test-session-secret";
    const emailPrefix = `smartpantry-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const users = [];
    const cookies = [];

    async function startServer() {
      const server = createApp({ supabase, sessionSecret }).listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      activeServer = { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
      return activeServer;
    }

    async function stopServer() {
      if (!activeServer) return;
      const { server } = activeServer;
      activeServer = null;
      await new Promise((resolve) => server.close(resolve));
    }

    async function request(path, { method = "GET", body, cookie } = {}) {
      const headers = {};
      if (body !== undefined) headers["content-type"] = "application/json";
      if (cookie) headers.cookie = cookie;
      const response = await fetch(`${activeServer.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { response, data: response.status === 204 ? null : await response.json() };
    }

    async function registerAndLogin(email) {
      const registration = await request("/api/auth/register", {
        method: "POST", body: { name: "Supabase Test", email, password: "integration-password-123" }
      });
      assert.equal(registration.response.status, 201);
      users.push(registration.data.user.id);
      const login = await request("/api/auth/login", {
        method: "POST", body: { email, password: "integration-password-123" }
      });
      assert.equal(login.response.status, 200);
      const cookie = login.response.headers.get("set-cookie").split(";")[0];
      cookies.push(cookie);
      return cookie;
    }

    try {
      await startServer();
      const ownerCookie = await registerAndLogin(`${emailPrefix}-owner@example.test`);
      const duplicate = await request("/api/auth/register", {
        method: "POST", body: { name: "Duplicate", email: `${emailPrefix}-owner@example.test`, password: "integration-password-123" }
      });
      assert.equal(duplicate.response.status, 409);
      const invalidLogin = await request("/api/auth/login", {
        method: "POST", body: { email: `${emailPrefix}-owner@example.test`, password: "incorrect-password" }
      });
      assert.equal(invalidLogin.response.status, 401);

      const otherCookie = await registerAndLogin(`${emailPrefix}-other@example.test`);
      const invalidInput = await request("/api/pantry", {
        method: "POST", cookie: ownerCookie, body: { name: "Invalid", quantity: 0 }
      });
      assert.equal(invalidInput.response.status, 400);

      const pantryCreate = await request("/api/pantry", {
        method: "POST", cookie: ownerCookie,
        body: { name: "Integration oats", quantity: 2, unit: "bags", expiryDate: "2099-01-10" }
      });
      assert.equal(pantryCreate.response.status, 201);
      const pantryId = pantryCreate.data.item.id;
      const pantryUpdate = await request(`/api/pantry/${pantryId}`, {
        method: "PATCH", cookie: ownerCookie, body: { quantity: 4 }
      });
      assert.equal(pantryUpdate.data.item.quantity, 4);

      const shoppingCreate = await request("/api/shopping-list", {
        method: "POST", cookie: ownerCookie, body: { name: "Integration apples", quantity: 3 }
      });
      assert.equal(shoppingCreate.response.status, 201);
      const shoppingId = shoppingCreate.data.item.id;
      const shoppingUpdate = await request(`/api/shopping-list/${shoppingId}`, {
        method: "PATCH", cookie: ownerCookie, body: { isPurchased: true }
      });
      assert.equal(shoppingUpdate.data.item.isPurchased, true);

      const mealCreate = await request("/api/meals", {
        method: "POST", cookie: ownerCookie,
        body: { name: "Integration soup", ingredients: [{ name: "Lentils", quantity: 2, unit: "cups" }] }
      });
      assert.equal(mealCreate.response.status, 201);
      const mealId = mealCreate.data.meal.id;
      const ingredientCreate = await request(`/api/meals/${mealId}/ingredients`, {
        method: "POST", cookie: ownerCookie, body: { name: "Water", quantity: 3, unit: "cups" }
      });
      assert.equal(ingredientCreate.response.status, 201);
      const ingredientId = ingredientCreate.data.ingredient.id;
      const ingredientUpdate = await request(`/api/meals/${mealId}/ingredients/${ingredientId}`, {
        method: "PATCH", cookie: ownerCookie, body: { quantity: 4 }
      });
      assert.equal(ingredientUpdate.data.ingredient.quantity, 4);
      const mealUpdate = await request(`/api/meals/${mealId}`, {
        method: "PATCH", cookie: ownerCookie, body: { name: "Integration lentil soup" }
      });
      assert.equal(mealUpdate.data.meal.name, "Integration lentil soup");

      assert.equal((await request("/api/pantry", { cookie: otherCookie })).data.items.length, 0);
      assert.equal((await request(`/api/pantry/${pantryId}`, { cookie: otherCookie })).response.status, 404);
      assert.equal((await request(`/api/shopping-list/${shoppingId}`, { cookie: otherCookie })).response.status, 404);
      assert.equal((await request(`/api/meals/${mealId}`, { cookie: otherCookie })).response.status, 404);
      assert.equal((await request(`/api/meals/${mealId}/ingredients/${ingredientId}`, { cookie: otherCookie })).response.status, 404);

      await stopServer();
      await startServer();
      assert.equal((await request("/api/auth/me", { cookie: ownerCookie })).data.user.email, `${emailPrefix}-owner@example.test`);
      assert.equal((await request(`/api/pantry/${pantryId}`, { cookie: ownerCookie })).data.item.quantity, 4);
      assert.equal((await request(`/api/shopping-list/${shoppingId}`, { cookie: ownerCookie })).data.item.isPurchased, true);
      assert.equal((await request(`/api/meals/${mealId}`, { cookie: ownerCookie })).data.meal.ingredients.length, 2);

      assert.equal((await request(`/api/pantry/${pantryId}`, { method: "DELETE", cookie: ownerCookie })).response.status, 204);
      assert.equal((await request(`/api/shopping-list/${shoppingId}`, { method: "DELETE", cookie: ownerCookie })).response.status, 204);
      assert.equal((await request(`/api/meals/${mealId}`, { method: "DELETE", cookie: ownerCookie })).response.status, 204);

      await stopServer();
      await startServer();
      assert.equal((await request("/api/pantry", { cookie: ownerCookie })).data.items.length, 0);
      assert.equal((await request("/api/shopping-list", { cookie: ownerCookie })).data.items.length, 0);
      assert.equal((await request("/api/meals", { cookie: ownerCookie })).data.meals.length, 0);
    } finally {
      if (activeServer) await stopServer();
      for (const cookie of cookies) {
        const sessionId = decodeURIComponent(cookie.split("=")[1]);
        await supabase.from("sessions").delete().eq("sid", sessionId);
      }
      for (const userId of users) await supabase.from("users").delete().eq("id", userId);
    }
  });
});