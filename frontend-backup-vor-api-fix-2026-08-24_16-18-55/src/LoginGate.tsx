import { useEffect, useState, type FormEvent } from "react";
import Dashboard from "./Dashboard";
import Performances from "./Performances";
import UserAdmin from "./UserAdmin";

type LoginUser = {
  user_id: number;
  username: string;
  display_name: string;
  role: string;
};

type Props = {
  children: React.ReactNode;
};

export default function LoginGate({ children }: Props) {
  const [user, setUser] = useState<LoginUser | null>(() => {
    try {
      const saved = localStorage.getItem("theater.loggedInUser");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [showPasswordReset, setShowPasswordReset] =
    useState(false);

  const [resetUsername, setResetUsername] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] =
    useState("");
  const [resetError, setResetError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const [showTheaterApp, setShowTheaterApp] =
    useState(() => {
      return (
        localStorage.getItem(
          "theater.showTheaterApp"
        ) === "true"
      );
    });

  const [showPerformances, setShowPerformances] =
    useState(() => {
      return (
        localStorage.getItem(
          "theater.showPerformances"
        ) === "true"
      );
    });

  const [showUserAdmin, setShowUserAdmin] = useState(
    () =>
      localStorage.getItem("theater.showUserAdmin") ===
      "true"
  );

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username,
            password,
          }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ?? "Anmeldung fehlgeschlagen."
        );
      }

      localStorage.setItem(
        "theater.loggedInUser",
        JSON.stringify(data)
      );

      setUser(data);
      setPassword("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Anmeldung fehlgeschlagen."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordReset(event: FormEvent) {
    event.preventDefault();

    setResetError("");
    setResetMessage("");

    const cleanUsername = resetUsername.trim();

    if (!cleanUsername) {
      setResetError(
        "Bitte gib deinen Benutzernamen ein."
      );
      return;
    }

    if (resetPassword.length < 8) {
      setResetError(
        "Das neue Passwort muss mindestens 8 Zeichen lang sein."
      );
      return;
    }

    if (resetPasswordConfirm.length < 8) {
      setResetError(
        "Bitte bestätige das neue Passwort vollständig."
      );
      return;
    }

    if (resetPassword !== resetPasswordConfirm) {
      setResetError(
        "Die beiden neuen Passwörter stimmen nicht überein."
      );
      return;
    }

    setResetLoading(true);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/password-reset/complete",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: cleanUsername,
            new_password: resetPassword,
          }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const detail =
          typeof data?.detail === "string"
            ? data.detail
            : Array.isArray(data?.detail)
              ? data.detail
                  .map((item: unknown) => {
                    if (
                      item &&
                      typeof item === "object" &&
                      "msg" in item
                    ) {
                      return String(
                        (item as { msg?: unknown }).msg ?? ""
                      );
                    }

                    return String(item);
                  })
                  .filter(Boolean)
                  .join(" ")
              : "Passwort konnte nicht zurückgesetzt werden.";

        throw new Error(detail);
      }

      setResetMessage(
        "Das Passwort wurde erfolgreich geändert. Du kannst dich jetzt mit dem neuen Passwort anmelden."
      );

      setResetPassword("");
      setResetPasswordConfirm("");
      setUsername(cleanUsername);
      setPassword("");

      window.setTimeout(() => {
        setShowPasswordReset(false);
        setResetMessage("");
        setResetUsername("");
        setResetPassword("");
        setResetPasswordConfirm("");
      }, 1800);
    } catch (err) {
      setResetError(
        err instanceof Error
          ? err.message
          : "Passwort konnte nicht zurückgesetzt werden."
      );
    } finally {
      setResetLoading(false);
    }
  }

  function openPasswordReset() {
    setResetError("");
    setResetMessage("");
    setResetUsername(username.trim());
    setResetPassword("");
    setResetPasswordConfirm("");
    setShowPasswordReset(true);
  }

  function closePasswordReset() {
    if (resetLoading) {
      return;
    }

    setShowPasswordReset(false);
    setResetError("");
    setResetMessage("");
    setResetUsername("");
    setResetPassword("");
    setResetPasswordConfirm("");
  }

  function logout() {
    localStorage.removeItem("theater.loggedInUser");
    setUser(null);
  }

  useEffect(() => {
    const handleBack = () => {
      localStorage.removeItem(
        "theater.showTheaterApp"
      );
      setShowTheaterApp(false);
    };

    window.addEventListener(
      "theater:back",
      handleBack
    );

    return () => {
      window.removeEventListener(
        "theater:back",
        handleBack
      );
    };
  }, []);

  if (user && showTheaterApp) {
    return children;
  }

  if (user && showUserAdmin) {
    if (user.role !== "admin") {
      localStorage.removeItem("theater.showUserAdmin");
      setShowUserAdmin(false);
    } else {
      return (
        <UserAdmin
          onBack={() => {
            localStorage.removeItem(
              "theater.showUserAdmin"
            );
            setShowUserAdmin(false);
          }}
        />
      );
    }
  }

  if (user && showPerformances) {
    return (
      <Performances
        onBack={() => {
          localStorage.removeItem(
            "theater.showPerformances"
          );
          setShowPerformances(false);
        }}
      />
    );
  }

  if (user) {
    return (
      <Dashboard
        userName={user.display_name || user.username}
        onOpenTheater={() => {
          localStorage.setItem(
            "theater.showTheaterApp",
            "true"
          );
          setShowTheaterApp(true);
        }}
        onOpenPerformances={() => {
          localStorage.setItem(
            "theater.showPerformances",
            "true"
          );
          setShowPerformances(true);
        }}
        onOpenUserAdmin={() => {
          if (user.role !== "admin") {
            return;
          }

          localStorage.setItem(
            "theater.showUserAdmin",
            "true"
          );
          setShowUserAdmin(true);
        }}
        onLogout={logout}
      />
    );
  }

  if (!user) {
    return (
      <>
        <div
          style={{
            minHeight: "100vh",
            width: "100%",
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: 0,
            padding: "24px",
            boxSizing: "border-box",
          }}
        >
          <form
            onSubmit={handleLogin}
            style={{
              width: "100%",
              maxWidth: "380px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              background: "#fff",
              padding: "32px",
              boxSizing: "border-box",
              textAlign: "center",
            }}
          >
            <h1
              style={{
                margin: "0 0 4px",
                fontSize: "28px",
                fontWeight: 600,
                color: "#111",
              }}
            >
              TheaterSoftware
            </h1>

            <p
              style={{
                margin: "0 0 12px",
                color: "#666",
                fontSize: "15px",
              }}
            >
              Bitte anmelden
            </p>

            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "7px",
                textAlign: "left",
                color: "#111",
                fontSize: "14px",
              }}
            >
              Benutzername

              <input
                type="text"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                autoComplete="username"
                required
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "12px 14px",
                  border: "1px solid #d0d0d0",
                  borderRadius: "8px",
                  background: "#fff",
                  color: "#111",
                  fontSize: "16px",
                }}
              />
            </label>

            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "7px",
                textAlign: "left",
                color: "#111",
                fontSize: "14px",
              }}
            >
              Passwort

              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="current-password"
                required
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "12px 14px",
                  border: "1px solid #d0d0d0",
                  borderRadius: "8px",
                  background: "#fff",
                  color: "#111",
                  fontSize: "16px",
                }}
              />
            </label>

            {error && (
              <p
                style={{
                  margin: 0,
                  color: "#c00",
                  fontSize: "14px",
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: "4px",
                width: "100%",
                padding: "12px 14px",
                border: "none",
                borderRadius: "8px",
                background: "#111",
                color: "#fff",
                fontSize: "16px",
                cursor: loading
                  ? "default"
                  : "pointer",
              }}
            >
              {loading ? "Anmelden ..." : "Anmelden"}
            </button>

            <button
              type="button"
              onClick={openPasswordReset}
              style={{
                border: "none",
                background: "transparent",
                color: "#555",
                fontSize: "14px",
                cursor: "pointer",
                padding: "6px",
              }}
            >
              Passwort zurücksetzen
            </button>
          </form>
        </div>

        {showPasswordReset && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 10000,
              background: "rgba(0, 0, 0, 0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px",
              boxSizing: "border-box",
            }}
          >
            <form
              onSubmit={handlePasswordReset}
              style={{
                width: "100%",
                maxWidth: "430px",
                background: "#fff",
                borderRadius: "14px",
                padding: "28px",
                boxSizing: "border-box",
                boxShadow:
                  "0 18px 50px rgba(0,0,0,0.18)",
              }}
            >
              <h2
                style={{
                  margin: "0 0 8px",
                  color: "#111",
                  fontSize: "24px",
                }}
              >
                Passwort zurücksetzen
              </h2>

              <p
                style={{
                  margin: "0 0 22px",
                  color: "#666",
                  fontSize: "14px",
                  lineHeight: 1.5,
                }}
              >
                Der Administrator muss den
                Passwort-Reset vorher für dein Konto
                freigegeben haben. Die Freigabe ist nur
                eine Stunde gültig.
              </p>

              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "7px",
                  marginBottom: "14px",
                  color: "#111",
                  fontSize: "14px",
                }}
              >
                Benutzername

                <input
                  type="text"
                  value={resetUsername}
                  onChange={(event) =>
                    setResetUsername(event.target.value)
                  }
                  autoComplete="username"
                  required
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "12px 14px",
                    border: "1px solid #d0d0d0",
                    borderRadius: "8px",
                    background: "#fff",
                    color: "#111",
                    fontSize: "16px",
                  }}
                />
              </label>

              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "7px",
                  marginBottom: "14px",
                  color: "#111",
                  fontSize: "14px",
                }}
              >
                Neues Passwort

                <input
                  type="password"
                  value={resetPassword}
                  onChange={(event) =>
                    setResetPassword(event.target.value)
                  }
                  autoComplete="new-password"
                  minLength={8}
                  required
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "12px 14px",
                    border: "1px solid #d0d0d0",
                    borderRadius: "8px",
                    background: "#fff",
                    color: "#111",
                    fontSize: "16px",
                  }}
                />
              </label>

              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "7px",
                  marginBottom: "18px",
                  color: "#111",
                  fontSize: "14px",
                }}
              >
                Neues Passwort bestätigen

                <input
                  type="password"
                  value={resetPasswordConfirm}
                  onChange={(event) =>
                    setResetPasswordConfirm(
                      event.target.value
                    )
                  }
                  autoComplete="new-password"
                  minLength={8}
                  required
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "12px 14px",
                    border: "1px solid #d0d0d0",
                    borderRadius: "8px",
                    background: "#fff",
                    color: "#111",
                    fontSize: "16px",
                  }}
                />
              </label>

              {resetError && (
                <p
                  style={{
                    margin: "0 0 14px",
                    color: "#c00",
                    fontSize: "14px",
                  }}
                >
                  {resetError}
                </p>
              )}

              {resetMessage && (
                <p
                  style={{
                    margin: "0 0 14px",
                    color: "#176b17",
                    fontSize: "14px",
                  }}
                >
                  {resetMessage}
                </p>
              )}

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                }}
              >
                <button
                  type="button"
                  onClick={closePasswordReset}
                  disabled={resetLoading}
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    border: "1px solid #ccc",
                    borderRadius: "8px",
                    background: "#fff",
                    color: "#111",
                    cursor: resetLoading
                      ? "default"
                      : "pointer",
                  }}
                >
                  Abbrechen
                </button>

                <button
                  type="submit"
                  disabled={resetLoading}
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    border: "none",
                    borderRadius: "8px",
                    background: "#111",
                    color: "#fff",
                    cursor: resetLoading
                      ? "default"
                      : "pointer",
                  }}
                >
                  {resetLoading
                    ? "Speichern ..."
                    : "Passwort setzen"}
                </button>
              </div>
            </form>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 9999,
        }}
      >
        <button type="button" onClick={logout}>
          Abmelden
        </button>
      </div>

      {children}
    </>
  );
}