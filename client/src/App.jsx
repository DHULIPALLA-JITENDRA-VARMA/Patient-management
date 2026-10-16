import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const emptyPatient = {
  name: "",
  email: "",
  phone: "",
  date_of_birth: "",
  gender: "Prefer not to say",
  doctor_id: "",
};
const emptyDoctor = { name: "", email: "", password: "" };

async function request(path, options = {}, token = "") {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "The request could not be completed.");
  }
  return response.status === 204 ? null : response.json();
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function formatDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${String(date).slice(0, 10)}T00:00:00`),
  );
}

export default function App() {
  const [token, setToken] = useState(() => window.localStorage.getItem("careflow_token") || "");
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupMode, setSetupMode] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [setupForm, setSetupForm] = useState({ name: "", email: "", password: "" });
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("patients");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState("");
  const [editingPatient, setEditingPatient] = useState(null);
  const [patientForm, setPatientForm] = useState(emptyPatient);
  const [doctorForm, setDoctorForm] = useState(emptyDoctor);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) {
      setUser(null);
      request("/auth/setup-status")
        .then(({ setupRequired: required }) => {
          if (active) {
            setSetupRequired(required);
            setSetupMode(required);
            setError("");
          }
        })
        .catch((setupError) => {
          if (active) setError(setupError.message);
        })
        .finally(() => {
          if (active) setAuthLoading(false);
        });
      return () => { active = false; };
    }

    setAuthLoading(true);
    request("/auth/me", {}, token)
      .then((currentUser) => {
        if (active) setUser(currentUser);
      })
      .catch(() => {
        window.localStorage.removeItem("careflow_token");
        if (active) {
          setToken("");
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });

    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!user || !token) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await request(`/patients?search=${encodeURIComponent(search)}`, {}, token);
        if (active) setPatients(data);
      } catch (loadError) {
        if (active) setError(loadError.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [user, token, search]);

  useEffect(() => {
    if (!user || user.role !== "admin" || !token) return undefined;
    let active = true;
    request("/doctors", {}, token)
      .then((data) => {
        if (active) setDoctors(data);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      });
    return () => { active = false; };
  }, [user, token, patients]);

  async function refreshPatients() {
    const data = await request(`/patients?search=${encodeURIComponent(search)}`, {}, token);
    setPatients(data);
  }

  async function refreshDoctors() {
    if (user?.role !== "admin") return;
    const data = await request("/doctors", {}, token);
    setDoctors(data);
  }

  async function signIn(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm),
      });
      window.localStorage.setItem("careflow_token", result.token);
      setUser(result.user);
      setToken(result.token);
      setView("patients");
      setLoginForm({ email: "", password: "" });
      setSetupForm({ name: "", email: "", password: "" });
      setSetupRequired(false);
      setSetupMode(false);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSaving(false);
    }
  }

  async function createFirstAdmin(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await request("/auth/setup", {
        method: "POST",
        body: JSON.stringify(setupForm),
      });
      window.localStorage.setItem("careflow_token", result.token);
      setUser(result.user);
      setToken(result.token);
      setView("patients");
      setSetupRequired(false);
      setSetupMode(false);
      setSetupForm({ name: "", email: "", password: "" });
    } catch (setupError) {
      setError(setupError.message);
      if (setupError.message.includes("already complete")) {
        setSetupRequired(false);
        setSetupMode(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function signOut() {
    window.localStorage.removeItem("careflow_token");
    setToken("");
    setUser(null);
    setPatients([]);
    setDoctors([]);
    setSearch("");
    setView("patients");
    setError("");
  }

  const todayCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return patients.filter((patient) => String(patient.created_at).slice(0, 10) === today).length;
  }, [patients]);

  function openNewPatient() {
    setEditingPatient(null);
    setPatientForm(emptyPatient);
    setError("");
    setDialog("patient");
  }

  function openEditPatient(patient) {
    setEditingPatient(patient);
    setPatientForm({
      name: patient.name,
      email: patient.email,
      phone: patient.phone || "",
      date_of_birth: patient.date_of_birth ? String(patient.date_of_birth).slice(0, 10) : "",
      gender: patient.gender,
      doctor_id: patient.doctor_id || "",
    });
    setError("");
    setDialog("patient");
  }

  async function savePatient(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request(editingPatient ? `/patients/${editingPatient.id}` : "/patients", {
        method: editingPatient ? "PUT" : "POST",
        body: JSON.stringify(patientForm),
      }, token);
      setDialog("");
      setNotice(editingPatient ? "Patient details updated." : "Patient added successfully.");
      await refreshPatients();
      await refreshDoctors();
      window.setTimeout(() => setNotice(""), 3000);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deletePatient(patient) {
    if (!window.confirm(`Remove ${patient.name} from your patient list?`)) return;
    setError("");
    try {
      await request(`/patients/${patient.id}`, { method: "DELETE" }, token);
      setNotice("Patient removed.");
      await refreshPatients();
      await refreshDoctors();
      window.setTimeout(() => setNotice(""), 3000);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function saveDoctor(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request("/doctors", {
        method: "POST",
        body: JSON.stringify(doctorForm),
      }, token);
      setDialog("");
      setDoctorForm(emptyDoctor);
      setNotice("Doctor account created. They can now sign in with this email and password.");
      await refreshDoctors();
      window.setTimeout(() => setNotice(""), 4000);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return <div className="auth-screen"><div className="auth-card"><div className="brand-mark">+</div><p>Checking your session...</p></div></div>;
  }

  if (!user) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={setupMode ? createFirstAdmin : signIn}>
          <a className="brand login-brand" href="#"><span className="brand-mark">+</span><span>careflow</span></a>
          <p className="eyebrow">{setupMode ? "FIRST-TIME SETUP" : "SECURE PRACTICE PORTAL"}</p>
          <h1>{setupMode ? "Set up your practice" : "Welcome back"}</h1>
          <p className="auth-subtitle">{setupMode ? "Create your administrator account to get started." : "Sign in to access your patient workspace."}</p>
          {error && <div className="alert error-alert" role="alert">{error}</div>}
          {setupMode && <label className="form-field">Your name<input autoFocus required maxLength="120" autoComplete="name" value={setupForm.name} onChange={(event) => setSetupForm({ ...setupForm, name: event.target.value })} placeholder="e.g. Practice Administrator" /></label>}
          <label className="form-field">Email address<input autoFocus={!setupMode} required type="email" autoComplete="username" value={setupMode ? setupForm.email : loginForm.email} onChange={(event) => setupMode ? setSetupForm({ ...setupForm, email: event.target.value }) : setLoginForm({ ...loginForm, email: event.target.value })} placeholder="you@clinic.com" /></label>
          <label className="form-field">{setupMode ? "Create password" : "Password"}<input required type="password" minLength={setupMode ? 12 : undefined} maxLength="72" autoComplete={setupMode ? "new-password" : "current-password"} value={setupMode ? setupForm.password : loginForm.password} onChange={(event) => setupMode ? setSetupForm({ ...setupForm, password: event.target.value }) : setLoginForm({ ...loginForm, password: event.target.value })} placeholder={setupMode ? "At least 12 characters" : "Enter your password"} /></label>
          <button className="primary-button auth-submit" type="submit" disabled={saving}>{saving ? setupMode ? "Creating account..." : "Signing in..." : setupMode ? "Create administrator account" : "Sign in"}</button>
          {setupRequired && <span className="auth-footnote">This one-time setup creates the practice's first administrator. Doctors are added by an administrator.</span>}
          {!setupRequired && <span className="auth-footnote">Sign in with your administrator or doctor account.</span>}
        </form>
      </div>
    );
  }

  const isAdmin = user.role === "admin";
  const title = view === "doctors" ? "Doctors" : isAdmin ? "Patients" : "My patients";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Careflow home"><span className="brand-mark">+</span><span>careflow</span></a>
        <p className="nav-label">WORKSPACE</p>
        <button className={`nav-item ${view === "patients" ? "active" : ""}`} onClick={() => setView("patients")}><span className="nav-icon">▦</span>{isAdmin ? "Patients" : "My patients"}<span className="nav-count">{patients.length}</span></button>
        {isAdmin && <button className={`nav-item ${view === "doctors" ? "active" : ""}`} onClick={() => setView("doctors")}><span className="nav-icon">♙</span>Doctors<span className="nav-count">{doctors.length}</span></button>}
        {isAdmin && view === "patients" && <button className="nav-item" onClick={openNewPatient}><span className="nav-icon">＋</span>Add patient</button>}
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon">i</span><strong>Need a hand?</strong><span>{isAdmin ? "Assign patients to doctors so they can see their own care list." : "Your list only includes patients assigned to your account."}</span></div>
          <div className="profile"><div className="profile-avatar">{initials(user.name)}</div><div><strong>{user.name}</strong><span>{isAdmin ? "Administrator" : "Doctor"}</span></div><button className="profile-dots" onClick={signOut} aria-label="Sign out" title="Sign out">↪</button></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-divider">/</span><strong>{title}</strong></div>
          <div className="topbar-right"><span className="today-date">{new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span><div className="top-avatar">{initials(user.name)}</div><button className="signout-button" onClick={signOut}>Sign out</button></div>
        </header>

        <section className="page-content">
          <div className="page-heading">
            <div><p className="eyebrow">{view === "doctors" ? "CARE TEAM" : isAdmin ? "YOUR PRACTICE" : "YOUR ASSIGNED PATIENTS"}</p><h1>{title} <span className="heading-count">{view === "doctors" ? doctors.length : patients.length}</span></h1><p className="subtitle">{view === "doctors" ? "Manage doctor accounts and their patient assignments." : isAdmin ? "Manage patient records and assign them to your care team." : "A private directory of patients assigned to your account."}</p></div>
            {isAdmin && view === "patients" && <button className="primary-button" onClick={openNewPatient}><span>＋</span>Add patient</button>}
            {isAdmin && view === "doctors" && <button className="primary-button" onClick={() => { setDoctorForm(emptyDoctor); setError(""); setDialog("doctor"); }}><span>＋</span>Add doctor</button>}
          </div>

          <div className="stats-grid">
            <article className="stat-card"><div className="stat-top"><span>{view === "doctors" ? "Doctor accounts" : isAdmin ? "Total patients" : "My patients"}</span><span className="stat-icon purple">♙</span></div><strong>{view === "doctors" ? doctors.length : patients.length}</strong><span className="stat-caption">{view === "doctors" ? "Active practice accounts" : isAdmin ? "In your patient directory" : "Assigned to your account"}</span></article>
            <article className="stat-card"><div className="stat-top"><span>Added today</span><span className="stat-icon mint">↗</span></div><strong>{todayCount}</strong><span className="stat-caption">New patient records today</span></article>
            <article className="stat-card"><div className="stat-top"><span>Directory status</span><span className="stat-icon amber">✓</span></div><strong className="status-value"><span className="status-dot" /> Up to date</strong><span className="stat-caption">Your records are ready</span></article>
          </div>

          <section className="directory-card">
            <div className="directory-heading">
              <div><h2>{view === "doctors" ? "Doctor accounts" : isAdmin ? "Patient directory" : "My patient directory"}</h2><p>{view === "doctors" ? "Doctor login accounts for your practice." : isAdmin ? "View, assign, and manage everyone in your practice." : "Only patients assigned to you are shown here."}</p></div>
              {view === "patients" && <div className="directory-actions"><label className="search-box"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patients..." aria-label="Search patients" /><kbd>/</kbd></label><button className="filter-button" aria-label="Directory options">☷</button></div>}
            </div>

            {error && <div className="alert error-alert" role="alert">{error}</div>}
            {notice && <div className="alert success-alert" role="status">{notice}</div>}
            {view === "doctors" ? (
              <div className="table-wrap"><table><thead><tr><th>DOCTOR</th><th>EMAIL ADDRESS</th><th>ASSIGNED PATIENTS</th><th>ACCOUNT CREATED</th></tr></thead><tbody>
                {doctors.length === 0 ? <tr><td className="empty-state" colSpan="4"><span className="empty-icon">♙</span><strong>No doctor accounts yet</strong><span>Add a doctor account, then assign patients from the patient form.</span><button className="text-button" onClick={() => { setDoctorForm(emptyDoctor); setDialog("doctor"); }}>Add a doctor</button></td></tr> : doctors.map((doctor, index) => <tr key={doctor.id}><td><div className="patient-cell"><div className={`patient-avatar avatar-${index % 5}`}>{initials(doctor.name)}</div><div><strong>{doctor.name}</strong><span>Doctor</span></div></div></td><td className="muted-cell">{doctor.email}</td><td className="muted-cell">{doctor.patient_count}</td><td className="muted-cell">{formatDate(doctor.created_at)}</td></tr>)}
              </tbody></table></div>
            ) : (
              <div className="table-wrap"><table><thead><tr><th>PATIENT</th><th>EMAIL ADDRESS</th><th>PHONE</th><th>DATE OF BIRTH</th>{isAdmin && <th>ASSIGNED DOCTOR</th>}<th>ADDED</th>{isAdmin && <th aria-label="Actions" />}</tr></thead><tbody>
                {loading ? <tr><td className="empty-state" colSpan={isAdmin ? 7 : 5}>Loading patient records...</td></tr> : patients.length === 0 ? <tr><td className="empty-state" colSpan={isAdmin ? 7 : 5}><span className="empty-icon">♙</span><strong>{search ? "No matching patients" : isAdmin ? "No patients yet" : "No patients assigned yet"}</strong><span>{search ? "Try a different name, email, or phone number." : isAdmin ? "Add your first patient to get started." : "Ask your administrator to assign patients to your account."}</span>{isAdmin && !search && <button className="text-button" onClick={openNewPatient}>Add your first patient</button>}</td></tr> : patients.map((patient, index) => <tr key={patient.id}>
                  <td><div className="patient-cell"><div className={`patient-avatar avatar-${index % 5}`}>{initials(patient.name)}</div><div><strong>{patient.name}</strong><span>{patient.gender}</span></div></div></td>
                  <td className="muted-cell">{patient.email}</td><td className="muted-cell">{patient.phone || "—"}</td><td className="muted-cell">{formatDate(patient.date_of_birth)}</td>
                  {isAdmin && <td className="muted-cell">{patient.doctor_name || "Unassigned"}</td>}<td className="muted-cell">{formatDate(patient.created_at)}</td>
                  {isAdmin && <td><div className="row-actions"><button onClick={() => openEditPatient(patient)} aria-label={`Edit ${patient.name}`}>Edit</button><button onClick={() => deletePatient(patient)} aria-label={`Delete ${patient.name}`}>Delete</button></div></td>}
                </tr>)}
              </tbody></table></div>
            )}
            <div className="table-footer"><span>Showing <strong>{view === "doctors" ? doctors.length : patients.length}</strong> {view === "doctors" ? doctors.length === 1 ? "doctor" : "doctors" : patients.length === 1 ? "patient" : "patients"}</span><span>Patient information is confidential</span></div>
          </section>
          <footer className="page-footer"><span>© {new Date().getFullYear()} Careflow</span><span>Patient management, made simple.</span></footer>
        </section>
      </main>

      {dialog && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(""); }}>
          {dialog === "patient" ? (
            <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
              <div className="modal-heading"><div><p className="eyebrow">{editingPatient ? "PATIENT RECORD" : "NEW RECORD"}</p><h2 id="modal-title">{editingPatient ? "Edit patient" : "Add a patient"}</h2><p>Enter patient details and select their doctor.</p></div><button className="close-button" onClick={() => setDialog("")} aria-label="Close dialog">×</button></div>
              {error && <div className="alert error-alert" role="alert">{error}</div>}
              <form onSubmit={savePatient}>
                <label className="form-field">Full name<input autoFocus required maxLength="120" value={patientForm.name} onChange={(event) => setPatientForm({ ...patientForm, name: event.target.value })} placeholder="e.g. Alex Morgan" /></label>
                <label className="form-field">Email address<input type="email" required maxLength="190" value={patientForm.email} onChange={(event) => setPatientForm({ ...patientForm, email: event.target.value })} placeholder="alex@example.com" /></label>
                <div className="form-row"><label className="form-field">Phone number<input type="tel" maxLength="40" value={patientForm.phone} onChange={(event) => setPatientForm({ ...patientForm, phone: event.target.value })} placeholder="+1 (555) 000-0000" /></label><label className="form-field">Date of birth<input type="date" value={patientForm.date_of_birth} onChange={(event) => setPatientForm({ ...patientForm, date_of_birth: event.target.value })} /></label></div>
                <div className="form-row"><label className="form-field">Gender<select value={patientForm.gender} onChange={(event) => setPatientForm({ ...patientForm, gender: event.target.value })}><option>Prefer not to say</option><option>Female</option><option>Male</option><option>Non-binary</option></select></label><label className="form-field">Assigned doctor<select value={patientForm.doctor_id} onChange={(event) => setPatientForm({ ...patientForm, doctor_id: event.target.value })}><option value="">Unassigned</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></label></div>
                <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDialog("")}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : editingPatient ? "Save changes" : "Add patient"}</button></div>
              </form>
            </section>
          ) : (
            <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
              <div className="modal-heading"><div><p className="eyebrow">CARE TEAM</p><h2 id="modal-title">Add a doctor</h2><p>Create a login for this doctor. You can assign patients afterward.</p></div><button className="close-button" onClick={() => setDialog("")} aria-label="Close dialog">×</button></div>
              {error && <div className="alert error-alert" role="alert">{error}</div>}
              <form onSubmit={saveDoctor}>
                <label className="form-field">Doctor name<input autoFocus required maxLength="120" value={doctorForm.name} onChange={(event) => setDoctorForm({ ...doctorForm, name: event.target.value })} placeholder="e.g. Dr. Jamie Lee" /></label>
                <label className="form-field">Email address<input required type="email" maxLength="190" autoComplete="off" value={doctorForm.email} onChange={(event) => setDoctorForm({ ...doctorForm, email: event.target.value })} placeholder="doctor@clinic.com" /></label>
                <label className="form-field">Temporary password<input required type="password" minLength="12" maxLength="72" autoComplete="new-password" value={doctorForm.password} onChange={(event) => setDoctorForm({ ...doctorForm, password: event.target.value })} placeholder="At least 12 characters" /><span className="field-hint">Share this securely with the doctor; password reset is not yet available.</span></label>
                <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDialog("")}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "Creating..." : "Create doctor account"}</button></div>
              </form>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
