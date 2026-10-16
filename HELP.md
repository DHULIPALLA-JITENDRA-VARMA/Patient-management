# Careflow patient management

A single-page patient directory built with React and Vite, an Express API, and MySQL.

## Requirements

- Node.js 20.19+, 22.12+, or newer
- MySQL 8+

The API checks for the database named by `DB_NAME` (defaults to `patient_management`).
If it exists, the API uses it; if it does not, the API creates it. It also creates the
`patients` and `users` tables when missing. When upgrading the existing patient database,
it adds the nullable `doctor_id` column to `patients`; existing patients stay in place
and are initially unassigned. No existing records are deleted.

## Configure the database

From the project root, create the API environment file:

```powershell
Copy-Item server\.env.example server\.env
```

Edit `server\.env` and set:

- `DB_USER` and `DB_PASSWORD` for your MySQL account. The account needs permission to
  create the database only if it does not already exist, and permission to create or
  alter the app's tables.
- `JWT_SECRET` to a stable random secret at least 32 characters long. If omitted for
  local development, the API generates a temporary secret and existing sessions expire
  when the API restarts.
- Optionally set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12-72 characters), and `ADMIN_NAME`
  to create the initial admin automatically. Otherwise, open the app and use its
  **Set up your practice** form to create the first admin account.

Generate a JWT secret in PowerShell with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

When admin credentials are configured, the API creates that administrator on startup
if the email is unused and does not change an existing account's password. Without
those credentials, first-run setup in the UI creates the one-time initial admin. Do not
commit `server\.env`.

## Install and run

Open two terminals from the project root:

```powershell
cd server
npm install
npm run dev
```

```powershell
cd client
npm install
npm run dev
```

Open the Vite URL printed by the client (usually `http://localhost:5173`). The API listens on `http://localhost:4000`. `CLIENT_ORIGIN` in `server\.env` accepts a comma-separated list; by default it allows both `http://localhost:5173` and `http://127.0.0.1:5173`. To change the API URL for the client, create `client\.env` with `VITE_API_URL=http://localhost:4000/api`.

## Roles and patient assignments

- **Administrator:** signs in with the account configured in `server\.env`; can create,
  edit, assign, search, and delete patient records, and create doctor login accounts.
- **Doctor:** the administrator creates an account from the Doctors page and securely
  shares its email and password with the doctor. Doctors sign in through the same page
  and can view/search only patients assigned to their account. Patient changes and
  account management are administrator-only.
- Assign patients from the **Assigned doctor** field when adding or editing a patient.
  Existing patients remain unassigned until an administrator assigns them.
- Doctor passwords must be 12-72 characters and at most 72 bytes. Password-reset
  workflows are not included.

## API

- `GET /api/health` - service status
- `GET /api/auth/setup-status` and `POST /api/auth/setup` - check and create the
  one-time first administrator account
- `POST /api/auth/login` and `GET /api/auth/me` - sign in and validate a session
- `GET /api/patients?search=` - list permitted patients (all for admins; assigned only for doctors)
- `POST /api/patients`, `PUT /api/patients/:id`, `DELETE /api/patients/:id` - admin patient CRUD
- `GET /api/doctors`, `POST /api/doctors` - admin doctor account management
