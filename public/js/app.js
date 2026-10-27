const menuToggle = document.querySelector(".menu-toggle");
const primaryNav = document.querySelector(".primary-nav");
const appState = {
  pantryItems: [],
  shoppingItems: [],
  meals: [],
  redirecting: false
};

const protectedPages = new Set(["dashboard.html", "pantry.html", "expiry.html", "shopping-list.html", "meal-planner.html"]);

document.querySelectorAll("[data-resource-form], [data-auth-form]").forEach((form) => {
  const button = form.querySelector("button[type='submit']");
  if (button) button.dataset.baseLabel = button.textContent;
});

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showFormMessage(form, message, state = "") {
  const target = form.querySelector("[data-form-message]");
  if (!target) return;
  target.textContent = message;
  target.dataset.state = state;
}

function setNotice(message, state = "") {
  const notice = document.querySelector("[data-app-notice]");
  if (!notice) return;
  const text = notice.querySelector("p");
  if (text) text.textContent = message;
  notice.dataset.state = state;
}

function setBusy(form, busy, label) {
  const button = form.querySelector("button[type='submit']");
  if (!button) return;
  if (busy) {
    if (!button.dataset.baseLabel) button.dataset.baseLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.baseLabel || button.textContent;
    button.disabled = false;
  }
  form.setAttribute("aria-busy", String(busy));
}

function redirectToLogin() {
  if (appState.redirecting) return;
  appState.redirecting = true;
  const currentPage = window.location.pathname.split("/").pop() || "dashboard.html";
  window.location.replace(`login.html?next=${encodeURIComponent(currentPage)}`);
}

async function apiRequest(path, { method = "GET", body } = {}) {
  if (window.location.protocol === "file:") {
    throw new Error("Open SmartPantry through the running Express server. Opening this HTML file directly cannot reach the API.");
  }

  let response;
  try {
    const headers = { Accept: "application/json" };
    const options = { method, credentials: "same-origin", headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new Error("Unable to reach SmartPantry. Check your connection and try again.");
  }

  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && protectedPages.has(window.location.pathname.split("/").pop())) {
      setNotice("Your session has expired. Please log in again.", "error");
      redirectToLogin();
    }
    throw new Error(data?.error?.message || "The request could not be completed. Please try again.");
  }
  return data;
}

function showListLoading(section, message = "Loading...") {
  const list = section.querySelector("[data-record-list]");
  const empty = section.querySelector("[data-empty-state]");
  if (!list) return;
  list.replaceChildren(makeElement("p", "record-loading", message));
  list.hidden = false;
  if (empty) empty.hidden = true;
}

function renderList(section, records, renderRecord) {
  const list = section.querySelector("[data-record-list]");
  const empty = section.querySelector("[data-empty-state]");
  if (!list) return;
  list.replaceChildren(...records.map(renderRecord));
  list.hidden = records.length === 0;
  if (empty) empty.hidden = records.length > 0;
}

function showListError(section, message) {
  const list = section.querySelector("[data-record-list]");
  const empty = section.querySelector("[data-empty-state]");
  if (!list) return;
  list.replaceChildren(makeElement("p", "record-error", message));
  list.hidden = false;
  if (empty) empty.hidden = true;
}

function addField(form, labelText, name, value, type = "text", required = false) {
  const wrapper = makeElement("div", "field");
  const inputId = `field-${name}-${Math.random().toString(36).slice(2, 8)}`;
  const label = makeElement("label", "", labelText);
  label.htmlFor = inputId;
  const input = makeElement(type === "textarea" ? "textarea" : "input");
  input.id = inputId;
  input.name = name;
  if (type !== "textarea") input.type = type;
  if (type === "textarea") input.rows = 3;
  input.value = value ?? "";
  input.required = required;
  if (type === "number") {
    input.min = "0.01";
    input.step = "any";
  }
  wrapper.append(label, input);
  form.append(wrapper);
  return input;
}

function dateLabel(value) {
  if (!value) return "No expiry date";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function quantityLabel(quantity, unit) {
  return `${quantity}${unit ? ` ${unit}` : ""}`;
}

function setAuthenticatedNavigation(user) {
  const accountLink = document.querySelector(".nav-account");
  if (!accountLink) return;
  accountLink.textContent = "Log out";
  accountLink.href = "#logout";
  accountLink.setAttribute("aria-label", `Log out ${user.name}`);
  accountLink.addEventListener("click", async (event) => {
    event.preventDefault();
    accountLink.setAttribute("aria-disabled", "true");
    try {
      await apiRequest("/auth/logout", { method: "POST", body: {} });
      window.location.assign("login.html");
    } catch (error) {
      accountLink.removeAttribute("aria-disabled");
      setNotice(error.message, "error");
    }
  });
}

function setAuthNextDestination() {
  const next = new URLSearchParams(window.location.search).get("next");
  return protectedPages.has(next) ? next : "dashboard.html";
}

function bindAuthForms() {
  document.querySelectorAll("[data-auth-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const values = Object.fromEntries(new FormData(form).entries());
      const isLogin = form.dataset.authForm === "login";
      const body = isLogin
        ? { email: values.email, password: values.password }
        : { name: values.name, email: values.email, password: values.password };
      setBusy(form, true, isLogin ? "Signing in..." : "Creating account...");
      showFormMessage(form, "");

      try {
        await apiRequest(isLogin ? "/auth/login" : "/auth/register", { method: "POST", body });
        if (isLogin) {
          showFormMessage(form, "Signed in. Opening your pantry...", "success");
          window.location.assign(setAuthNextDestination());
          return;
        }
        form.reset();
        showFormMessage(form, "Your account was created. You can now log in.", "success");
      } catch (error) {
        showFormMessage(form, error.message, "error");
      } finally {
        setBusy(form, false);
      }
    });
  });
}

function createPantryRecord(item) {
  const row = makeElement("article", "record-row");
  const details = makeElement("div", "record-details");
  details.append(makeElement("h3", "record-name", item.name));
  details.append(makeElement("p", "record-meta", `${quantityLabel(item.quantity, item.unit)} · ${dateLabel(item.expiryDate)}`));
  if (item.category) details.append(makeElement("p", "record-meta", item.category));
  const actions = makeElement("div", "record-actions");
  const edit = makeElement("button", "button button-secondary button-small", "Edit");
  edit.type = "button";
  edit.dataset.action = "edit-pantry";
  edit.dataset.id = item.id;
  const remove = makeElement("button", "button button-small button-danger", "Delete");
  remove.type = "button";
  remove.dataset.action = "delete-pantry";
  remove.dataset.id = item.id;
  actions.append(edit, remove);
  row.append(details, actions);
  return row;
}

function renderPantry() {
  const section = document.querySelector(".list-section");
  if (!section) return;
  const query = document.querySelector("#pantry-search")?.value.trim().toLocaleLowerCase() || "";
  const items = appState.pantryItems.filter((item) => item.name.toLocaleLowerCase().includes(query));
  renderList(section, items, createPantryRecord);
}

function clearPantryEdit(form) {
  delete form.dataset.editId;
  form.reset();
  const submit = form.querySelector("button[type='submit']");
  if (submit) submit.textContent = "Add item";
  form.querySelector("[data-cancel-edit]")?.remove();
}

function startPantryEdit(form, item) {
  form.dataset.editId = item.id;
  for (const [name, value] of Object.entries({
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    expiryDate: item.expiryDate || ""
  })) {
    const input = form.elements.namedItem(name);
    if (input) input.value = value;
  }
  form.querySelector("button[type='submit']").textContent = "Save changes";
  if (!form.querySelector("[data-cancel-edit]")) {
    const cancel = makeElement("button", "button button-secondary", "Cancel edit");
    cancel.type = "button";
    cancel.dataset.cancelEdit = "true";
    form.querySelector(".form-submit").append(cancel);
    cancel.addEventListener("click", () => {
      clearPantryEdit(form);
      showFormMessage(form, "");
    });
  }
}

async function bindPantryForm() {
  const form = document.querySelector("[data-resource-form='pantry']");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const item = {
      name: values.get("name").trim(),
      quantity: Number(values.get("quantity")),
      unit: values.get("unit").trim(),
      expiryDate: values.get("expiryDate") || null
    };
    const itemId = form.dataset.editId;
    setBusy(form, true, itemId ? "Saving..." : "Adding...");
    showFormMessage(form, "");
    try {
      const result = await apiRequest(itemId ? `/pantry/${itemId}` : "/pantry", {
        method: itemId ? "PATCH" : "POST",
        body: item
      });
      if (itemId) {
        appState.pantryItems = appState.pantryItems.map((entry) => entry.id === result.item.id ? result.item : entry);
      } else {
        appState.pantryItems.push(result.item);
      }
      clearPantryEdit(form);
      renderPantry();
      showFormMessage(form, itemId ? "Pantry item updated." : "Pantry item added.", "success");
      setNotice("Your pantry is up to date.", "success");
    } catch (error) {
      showFormMessage(form, error.message, "error");
      setNotice(error.message, "error");
    } finally {
      setBusy(form, false);
    }
  });

  document.querySelector("#pantry-search")?.addEventListener("input", renderPantry);
  const section = document.querySelector(".list-section");
  section?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const item = appState.pantryItems.find((entry) => entry.id === Number(button.dataset.id));
    if (!item) return;
    if (button.dataset.action === "edit-pantry") {
      startPantryEdit(form, item);
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.elements.namedItem("name").focus();
      return;
    }
    button.disabled = true;
    try {
      await apiRequest(`/pantry/${item.id}`, { method: "DELETE" });
      appState.pantryItems = appState.pantryItems.filter((entry) => entry.id !== item.id);
      renderPantry();
      setNotice("Pantry item deleted.", "success");
    } catch (error) {
      button.disabled = false;
      setNotice(error.message, "error");
    }
  });
}

async function loadPantry() {
  const section = document.querySelector(".list-section");
  showListLoading(section);
  try {
    const result = await apiRequest("/pantry");
    appState.pantryItems = result.items;
    renderPantry();
    setNotice("Your pantry is up to date.");
  } catch (error) {
    showListError(section, error.message);
    setNotice(error.message, "error");
  }
}

function createShoppingRecord(item) {
  const row = makeElement("article", `record-row${item.isPurchased ? " is-purchased" : ""}`);
  const details = makeElement("div", "record-details");
  details.append(makeElement("h3", "record-name", item.name));
  if (item.unit) details.append(makeElement("p", "record-meta", item.unit));
  const quantityForm = makeElement("form", "quantity-form");
  quantityForm.dataset.quantityForm = item.id;
  addField(quantityForm, "Quantity", "quantity", item.quantity, "number", true);
  const save = makeElement("button", "button button-secondary button-small", "Save quantity");
  save.type = "submit";
  quantityForm.append(save);
  const actions = makeElement("div", "record-actions");
  const purchased = makeElement("button", "button button-secondary button-small", item.isPurchased ? "Mark not purchased" : "Mark purchased");
  purchased.type = "button";
  purchased.dataset.action = "toggle-purchased";
  purchased.dataset.id = item.id;
  const remove = makeElement("button", "button button-small button-danger", "Delete");
  remove.type = "button";
  remove.dataset.action = "delete-shopping";
  remove.dataset.id = item.id;
  actions.append(purchased, remove);
  row.append(details, quantityForm, actions);
  return row;
}

function renderShoppingList() {
  const section = document.querySelector(".list-section");
  if (!section) return;
  const completed = appState.shoppingItems.filter((item) => item.isPurchased).length;
  const count = document.querySelector("[data-shopping-count]");
  if (count) count.textContent = `${completed} of ${appState.shoppingItems.length} purchased`;
  renderList(section, appState.shoppingItems, createShoppingRecord);
}

function bindShoppingList() {
  const form = document.querySelector("[data-resource-form='shopping-list']");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const item = { name: values.get("name").trim(), quantity: Number(values.get("quantity")), unit: values.get("unit").trim() };
    setBusy(form, true, "Adding...");
    showFormMessage(form, "");
    try {
      const result = await apiRequest("/shopping-list", { method: "POST", body: item });
      appState.shoppingItems.push(result.item);
      form.reset();
      renderShoppingList();
      showFormMessage(form, "Item added to your shopping list.", "success");
      setNotice("Your shopping list is up to date.", "success");
    } catch (error) {
      showFormMessage(form, error.message, "error");
      setNotice(error.message, "error");
    } finally {
      setBusy(form, false);
    }
  });

  const section = document.querySelector(".list-section");
  section?.addEventListener("submit", async (event) => {
    const quantityForm = event.target.closest("[data-quantity-form]");
    if (!quantityForm) return;
    event.preventDefault();
    if (!quantityForm.reportValidity()) return;
    const itemId = Number(quantityForm.dataset.quantityForm);
    const quantity = Number(new FormData(quantityForm).get("quantity"));
    const button = quantityForm.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      const result = await apiRequest(`/shopping-list/${itemId}`, { method: "PATCH", body: { quantity } });
      appState.shoppingItems = appState.shoppingItems.map((item) => item.id === itemId ? result.item : item);
      renderShoppingList();
      setNotice("Quantity updated.", "success");
    } catch (error) {
      button.disabled = false;
      setNotice(error.message, "error");
    }
  });
  section?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const itemId = Number(button.dataset.id);
    const item = appState.shoppingItems.find((entry) => entry.id === itemId);
    if (!item) return;
    button.disabled = true;
    try {
      if (button.dataset.action === "toggle-purchased") {
        const result = await apiRequest(`/shopping-list/${itemId}`, { method: "PATCH", body: { isPurchased: !item.isPurchased } });
        appState.shoppingItems = appState.shoppingItems.map((entry) => entry.id === itemId ? result.item : entry);
        renderShoppingList();
        setNotice(result.item.isPurchased ? "Item marked as purchased." : "Item marked as not purchased.", "success");
      } else {
        await apiRequest(`/shopping-list/${itemId}`, { method: "DELETE" });
        appState.shoppingItems = appState.shoppingItems.filter((entry) => entry.id !== itemId);
        renderShoppingList();
        setNotice("Shopping-list item deleted.", "success");
      }
    } catch (error) {
      button.disabled = false;
      setNotice(error.message, "error");
    }
  });
}

async function loadShoppingList() {
  const section = document.querySelector(".list-section");
  showListLoading(section);
  try {
    const result = await apiRequest("/shopping-list");
    appState.shoppingItems = result.items;
    renderShoppingList();
    setNotice("Your shopping list is up to date.");
  } catch (error) {
    showListError(section, error.message);
    setNotice(error.message, "error");
  }
}

function createExpiryRecord(item) {
  const row = makeElement("article", "record-row");
  const details = makeElement("div", "record-details");
  details.append(makeElement("h3", "record-name", item.name));
  details.append(makeElement("p", "record-meta", `${quantityLabel(item.quantity, item.unit)} · ${dateLabel(item.expiryDate)}`));
  const link = makeElement("a", "text-link", "View pantry");
  link.href = "pantry.html";
  row.append(details, link);
  return row;
}

async function loadExpiry() {
  const sections = [...document.querySelectorAll("[data-expiry-list]")];
  sections.forEach((section) => showListLoading(section));
  try {
    const results = await Promise.all([
      apiRequest("/pantry/expiry?status=expired"),
      apiRequest("/pantry/expiry?status=soon&days=7")
    ]);
    sections.forEach((section, index) => {
      const result = results[index];
      renderList(section, result.items, createExpiryRecord);
      const count = section.querySelector("[data-count]");
      if (count) count.textContent = `${result.items.length} ${result.items.length === 1 ? "item" : "items"}`;
    });
    setNotice("Expiry dates are up to date.");
  } catch (error) {
    sections.forEach((section) => showListError(section, error.message));
    setNotice(error.message, "error");
  }
}

function createMealRecord(meal) {
  const row = makeElement("article", "record-row record-stack");
  const heading = makeElement("div", "record-heading");
  const details = makeElement("div", "record-details");
  details.append(makeElement("h3", "record-name", meal.name));
  if (meal.instructions) details.append(makeElement("p", "record-meta", meal.instructions));
  const actions = makeElement("div", "record-actions");
  const edit = makeElement("button", "button button-secondary button-small", "Edit meal");
  edit.type = "button";
  edit.dataset.action = "edit-meal";
  edit.dataset.id = meal.id;
  const remove = makeElement("button", "button button-small button-danger", "Delete meal");
  remove.type = "button";
  remove.dataset.action = "delete-meal";
  remove.dataset.id = meal.id;
  actions.append(edit, remove);
  heading.append(details, actions);

  const ingredientHeading = makeElement("h4", "record-subheading", "Ingredients");
  const ingredientList = makeElement("ul", "ingredient-list");
  for (const ingredient of meal.ingredients) {
    const ingredientRow = makeElement("li", "ingredient-record");
    const updateForm = makeElement("form", "ingredient-update-form");
    updateForm.dataset.ingredientForm = ingredient.id;
    addField(updateForm, "Ingredient", "name", ingredient.name, "text", true);
    addField(updateForm, "Quantity", "quantity", ingredient.quantity ?? "", "number");
    addField(updateForm, "Unit", "unit", ingredient.unit, "text");
    const update = makeElement("button", "button button-secondary button-small", "Save ingredient");
    update.type = "submit";
    const deleteIngredient = makeElement("button", "button button-small button-danger", "Remove");
    deleteIngredient.type = "button";
    deleteIngredient.dataset.action = "delete-ingredient";
    deleteIngredient.dataset.mealId = meal.id;
    deleteIngredient.dataset.ingredientId = ingredient.id;
    updateForm.append(update, deleteIngredient);
    ingredientRow.append(updateForm);
    ingredientList.append(ingredientRow);
  }
  if (meal.ingredients.length === 0) ingredientList.append(makeElement("li", "record-meta", "No ingredients added yet."));

  const addForm = makeElement("form", "ingredient-add-form");
  addForm.dataset.addIngredient = meal.id;
  addField(addForm, "Add ingredient", "name", "", "text", true);
  addField(addForm, "Quantity", "quantity", "", "number");
  addField(addForm, "Unit", "unit", "", "text");
  const addButton = makeElement("button", "button button-secondary button-small", "Add ingredient");
  addButton.type = "submit";
  addForm.append(addButton);
  row.append(heading, ingredientHeading, ingredientList, addForm);
  return row;
}

function renderMeals() {
  const section = document.querySelector(".list-section");
  if (section) renderList(section, appState.meals, createMealRecord);
}

function clearMealForm(form) {
  delete form.dataset.editId;
  form.reset();
  const submit = form.querySelector("button[type='submit']");
  if (submit) submit.textContent = "Save meal";
  form.querySelector("[data-cancel-edit]")?.remove();
}

function startMealEdit(form, meal) {
  form.dataset.editId = meal.id;
  form.elements.namedItem("name").value = meal.name;
  form.elements.namedItem("instructions").value = meal.instructions;
  form.elements.namedItem("ingredientName").value = "";
  form.elements.namedItem("ingredientQuantity").value = "";
  form.elements.namedItem("ingredientUnit").value = "";
  form.querySelector("button[type='submit']").textContent = "Save changes";
  if (!form.querySelector("[data-cancel-edit]")) {
    const cancel = makeElement("button", "button button-secondary", "Cancel edit");
    cancel.type = "button";
    cancel.dataset.cancelEdit = "true";
    form.querySelector(".form-submit").append(cancel);
    cancel.addEventListener("click", () => {
      clearMealForm(form);
      showFormMessage(form, "");
    });
  }
}

function updateMealState(meal) {
  appState.meals = appState.meals.map((entry) => entry.id === meal.id ? meal : entry);
  renderMeals();
}

function bindMealPlanner() {
  const form = document.querySelector("[data-resource-form='meals']");
  const section = document.querySelector(".list-section");
  if (!form || !section) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const meal = {
      name: values.get("name").trim(),
      instructions: values.get("instructions").trim()
    };
    const ingredientName = values.get("ingredientName").trim();
    if (!form.dataset.editId && ingredientName) {
      const ingredient = { name: ingredientName, unit: values.get("ingredientUnit").trim() };
      const quantity = values.get("ingredientQuantity");
      if (quantity) ingredient.quantity = Number(quantity);
      meal.ingredients = [ingredient];
    }
    const mealId = form.dataset.editId;
    setBusy(form, true, mealId ? "Saving..." : "Saving...");
    showFormMessage(form, "");
    try {
      if (mealId) {
        const result = await apiRequest(`/meals/${mealId}`, { method: "PATCH", body: meal });
        updateMealState(result.meal);
        clearMealForm(form);
        showFormMessage(form, "Meal updated.", "success");
      } else {
        const result = await apiRequest("/meals", { method: "POST", body: meal });
        appState.meals.push(result.meal);
        renderMeals();
        form.reset();
        showFormMessage(form, "Meal saved.", "success");
      }
      setNotice("Your meals are up to date.", "success");
    } catch (error) {
      showFormMessage(form, error.message, "error");
      setNotice(error.message, "error");
    } finally {
      setBusy(form, false);
    }
  });

  section.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    button.disabled = true;
    try {
      if (action === "edit-meal") {
        const meal = appState.meals.find((entry) => entry.id === Number(button.dataset.id));
        if (meal) {
          startMealEdit(form, meal);
          form.scrollIntoView({ behavior: "smooth", block: "center" });
          form.elements.namedItem("name").focus();
        }
        button.disabled = false;
        return;
      }
      if (action === "delete-meal") {
        const mealId = Number(button.dataset.id);
        await apiRequest(`/meals/${mealId}`, { method: "DELETE" });
        appState.meals = appState.meals.filter((meal) => meal.id !== mealId);
        renderMeals();
        setNotice("Meal deleted.", "success");
        return;
      }
      if (action === "delete-ingredient") {
        const mealId = Number(button.dataset.mealId);
        const ingredientId = Number(button.dataset.ingredientId);
        await apiRequest(`/meals/${mealId}/ingredients/${ingredientId}`, { method: "DELETE" });
        const meal = appState.meals.find((entry) => entry.id === mealId);
        if (meal) {
          meal.ingredients = meal.ingredients.filter((ingredient) => ingredient.id !== ingredientId);
          renderMeals();
        }
        setNotice("Ingredient removed.", "success");
      }
    } catch (error) {
      button.disabled = false;
      setNotice(error.message, "error");
    }
  });

  section.addEventListener("submit", async (event) => {
    const addForm = event.target.closest("[data-add-ingredient]");
    const updateForm = event.target.closest("[data-ingredient-form]");
    if (!addForm && !updateForm) return;
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    const values = new FormData(event.target);
    const ingredient = { name: values.get("name").trim(), unit: values.get("unit").trim() };
    const quantity = values.get("quantity");
    ingredient.quantity = quantity ? Number(quantity) : null;
    const button = event.target.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      if (addForm) {
        const mealId = Number(addForm.dataset.addIngredient);
        const result = await apiRequest(`/meals/${mealId}/ingredients`, { method: "POST", body: ingredient });
        const meal = appState.meals.find((entry) => entry.id === mealId);
        if (meal) meal.ingredients.push(result.ingredient);
        renderMeals();
        setNotice("Ingredient added.", "success");
      } else {
        const meal = appState.meals.find((entry) => entry.ingredients.some((item) => item.id === Number(updateForm.dataset.ingredientForm)));
        const ingredientId = Number(updateForm.dataset.ingredientForm);
        const result = await apiRequest(`/meals/${meal.id}/ingredients/${ingredientId}`, { method: "PATCH", body: ingredient });
        meal.ingredients = meal.ingredients.map((item) => item.id === ingredientId ? result.ingredient : item);
        renderMeals();
        setNotice("Ingredient updated.", "success");
      }
    } catch (error) {
      button.disabled = false;
      setNotice(error.message, "error");
    }
  });
}

async function loadMeals() {
  const section = document.querySelector(".list-section");
  showListLoading(section);
  try {
    const result = await apiRequest("/meals");
    appState.meals = result.meals;
    renderMeals();
    setNotice("Your meals are up to date.");
  } catch (error) {
    showListError(section, error.message);
    setNotice(error.message, "error");
  }
}

function createDashboardExpiry(item) {
  const row = makeElement("article", "record-row");
  const details = makeElement("div", "record-details");
  details.append(makeElement("h3", "record-name", item.name));
  details.append(makeElement("p", "record-meta", `${quantityLabel(item.quantity, item.unit)} · ${dateLabel(item.expiryDate)}`));
  row.append(details);
  return row;
}

function createDashboardShopping(item) {
  const row = makeElement("article", `record-row${item.isPurchased ? " is-purchased" : ""}`);
  const details = makeElement("div", "record-details");
  details.append(makeElement("h3", "record-name", item.name));
  details.append(makeElement("p", "record-meta", quantityLabel(item.quantity, item.unit)));
  row.append(details, makeElement("span", "quiet-label", item.isPurchased ? "Purchased" : "To buy"));
  return row;
}

async function loadDashboard() {
  const sections = [...document.querySelectorAll(".dashboard-lower .content-section")];
  sections.forEach((section) => showListLoading(section));
  try {
    const [pantryResult, expiryResult, shoppingResult] = await Promise.all([
      apiRequest("/pantry"),
      apiRequest("/pantry/expiry?status=soon&days=7"),
      apiRequest("/shopping-list")
    ]);
    document.querySelector("#pantry-total").textContent = String(pantryResult.items.length);
    document.querySelector("#expiring-total").textContent = String(expiryResult.items.length);
    const purchased = shoppingResult.items.filter((item) => item.isPurchased).length;
    document.querySelector("#shopping-progress").textContent = `${purchased} / ${shoppingResult.items.length}`;
    renderList(sections[0], expiryResult.items.slice(0, 5), createDashboardExpiry);
    renderList(sections[1], shoppingResult.items.slice(0, 5), createDashboardShopping);
    setNotice("Your dashboard is up to date.");
  } catch (error) {
    sections.forEach((section) => showListError(section, error.message));
    setNotice(error.message, "error");
  }
}

async function startProtectedPage() {
  try {
    const result = await apiRequest("/auth/me");
    setAuthenticatedNavigation(result.user);
  } catch (error) {
    setNotice(error.message, "error");
    return;
  }

  const page = window.location.pathname.split("/").pop();
  if (page === "dashboard.html") await loadDashboard();
  if (page === "pantry.html") {
    bindPantryForm();
    await loadPantry();
  }
  if (page === "expiry.html") await loadExpiry();
  if (page === "shopping-list.html") {
    bindShoppingList();
    await loadShoppingList();
  }
  if (page === "meal-planner.html") {
    bindMealPlanner();
    await loadMeals();
  }
}

if (menuToggle && primaryNav) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    primaryNav.classList.toggle("is-open", !isOpen);
  });

  primaryNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      menuToggle.setAttribute("aria-expanded", "false");
      primaryNav.classList.remove("is-open");
    }
  });
}

bindAuthForms();
if (document.body.classList.contains("app-page")) startProtectedPage();