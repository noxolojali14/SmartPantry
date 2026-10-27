# SmartPantry

SmartPantry helps you keep track of groceries, expiry dates, shopping lists, and meal ideas. The project uses plain HTML, CSS, and JavaScript for the pages, an Express JSON API, and Supabase PostgreSQL for persistent data.

## Requirements

- Node.js 20 or newer
- npm
- A Supabase project

## Install and run

1. Install the packages from the project folder:

   ```powershell
   npm install
   ```

2. In the Supabase Dashboard, open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it. This creates the PostgreSQL tables, constraints, indexes, row-level security settings, timestamp triggers, and meal transaction functions.

3. In **Project Settings > API**, copy the Project URL and the `service_role` key. The service-role key is a server secret that bypasses RLS. Never put it in `public/`, frontend JavaScript, a `VITE_` variable, or source control.

4. Create your local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. Replace `SESSION_SECRET` with a randomly generated value. For example, run this command and paste its output into `.env`:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

6. Start the app:

   ```powershell
   npm start
   ```

7. Open <http://localhost:3000> in a browser.

If the connection is not working, run `npm run check:supabase`. It checks the configured URL/key and confirms that the `public.users` table is reachable before the web server starts.

Run `npm test` for offline API tests and schema/configuration checks. They use an in-memory Supabase test double and do not contact or modify a Supabase project. For live integration testing, create a separate Supabase test project, run the schema there, set `SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_ROLE_KEY`, and optionally `SUPABASE_TEST_SESSION_SECRET` in `.env`, then run `npm run test:supabase`. The live test creates and removes only accounts with a unique test email prefix in that test project.

The `.env` file, `node_modules`, and database files are excluded by `.gitignore`. Never commit real passwords, service-role keys, or session secrets. In production, use HTTPS and set `NODE_ENV=production`; session cookies are then marked `Secure`. The server binds to `127.0.0.1` in development; set `HOST` to the interface your deployment requires.

### Existing SQLite data

The app now reads and writes to Supabase. The old `data/smartpantry.sqlite` file and `src/database/schema.sql` are left untouched as legacy files; existing SQLite records have not been transferred. Do not delete the old database until any records you need have been separately backed up and migrated.

## API basics

The API is under `/api`. Send JSON with `Content-Type: application/json` for POST, PUT, and PATCH requests. Authentication uses an HTTP-only Express session cookie stored in Supabase's `sessions` table; the browser sends it automatically for same-origin requests. Accounts and scrypt password hashes are managed by this API, not Supabase Auth. Successful reads and writes return JSON, except successful deletes and logout, which return `204 No Content`. Errors use this shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "A helpful description"
  }
}
```

Registration and login:

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account with `name`, `email`, and `password` |
| POST | `/api/auth/login` | Start a session with `email` and `password` |
| POST | `/api/auth/logout` | End the current session |
| GET | `/api/auth/me` | Get the signed-in user's public profile |

Personal data routes require a signed-in user:

| Method | Endpoint | Description |
| --- | --- | --- |
| GET, POST | `/api/pantry` | List or create pantry items |
| GET, PUT, PATCH, DELETE | `/api/pantry/:id` | Read, update, or delete one pantry item |
| GET | `/api/pantry/expiry?status=soon&days=7` | Find items expiring within 1 to 30 days |
| GET | `/api/pantry/expiry?status=expired` | Find items with a past expiry date |
| GET, POST | `/api/shopping-list` | List or create shopping-list items |
| GET, PUT, PATCH, DELETE | `/api/shopping-list/:id` | Read, update, or delete one shopping-list item |
| GET, POST | `/api/meals` | List or create meals |
| GET, PUT, PATCH, DELETE | `/api/meals/:id` | Read, update, or delete one meal |
| GET, POST | `/api/meals/:mealId/ingredients` | List or add ingredients to a meal |
| PUT, PATCH, DELETE | `/api/meals/:mealId/ingredients/:ingredientId` | Update or delete a meal ingredient |

For pantry items, use `name`, a positive numeric `quantity`, and optional `unit`, `category`, and `expiryDate` (`YYYY-MM-DD`). Shopping-list items use `name`, positive `quantity`, optional `unit`, and optional boolean `isPurchased`. Meals use `name`, optional `instructions`, and optional `ingredients`; each ingredient has a `name` and optional positive `quantity` and `unit`. Updating a meal with an `ingredients` array replaces its ingredient list; the nested ingredient endpoints can also manage individual ingredients.

## Project layout

```text
public/                 Frontend pages, styles, and browser JavaScript
src/app.js               Express application and middleware setup
src/server.js            Environment loading and server startup
src/routes/              API route definitions
src/controllers/         API request handling and database operations
src/middleware/          Authentication, validation, and error handling
src/database/            Supabase client and session store
supabase/schema.sql      PostgreSQL schema for the Supabase SQL Editor
src/utils/               Password hashing helpers
tests/                   Offline API/schema tests and opt-in live Supabase test
```

## Security notes

- Passwords are hashed with Node's `scrypt`; plain-text passwords are never stored.
- Sessions are stored in Supabase PostgreSQL, use a regenerated session ID at login, and have HTTP-only, `SameSite=Lax` cookies. Production cookies also use `Secure`.
- Every personal-data query scopes records to the signed-in user. Meal ingredients are accessed through their parent meal, and deleting a meal removes its ingredients.
- RLS is enabled on application tables. The server's service-role client bypasses RLS, so API-side ownership filters are required on every personal-data query. Keep the service-role key server-side.
- Request bodies and query parameters are validated. Supabase client filters safely parameterize values, and meal/ingredient create and replacement operations use PostgreSQL functions so changes are atomic.
- State-changing API calls require same-origin JSON requests. Do not expose the development server directly to the public internet.# SmartPantry
# SmartPantry
