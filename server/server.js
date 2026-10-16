import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { randomBytes, randomUUID } from "node:crypto";

const app = express();
const port = Number(process.env.PORT || 4000);
const databaseName = process.env.DB_NAME || "patient_management";
const jwtSecret = process.env.JWT_SECRET || randomBytes(32).toString("hex");
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const patientFields =
  "p.id, p.name, p.email, p.phone, p.date_of_birth, p.gender, p.doctor_id, d.name AS doctor_name, p.created_at";

app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
}));
app.use(express.json());

let pool;

function requireAuth(request, response, next) {
  const authorization = request.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return response.status(401).json({ error: "Sign in to continue." });
  }

  try {
    request.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    response.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

function requireAdmin(request, response, next) {
  if (request.user.role !== "admin") {
    return response.status(403).json({ error: "Administrator access is required." });
  }
  next();
}

function validatePatient(body) {
  body = body && typeof body === "object" ? body : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const dateOfBirth = body.date_of_birth || null;
  const gender = body.gender || "Prefer not to say";
  const doctorId = body.doctor_id || null;

  if (!name || name.length > 120) {
    return { error: "Name is required and must be at most 120 characters." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
    return { error: "Enter a valid email address." };
  }
  if (phone.length > 40) {
    return { error: "Phone must be at most 40 characters." };
  }
  if (dateOfBirth) {
    if (typeof dateOfBirth !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      return { error: "Enter a valid date of birth." };
    }
    const parsedDate = new Date(`${dateOfBirth}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateOfBirth) {
      return { error: "Enter a valid date of birth." };
    }
  }
  if (!["Female", "Male", "Non-binary", "Prefer not to say"].includes(gender)) {
    return { error: "Choose a valid gender option." };
  }
  if (doctorId !== null && typeof doctorId !== "string") {
    return { error: "Choose a valid doctor." };
  }

  return { patient: { name, email, phone: phone || null, dateOfBirth, gender, doctorId } };
}

async function validateDoctorAssignment(doctorId) {
  if (!doctorId) return true;
  const [doctors] = await pool.execute("SELECT id FROM users WHERE id = ? AND role = 'doctor'", [doctorId]);
  return doctors.length > 0;
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/auth/setup-status", async (_request, response, next) => {
  try {
    const [admins] = await pool.execute("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    response.json({ setupRequired: Number(admins[0].count) === 0 });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/setup", async (request, response, next) => {
  const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (!name || name.length > 120) {
    return response.status(400).json({ error: "Name is required and must be at most 120 characters." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 12 || password.length > 72 || Buffer.byteLength(password, "utf8") > 72) {
    return response.status(400).json({ error: "Password must be 12 to 72 characters and at most 72 bytes." });
  }

  let connection;
  let lockAcquired = false;
  try {
    connection = await pool.getConnection();
    const [locks] = await connection.execute("SELECT GET_LOCK('careflow_initial_admin_setup', 10) AS acquired");
    lockAcquired = Number(locks[0].acquired) === 1;
    if (!lockAcquired) {
      return response.status(503).json({ error: "Could not start account setup. Please try again." });
    }

    const [admins] = await connection.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (admins.length > 0) {
      return response.status(409).json({ error: "Practice setup is already complete. Sign in instead." });
    }

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.execute(
      "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')",
      [id, name, email, passwordHash],
    );
    const user = { id, name, email, role: "admin" };
    const token = jwt.sign(user, jwtSecret, { expiresIn: "8h" });
    response.status(201).json({ token, user });
  } catch (error) {
    next(error);
  } finally {
    if (connection) {
      if (lockAcquired) {
        await connection.execute("SELECT RELEASE_LOCK('careflow_initial_admin_setup')");
      }
      connection.release();
    }
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const [users] = await pool.execute(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = ?",
      [email],
    );
    const user = users[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return response.status(401).json({ error: "Incorrect email or password." });
    }

    const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    const token = jwt.sign(safeUser, jwtSecret, { expiresIn: "8h" });
    response.json({ token, user: safeUser });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, (request, response) => {
  const { id, name, email, role } = request.user;
  response.json({ id, name, email, role });
});

app.get("/api/doctors", requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [doctors] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.created_at, COUNT(p.id) AS patient_count
       FROM users u
       LEFT JOIN patients p ON p.doctor_id = u.id
       WHERE u.role = 'doctor'
       GROUP BY u.id, u.name, u.email, u.created_at
       ORDER BY u.name`,
    );
    response.json(doctors);
  } catch (error) {
    next(error);
  }
});

app.post("/api/doctors", requireAuth, requireAdmin, async (request, response, next) => {
  const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (!name || name.length > 120) {
    return response.status(400).json({ error: "Doctor name is required and must be at most 120 characters." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 12 || password.length > 72 || Buffer.byteLength(password, "utf8") > 72) {
    return response.status(400).json({ error: "Doctor passwords must be 12 to 72 characters and at most 72 bytes." });
  }

  try {
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.execute(
      "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'doctor')",
      [id, name, email, passwordHash],
    );
    response.status(201).json({ id, name, email, patient_count: 0 });
  } catch (error) {
    next(error);
  }
});

app.get("/api/patients", requireAuth, async (request, response, next) => {
  try {
    const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
    const doctorScope = request.user.role === "doctor" ? "AND p.doctor_id = ?" : "";
    const params = [`%${search}%`, `%${search}%`, `%${search}%`];
    if (request.user.role === "doctor") params.push(request.user.id);
    const [patients] = await pool.execute(
      `SELECT ${patientFields} FROM patients p
       LEFT JOIN users d ON d.id = p.doctor_id
       WHERE (p.name LIKE ? OR p.email LIKE ? OR COALESCE(p.phone, '') LIKE ?)
       ${doctorScope}
       ORDER BY p.created_at DESC`,
      params,
    );
    response.json(patients);
  } catch (error) {
    next(error);
  }
});

app.post("/api/patients", requireAuth, requireAdmin, async (request, response, next) => {
  const result = validatePatient(request.body);
  if (result.error) {
    return response.status(400).json({ error: result.error });
  }

  try {
    const patient = { id: randomUUID(), ...result.patient };
    if (!(await validateDoctorAssignment(patient.doctorId))) {
      return response.status(400).json({ error: "Choose an existing doctor." });
    }
    await pool.execute(
      `INSERT INTO patients (id, name, email, phone, date_of_birth, gender, doctor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        patient.id,
        patient.name,
        patient.email,
        patient.phone,
        patient.dateOfBirth,
        patient.gender,
        patient.doctorId,
      ],
    );
    const [rows] = await pool.execute(
      `SELECT ${patientFields} FROM patients p LEFT JOIN users d ON d.id = p.doctor_id WHERE p.id = ?`,
      [patient.id],
    );
    response.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put("/api/patients/:id", requireAuth, requireAdmin, async (request, response, next) => {
  const result = validatePatient(request.body);
  if (result.error) {
    return response.status(400).json({ error: result.error });
  }

  try {
    const patient = result.patient;
    if (!(await validateDoctorAssignment(patient.doctorId))) {
      return response.status(400).json({ error: "Choose an existing doctor." });
    }
    const [update] = await pool.execute(
      `UPDATE patients
       SET name = ?, email = ?, phone = ?, date_of_birth = ?, gender = ?, doctor_id = ?
       WHERE id = ?`,
      [
        patient.name,
        patient.email,
        patient.phone,
        patient.dateOfBirth,
        patient.gender,
        patient.doctorId,
        request.params.id,
      ],
    );
    if (update.affectedRows === 0) {
      return response.status(404).json({ error: "Patient not found." });
    }
    const [rows] = await pool.execute(
      `SELECT ${patientFields} FROM patients p LEFT JOIN users d ON d.id = p.doctor_id WHERE p.id = ?`,
      [request.params.id],
    );
    response.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/patients/:id", requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const [result] = await pool.execute("DELETE FROM patients WHERE id = ?", [request.params.id]);
    if (result.affectedRows === 0) {
      return response.status(404).json({ error: "Patient not found." });
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  if (error.code === "ER_DUP_ENTRY") {
    return response.status(409).json({ error: "That email address is already in use." });
  }
  console.error(error);
  response.status(500).json({ error: "An unexpected server error occurred." });
});

async function start() {
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (jwtSecret.length < 32) {
    throw new Error("Set JWT_SECRET to a random value of at least 32 characters in server/.env.");
  }
  if ((adminEmail || adminPassword) && (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) ||
    adminPassword.length < 12 ||
    adminPassword.length > 72 ||
    Buffer.byteLength(adminPassword, "utf8") > 72
  )) {
    throw new Error("If configured, ADMIN_EMAIL and ADMIN_PASSWORD must be valid and the password must be 12 to 72 characters.");
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  });
  const [databases] = await connection.execute(
    "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?",
    [databaseName],
  );
  if (databases.length === 0) {
    await connection.query(`CREATE DATABASE \`${databaseName.replaceAll("`", "``")}\``);
    console.log(`Created MySQL database "${databaseName}".`);
  } else {
    console.log(`Using existing MySQL database "${databaseName}".`);
  }
  await connection.end();

  pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: databaseName,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
  });
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(100) NOT NULL,
      role ENUM('admin', 'doctor') NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS patients (
      id CHAR(36) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      phone VARCHAR(40) NULL,
      date_of_birth DATE NULL,
      gender VARCHAR(30) NOT NULL DEFAULT 'Prefer not to say',
      doctor_id CHAR(36) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [patientColumns] = await pool.execute(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'patients' AND COLUMN_NAME = 'doctor_id'",
    [databaseName],
  );
  if (patientColumns.length === 0) {
    await pool.execute("ALTER TABLE patients ADD COLUMN doctor_id CHAR(36) NULL AFTER gender");
  }
  const [doctorConstraints] = await pool.execute(
    "SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'patients' AND COLUMN_NAME = 'doctor_id' AND REFERENCED_TABLE_NAME = 'users'",
    [databaseName],
  );
  if (doctorConstraints.length === 0) {
    await pool.execute(
      "ALTER TABLE patients ADD CONSTRAINT fk_patients_doctor FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE SET NULL",
    );
  }

  if (adminEmail && adminPassword) {
    const [admins] = await pool.execute("SELECT id FROM users WHERE email = ? AND role = 'admin'", [adminEmail]);
    if (admins.length === 0) {
      const [existingUsers] = await pool.execute("SELECT id FROM users WHERE email = ?", [adminEmail]);
      if (existingUsers.length > 0) {
        throw new Error("ADMIN_EMAIL is already registered to a non-admin account.");
      }
      const adminHash = await bcrypt.hash(adminPassword, 12);
      await pool.execute(
        "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')",
        [randomUUID(), process.env.ADMIN_NAME?.trim() || "Practice Administrator", adminEmail, adminHash],
      );
      console.log(`Created administrator account "${adminEmail}".`);
    } else {
      console.log(`Using existing administrator account "${adminEmail}".`);
    }
  }

  if (!process.env.JWT_SECRET) {
    console.warn("JWT_SECRET is not set; a temporary development secret is in use and sessions will expire when the API restarts.");
  }

  app.listen(port, () => {
    console.log(`Patient API listening at http://localhost:${port}`);
  });
}

start().catch(async (error) => {
  console.error("Could not start the API. Check MySQL and the DB_*, JWT_SECRET, and ADMIN_* settings.", error);
  await pool?.end();
  process.exitCode = 1;
});
