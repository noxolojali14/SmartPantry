const tableNames = ["users", "sessions", "pantry_items", "shopping_list_items", "meals", "meal_ingredients"];

function databaseError(code, message) {
  return { code, message };
}

function clone(value) {
  return structuredClone(value);
}

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.operation = "select";
    this.payload = null;
    this.filters = [];
    this.orders = [];
    this.singleMode = "many";
    this.returnRows = false;
  }

  select() {
    this.returnRows = true;
    return this;
  }

  insert(values) {
    this.operation = "insert";
    this.payload = values;
    return this;
  }

  upsert(values) {
    this.operation = "upsert";
    this.payload = values;
    return this;
  }

  update(values) {
    this.operation = "update";
    this.payload = values;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => String(row[column]) === String(value));
    return this;
  }

  not(column, operator, value) {
    if (operator === "is" && value === null) this.filters.push((row) => row[column] !== null && row[column] !== undefined);
    return this;
  }

  lt(column, value) {
    this.filters.push((row) => row[column] < value);
    return this;
  }

  gte(column, value) {
    this.filters.push((row) => row[column] >= value);
    return this;
  }

  lte(column, value) {
    this.filters.push((row) => row[column] <= value);
    return this;
  }

  order(column, { ascending = true } = {}) {
    this.orders.push({ column, ascending });
    return this;
  }

  limit() {
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve().then(() => this.execute()).then(resolve, reject);
  }

  execute() {
    const rows = this.database.tables[this.table];
    if (!rows) return { data: null, error: databaseError("42P01", `Table ${this.table} does not exist.`) };

    if (this.operation === "insert") return this.insertRows(rows);
    if (this.operation === "upsert") return this.upsertRows(rows);

    let matches = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.operation === "update") {
      for (const row of matches) {
        Object.assign(row, clone(this.payload));
        if (row.updated_at !== undefined) row.updated_at = new Date().toISOString();
      }
    }
    if (this.operation === "delete") {
      this.database.tables[this.table] = rows.filter((row) => !matches.includes(row));
      matches = this.returnRows ? matches : [];
    }
    for (const order of [...this.orders].reverse()) {
      matches.sort((left, right) => {
        const leftValue = left[order.column];
        const rightValue = right[order.column];
        const comparison = typeof leftValue === "string" && typeof rightValue === "string"
          ? leftValue.localeCompare(rightValue)
          : leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
        return order.ascending ? comparison : -comparison;
      });
    }
    return this.result(matches);
  }

  insertRows(rows) {
    const input = Array.isArray(this.payload) ? this.payload : [this.payload];
    const inserted = [];
    for (const values of input) {
      const error = this.database.validateInsert(this.table, values);
      if (error) return { data: null, error };
      const row = this.database.createRow(this.table, values);
      rows.push(row);
      inserted.push(row);
    }
    return this.result(inserted);
  }

  upsertRows(rows) {
    const values = this.payload;
    if (this.table === "sessions") {
      const existing = rows.find((row) => row.sid === values.sid);
      if (existing) Object.assign(existing, clone(values));
      else rows.push(clone(values));
      return { data: null, error: null };
    }
    return this.insertRows(rows);
  }

  result(matches) {
    if (this.singleMode === "single") {
      if (matches.length !== 1) return { data: null, error: databaseError("PGRST116", "Expected exactly one row.") };
      return { data: clone(matches[0]), error: null };
    }
    if (this.singleMode === "maybe") {
      if (matches.length > 1) return { data: null, error: databaseError("PGRST116", "Expected at most one row.") };
      return { data: matches.length ? clone(matches[0]) : null, error: null };
    }
    return { data: clone(matches), error: null };
  }
}

export function createFakeSupabase() {
  const database = {
    tables: Object.fromEntries(tableNames.map((name) => [name, []])),
    nextIds: Object.fromEntries(tableNames.map((name) => [name, 1])),
    from(table) {
      return new FakeQuery(database, table);
    },
    rows(table) {
      return clone(database.tables[table]);
    },
    createRow(table, values) {
      const now = new Date().toISOString();
      if (table === "sessions") return clone(values);
      return {
        id: this.nextIds[table]++,
        ...clone(values),
        created_at: values.created_at || now,
        ...(Object.hasOwn(values, "updated_at") || ["pantry_items", "shopping_list_items", "meals"].includes(table)
          ? { updated_at: values.updated_at || now }
          : {})
      };
    },
    validateInsert(table, values) {
      if (table === "users" && this.tables.users.some((user) => user.email.toLowerCase() === values.email.toLowerCase())) {
        return databaseError("23505", "duplicate key value violates unique constraint");
      }
      if (["pantry_items", "shopping_list_items", "meals"].includes(table)
        && !this.tables.users.some((user) => user.id === Number(values.user_id))) {
        return databaseError("23503", "user does not exist");
      }
      if (table === "meal_ingredients" && !this.tables.meals.some((meal) => meal.id === Number(values.meal_id) && meal.user_id === Number(values.user_id))) {
        return databaseError("23503", "meal does not exist for user");
      }
      return null;
    },
    async rpc(functionName, parameters) {
      const originalTables = clone(this.tables);
      try {
        if (functionName === "create_meal_with_ingredients") {
          const meal = this.createRow("meals", {
            user_id: parameters.p_user_id,
            name: parameters.p_name,
            instructions: parameters.p_instructions || ""
          });
          this.tables.meals.push(meal);
          for (const ingredient of parameters.p_ingredients) {
            const values = { ...ingredient, meal_id: meal.id, user_id: parameters.p_user_id };
            const error = this.validateInsert("meal_ingredients", values);
            if (error) throw error;
            this.tables.meal_ingredients.push(this.createRow("meal_ingredients", values));
          }
          return { data: meal.id, error: null };
        }
        if (functionName === "update_meal_with_ingredients") {
          const meal = this.tables.meals.find((row) => row.id === Number(parameters.p_meal_id) && row.user_id === Number(parameters.p_user_id));
          if (!meal) return { data: null, error: databaseError("P0002", "meal_not_found") };
          Object.assign(meal, clone(parameters.p_fields), { updated_at: new Date().toISOString() });
          if (parameters.p_replace_ingredients) {
            this.tables.meal_ingredients = this.tables.meal_ingredients.filter((row) => row.meal_id !== meal.id);
            for (const ingredient of parameters.p_ingredients) {
              const values = { ...ingredient, meal_id: meal.id, user_id: parameters.p_user_id };
              const error = this.validateInsert("meal_ingredients", values);
              if (error) throw error;
              this.tables.meal_ingredients.push(this.createRow("meal_ingredients", values));
            }
          }
          return { data: meal.id, error: null };
        }
        return { data: null, error: databaseError("42883", `Unknown RPC: ${functionName}`) };
      } catch (error) {
        this.tables = originalTables;
        return { data: null, error };
      }
    }
  };
  return database;
}