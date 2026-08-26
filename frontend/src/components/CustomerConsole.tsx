import { useEffect, useState } from "react";

type ActivityLogEntry = {
  id: number;
  created_at: string;
  actor_user_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  customer_id: number | null;
  performance_id: number | null;
  booking_id: number | null;
  description: string;
  old_value: string | null;
  new_value: string | null;
};

type CustomerConsoleProps = {
  bookingId: number;
  firstName: string;
  lastName: string;
  bookingNumber: string;
  ticketCount: number;
  status: string;
  onClose: () => void;
};

export default function CustomerConsole({
  bookingId,
  firstName,
  lastName,
  bookingNumber,
  ticketCount,
  status,
  onClose,
}: CustomerConsoleProps) {
  const [activityLog, setActivityLog] =
    useState<ActivityLogEntry[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadCustomerLog() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          "/api/activity-log?limit=1000"
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data?.detail ??
              `HTTP ${response.status}`
          );
        }

        if (!Array.isArray(data)) {
          throw new Error(
            "Ungültige Log-Antwort."
          );
        }

        const entries =
          data as ActivityLogEntry[];

        const bookingEntries =
          entries.filter(
            (entry) =>
              entry.booking_id ===
              bookingId
          );

        const customerId =
          bookingEntries.find(
            (entry) =>
              entry.customer_id !== null
          )?.customer_id ?? null;

        const customerEntries =
          customerId !== null
            ? entries.filter(
                (entry) =>
                  entry.customer_id ===
                  customerId
              )
            : bookingEntries;

        if (!cancelled) {
          setActivityLog(
            customerEntries
          );
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Kundenverlauf konnte nicht geladen werden."
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCustomerLog();

    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background:
          "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(900px, 95vw)",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          borderRadius: 12,
          background: "#ffffff",
          boxShadow:
            "0 20px 60px rgba(0, 0, 0, 0.25)",
        }}
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            borderBottom:
              "1px solid #e2e8f0",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 17,
                color: "#111827",
              }}
            >
              📋 Kunden-Konsole
            </h2>

            <p
              style={{
                margin: "3px 0 0",
                color: "#64748b",
                fontSize: 10,
              }}
            >
              {firstName} {lastName}
              {" · "}
              {bookingNumber}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              border: "none",
              borderRadius: "50%",
              background: "#f1f5f9",
              color: "#374151",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: 16,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(4, minmax(0, 1fr))",
              gap: 7,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                padding: 8,
                borderRadius: 7,
                background: "#f8fafc",
              }}
            >
              <div
                style={{
                  color: "#64748b",
                  fontSize: 8,
                }}
              >
                Kunde
              </div>

              <strong
                style={{
                  fontSize: 10,
                }}
              >
                {firstName} {lastName}
              </strong>
            </div>

            <div
              style={{
                padding: 8,
                borderRadius: 7,
                background: "#f8fafc",
              }}
            >
              <div
                style={{
                  color: "#64748b",
                  fontSize: 8,
                }}
              >
                Buchung
              </div>

              <strong
                style={{
                  fontSize: 10,
                }}
              >
                {bookingNumber}
              </strong>
            </div>

            <div
              style={{
                padding: 8,
                borderRadius: 7,
                background: "#f8fafc",
              }}
            >
              <div
                style={{
                  color: "#64748b",
                  fontSize: 8,
                }}
              >
                Plätze
              </div>

              <strong
                style={{
                  fontSize: 10,
                }}
              >
                {ticketCount}
              </strong>
            </div>

            <div
              style={{
                padding: 8,
                borderRadius: 7,
                background: "#f8fafc",
              }}
            >
              <div
                style={{
                  color: "#64748b",
                  fontSize: 8,
                }}
              >
                Status
              </div>

              <strong
                style={{
                  fontSize: 10,
                }}
              >
                {status}
              </strong>
            </div>
          </div>

          {loading && (
            <div
              style={{
                padding: 14,
                borderRadius: 8,
                background: "#f8fafc",
                color: "#64748b",
                fontSize: 10,
              }}
            >
              Kundenverlauf wird geladen …
            </div>
          )}

          {error && (
            <div
              style={{
                padding: 14,
                borderRadius: 8,
                background: "#fef2f2",
                color: "#b91c1c",
                fontSize: 10,
              }}
            >
              {error}
            </div>
          )}

          {!loading &&
            !error &&
            activityLog.length === 0 && (
              <div
                style={{
                  padding: 18,
                  borderRadius: 8,
                  background: "#f8fafc",
                  color: "#64748b",
                  textAlign: "center",
                  fontSize: 10,
                }}
              >
                Für diesen Kunden sind noch keine
                protokollierten Aktivitäten vorhanden.
              </div>
            )}

          {!loading &&
            !error &&
            activityLog.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                }}
              >
                {activityLog.slice(0, 30).map(
                  (entry) => {
                    const timestamp =
                      new Date(
                        entry.created_at
                      );

                    return (
                      <div
                        key={entry.id}
                        style={{
                          padding: 10,
                          border:
                            "1px solid #e2e8f0",
                          borderRadius: 8,
                          background:
                            "#ffffff",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent:
                              "space-between",
                            gap: 10,
                            flexWrap:
                              "wrap",
                          }}
                        >
                          <strong
                            style={{
                              color:
                                "#111827",
                              fontSize: 10,
                            }}
                          >
                            {entry.action}
                          </strong>

                          <span
                            style={{
                              color:
                                "#64748b",
                              fontSize: 8,
                            }}
                          >
                            {timestamp.toLocaleDateString(
                              "de-DE"
                            )}{" "}
                            ·{" "}
                            {timestamp.toLocaleTimeString(
                              "de-DE"
                            )}
                          </span>
                        </div>

                        <div
                          style={{
                            marginTop: 4,
                            color:
                              "#334155",
                            fontSize: 10,
                          }}
                        >
                          {entry.description}
                        </div>

                        <div
                          style={{
                            marginTop: 4,
                            color:
                              "#64748b",
                            fontSize: 8,
                          }}
                        >
                          Durchgeführt von:{" "}
                          {entry.actor_name}
                        </div>

                        {(entry.old_value ||
                          entry.new_value) && (
                          <div
                            style={{
                              marginTop: 6,
                              paddingTop: 6,
                              borderTop:
                                "1px solid #f1f5f9",
                              color:
                                "#475569",
                              fontSize: 8,
                            }}
                          >
                            {entry.old_value && (
                              <div>
                                Alt:{" "}
                                {
                                  entry.old_value
                                }
                              </div>
                            )}

                            {entry.new_value && (
                              <div>
                                Neu:{" "}
                                {
                                  entry.new_value
                                }
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }
                )}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}


