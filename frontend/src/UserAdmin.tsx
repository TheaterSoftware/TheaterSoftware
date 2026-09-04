import { useEffect, useState } from "react";

type User = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  permanently_locked: boolean;
  password_reset_until: string | null;
  can_manage_password_resets: boolean;
};

type Props = {
  onBack: () => void;
};

export default function UserAdmin({ onBack }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loggedInUser = JSON.parse(
    localStorage.getItem("theater.loggedInUser") || "{}"
  );
  const isFullAdmin = loggedInUser.role === "admin";

  async function loadUsers() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        "/api/admin/users",
        {
          headers: {
            "X-User-Id":
              loggedInUser.user_id?.toString() || "",
            "X-User-Name":
              loggedInUser.username || "",
          },
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `Benutzer konnten nicht geladen werden (HTTP ${response.status}).`
        );
      }

      setUsers(data ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Benutzer konnten nicht geladen werden."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function unlockUser(user: User) {
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/users/${user.id}/unlock`,
        {
          method: "POST",
          headers: {
            "X-User-Id":
              loggedInUser.user_id?.toString() || "",
            "X-User-Name":
              loggedInUser.username || "",
          },
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `Benutzer konnte nicht freigeschaltet werden (HTTP ${response.status}).`
        );
      }

      setMessage(
        `${user.display_name} wurde freigeschaltet.`
      );

      await loadUsers();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Benutzer konnte nicht freigeschaltet werden."
      );
    }
  }

  async function toggleActive(user: User) {
    const action = user.is_active
      ? "deaktivieren"
      : "aktivieren";

    const confirmed = window.confirm(
      `Möchtest du ${user.display_name} wirklich ${action}?`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/users/${user.id}/toggle-active`,
        {
          method: "POST",
          headers: {
            "X-User-Id":
              loggedInUser.user_id?.toString() || "",
            "X-User-Name":
              loggedInUser.username || "",
          },
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `Benutzer konnte nicht ${action} werden (HTTP ${response.status}).`
        );
      }

      setMessage(
        user.is_active
          ? `${user.display_name} wurde deaktiviert.`
          : `${user.display_name} wurde aktiviert.`
      );

      await loadUsers();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Benutzer konnte nicht ${action} werden.`
      );
    }
  }

  async function authorizePasswordReset(user: User) {
    const confirmed = window.confirm(
      `Passwort-Reset für ${user.display_name} für 1 Stunde freigeben?`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/users/${user.id}/authorize-password-reset`,
        {
          method: "POST",
          headers: {
            "X-User-Id":
              loggedInUser.user_id?.toString() || "",
            "X-User-Name":
              loggedInUser.username || "",
          },
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `Passwort-Reset konnte nicht freigegeben werden (HTTP ${response.status}).`
        );
      }

      setMessage(
        `Passwort-Reset für ${user.display_name} wurde für 1 Stunde freigegeben.`
      );

      await loadUsers();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Passwort-Reset konnte nicht freigegeben werden."
      );
    }
  }

  async function togglePasswordResetPermission(user: User) {
    const action = user.can_manage_password_resets ? "entziehen" : "erteilen";
    const confirmed = window.confirm(
      `Berechtigung „Passwortfreigaben verwalten“ für ${user.display_name} ${action}?`
    );
    if (!confirmed) return;

    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/users/${user.id}/toggle-password-reset-permission`,
        {
          method: "POST",
          headers: {
            "X-User-Id": loggedInUser.user_id?.toString() || "",
            "X-User-Name": loggedInUser.username || "",
          },
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || `Berechtigung konnte nicht ${action} werden.`);
      }
      setMessage(
        `Die Berechtigung für Passwortfreigaben wurde ${user.can_manage_password_resets ? "entzogen" : "erteilt"}.`
      );
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Berechtigung konnte nicht geändert werden.");
    }
  }

  function statusText(user: User) {
    if (!user.is_active) {
      return "Deaktiviert";
    }

    if (user.permanently_locked) {
      return "Dauerhaft gesperrt";
    }

    if (user.locked_until) {
      const lockedUntil = new Date(user.locked_until);

      if (lockedUntil > new Date()) {
        return "Vorübergehend gesperrt";
      }
    }

    return "Aktiv";
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f7f7f7",
        color: "#111",
        padding: "40px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "30px",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "32px",
                color: "#111111",
              }}
            >
              Mitarbeiter
            </h1>

            <p
              style={{
                margin: "8px 0 0",
                color: "#666",
              }}
            >
              Benutzer verwalten
            </p>
          </div>

          <button
            type="button"
            onClick={onBack}
            style={{
              padding: "10px 16px",
              border: "1px solid #ccc",
              borderRadius: "8px",
              background: "#fff",
              color: "#000",
              cursor: "pointer",
            }}
          >
            Zurück
          </button>
        </header>

        {message && (
          <div
            style={{
              marginBottom: "20px",
              padding: "12px 14px",
              border: "1px solid #b7d7b7",
              borderRadius: "8px",
              background: "#fff",
              color: "#176b17",
            }}
          >
            {message}
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: "20px",
              padding: "12px 14px",
              border: "1px solid #e0b0b0",
              borderRadius: "8px",
              background: "#fff",
              color: "#b00000",
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div>Benutzer werden geladen …</div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "12px",
            }}
          >
            {users.map((user) => (
              <div
                key={user.id}
                style={{
                  background: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: "12px",
                  padding: "20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "20px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "19px",
                        fontWeight: 600,
                      }}
                    >
                      {user.display_name}
                    </div>

                    <div
                      style={{
                        marginTop: "6px",
                        color: "#666",
                      }}
                    >
                      {user.username} · {user.role}
                    </div>

                    {(user.role === "admin" || user.can_manage_password_resets) && (
                      <div
                        style={{
                          marginTop: "6px",
                          color: "#176b17",
                          fontSize: "14px",
                          fontWeight: 600,
                        }}
                      >
                        Darf Passwortfreigaben verwalten
                      </div>
                    )}

                    <div
                      style={{
                        marginTop: "8px",
                        color: user.permanently_locked
                          ? "#b00000"
                          : "#555",
                        fontWeight: 500,
                      }}
                    >
                      Status: {statusText(user)}
                    </div>

                    {user.failed_login_attempts > 0 && (
                      <div
                        style={{
                          marginTop: "4px",
                          color: "#777",
                          fontSize: "14px",
                        }}
                      >
                        Fehlversuche:{" "}
                        {user.failed_login_attempts}
                      </div>
                    )}

                    {user.password_reset_until && (
                      <div
                        style={{
                          marginTop: "4px",
                          color: "#8a5a00",
                          fontSize: "14px",
                          fontWeight: 500,
                        }}
                      >
                        Passwort-Reset freigegeben bis{" "}
                        {new Date(
                          user.password_reset_until
                        ).toLocaleTimeString("de-DE", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "10px",
                      justifyContent: "flex-end",
                    }}
                  >
                    {(isFullAdmin || user.role !== "admin") &&
                      (user.permanently_locked ||
                      statusText(user) ===
                        "Vorübergehend gesperrt") && (
                      <button
                        type="button"
                        onClick={() =>
                          unlockUser(user)
                        }
                        style={{
                          padding: "10px 14px",
                          border: "1px solid #ccc",
                          borderRadius: "8px",
                          background: "#fff",
                          color: "#000",
                          cursor: "pointer",
                        }}
                      >
                        Freischalten
                      </button>
                    )}

                    {(isFullAdmin || user.role !== "admin") && (
                      <button
                        type="button"
                        onClick={() => authorizePasswordReset(user)}
                        style={{
                          padding: "10px 14px",
                          border: "1px solid #ccc",
                          borderRadius: "8px",
                          background: "#fff",
                          color: "#000",
                          cursor: "pointer",
                        }}
                      >
                        Passwort-Reset für 1 Stunde freigeben
                      </button>
                    )}

                    {isFullAdmin && user.role !== "admin" && (
                      <button
                        type="button"
                        onClick={() => togglePasswordResetPermission(user)}
                        style={{
                          padding: "10px 14px",
                          border: "1px solid #ccc",
                          borderRadius: "8px",
                          background: user.can_manage_password_resets ? "#fff4f4" : "#eef8ee",
                          color: user.can_manage_password_resets ? "#8b1b1b" : "#176b17",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        {user.can_manage_password_resets
                          ? "Passwortfreigabe-Recht entziehen"
                          : "Passwortfreigabe-Recht erteilen"}
                      </button>
                    )}

                    {isFullAdmin && (
                      <button
                        type="button"
                        onClick={() => toggleActive(user)}
                        style={{
                          padding: "10px 14px",
                          border: "1px solid #ccc",
                          borderRadius: "8px",
                          background: "#fff",
                          color: user.is_active ? "#b00000" : "#176b17",
                          cursor: "pointer",
                          fontWeight: 500,
                        }}
                      >
                        {user.is_active ? "Deaktivieren" : "Aktivieren"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
