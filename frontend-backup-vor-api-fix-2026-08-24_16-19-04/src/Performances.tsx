import { useEffect, useState, type FormEvent } from "react";

type Performance = {
  id: number;
  title: string;
  performance_date: string;
  start_time: string;
  created_at?: string | null;
};

type Props = {
  onBack: () => void;
};

export default function Performances({ onBack }: Props) {
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  async function loadPerformances() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/performances"
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `Vorstellungen konnten nicht geladen werden (HTTP ${response.status}).`
        );
      }

      setPerformances(data ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Vorstellungen konnten nicht geladen werden."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPerformances();
  }, []);

  function resetForm() {
    setTitle("");
    setDate("");
    setTime("");
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(performance: Performance) {
    setEditingId(performance.id);
    setTitle(performance.title);
    setDate(performance.performance_date);
    setTime(performance.start_time.slice(0, 5));
    setShowForm(true);
    setError("");
  }

  async function savePerformance(
    event: FormEvent
  ) {
    event.preventDefault();
    setError("");

    try {
      const isEditing = editingId !== null;

      const url = isEditing
        ? `http://127.0.0.1:8000/api/performances/${editingId}`
        : "http://127.0.0.1:8000/api/performances";

      const response = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isEditing
            ? {
                "X-User-Id":
                  JSON.parse(
                    localStorage.getItem(
                      "theater.loggedInUser"
                    ) || "{}"
                  ).user_id?.toString() || "",
                "X-User-Name":
                  JSON.parse(
                    localStorage.getItem(
                      "theater.loggedInUser"
                    ) || "{}"
                  ).username || "",
              }
            : {}),
        },
        body: JSON.stringify({
          title,
          performance_date: date,
          start_time: time,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `Vorstellung konnte nicht gespeichert werden (HTTP ${response.status}).`
        );
      }

      resetForm();
      await loadPerformances();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Vorstellung konnte nicht gespeichert werden."
      );
    }
  }

  async function deletePerformance(performance: Performance) {
    const loggedInUser = JSON.parse(
      localStorage.getItem("theater.loggedInUser") || "{}"
    );

    if (loggedInUser.role !== "admin") {
      return;
    }

    const confirmed = window.confirm(
      `Soll die Vorstellung „${performance.title}“ wirklich endgültig gelöscht werden?\n\nDieser Vorgang kann nicht rückgängig gemacht werden.`
    );

    if (!confirmed) {
      return;
    }

    setError("");

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/api/performances/${performance.id}`,
        {
          method: "DELETE",
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
            `Vorstellung konnte nicht gelöscht werden (HTTP ${response.status}).`
        );
      }

      setPerformances((current) =>
        current.filter(
          (item) => item.id !== performance.id
        )
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Vorstellung konnte nicht gelöscht werden."
      );
    }
  }

  function formatDate(value: string) {
    const parts = value.split("-");

    if (parts.length !== 3) {
      return value;
    }

    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }

  const loggedInUser = JSON.parse(
    localStorage.getItem("theater.loggedInUser") || "{}"
  );

  const isAdmin = loggedInUser.role === "admin";

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
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "30px",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                color: "#000",
                fontSize: "32px",
              }}
            >
              Vorstellungen
            </h1>

            <p
              style={{
                margin: "8px 0 0",
                color: "#666",
              }}
            >
              Vorstellungen verwalten
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

        <button
          type="button"
          onClick={() => {
            if (showForm && editingId === null) {
              resetForm();
            } else {
              setEditingId(null);
              setTitle("");
              setDate("");
              setTime("");
              setShowForm(true);
            }
          }}
          style={{
            marginBottom: "20px",
            padding: "12px 18px",
            border: "none",
            borderRadius: "8px",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            fontSize: "15px",
          }}
        >
          {showForm && editingId === null
            ? "Formular schließen"
            : "+ Neue Vorstellung"}
        </button>

        {showForm && (
          <form
            onSubmit={savePerformance}
            style={{
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "24px",
              marginBottom: "24px",
              display: "grid",
              gap: "16px",
            }}
          >
            <h2
              style={{
                margin: 0,
                color: "#000",
              }}
            >
              {editingId !== null
                ? "Vorstellung bearbeiten"
                : "Neue Vorstellung"}
            </h2>

            <label>
              <div
                style={{
                  marginBottom: "6px",
                  color: "#000",
                }}
              >
                Titel
              </div>

              <input
                value={title}
                onChange={(event) =>
                  setTitle(event.target.value)
                }
                required
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  border: "1px solid #ccc",
                  borderRadius: "8px",
                  color: "#000",
                  background: "#fff",
                }}
              />
            </label>

            <label>
              <div
                style={{
                  marginBottom: "6px",
                  color: "#000",
                }}
              >
                Datum
              </div>

              <input
                type="date"
                value={date}
                onChange={(event) =>
                  setDate(event.target.value)
                }
                required
                style={{
                  padding: "11px 12px",
                  border: "1px solid #ccc",
                  borderRadius: "8px",
                  color: "#000",
                  background: "#fff",
                }}
              />
            </label>

            <label>
              <div
                style={{
                  marginBottom: "6px",
                  color: "#000",
                }}
              >
                Uhrzeit
              </div>

              <input
                type="time"
                value={time}
                onChange={(event) =>
                  setTime(event.target.value)
                }
                required
                style={{
                  padding: "11px 12px",
                  border: "1px solid #ccc",
                  borderRadius: "8px",
                  color: "#000",
                  background: "#fff",
                }}
              />
            </label>

            <div
              style={{
                display: "flex",
                gap: "10px",
              }}
            >
              <button
                type="submit"
                style={{
                  padding: "12px 16px",
                  border: "none",
                  borderRadius: "8px",
                  background: "#111",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Speichern
              </button>

              <button
                type="button"
                onClick={resetForm}
                style={{
                  padding: "12px 16px",
                  border: "1px solid #ccc",
                  borderRadius: "8px",
                  background: "#fff",
                  color: "#000",
                  cursor: "pointer",
                }}
              >
                Abbrechen
              </button>
            </div>
          </form>
        )}

        {error && (
          <div
            style={{
              marginBottom: "20px",
              padding: "12px 14px",
              borderRadius: "8px",
              background: "#fff",
              border: "1px solid #e0b0b0",
              color: "#b00000",
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div>Vorstellungen werden geladen …</div>
        ) : performances.length === 0 ? (
          <div
            style={{
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            Noch keine Vorstellungen vorhanden.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "12px",
            }}
          >
            {performances.map((performance) => (
              <div
                key={performance.id}
                style={{
                  background: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: "12px",
                  padding: "20px",
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
                      color: "#000",
                    }}
                  >
                    {performance.title}
                  </div>

                  <div
                    style={{
                      marginTop: "8px",
                      color: "#555",
                    }}
                  >
                    {formatDate(
                      performance.performance_date
                    )}{" "}
                    ·{" "}
                    {performance.start_time.slice(0, 5)} Uhr
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    flexShrink: 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      startEdit(performance)
                    }
                    style={{
                      padding: "10px 16px",
                      border: "1px solid #ccc",
                      borderRadius: "8px",
                      background: "#fff",
                      color: "#000",
                      cursor: "pointer",
                    }}
                  >
                    Bearbeiten
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() =>
                        deletePerformance(performance)
                      }
                      style={{
                        padding: "10px 16px",
                        border: "1px solid #ccc",
                        borderRadius: "8px",
                        background: "#fff",
                        color: "#000",
                        cursor: "pointer",
                      }}
                    >
                      Löschen
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
