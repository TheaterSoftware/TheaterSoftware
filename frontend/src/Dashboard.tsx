type DashboardProps = {
  userName: string;
  onOpenTheater: () => void;
  onOpenPerformances: () => void;
  onOpenUserAdmin: () => void;
  onOpenBookings: () => void;
  onLogout: () => void;
};

export default function Dashboard({
  userName,
  onOpenTheater,
  onOpenPerformances,
  onOpenUserAdmin,
  onOpenBookings,
  onLogout,
}: DashboardProps) {
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
      <header
        style={{
          maxWidth: "1200px",
          margin: "0 auto 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "32px",
              fontWeight: 600,
              color: "#000",
            }}
          >
            TheaterSoftware
          </h1>

          <p
            style={{
              margin: "8px 0 0",
              color: "#666",
            }}
          >
            Willkommen, {userName}
          </p>
        </div>

        <button
          type="button"
          onClick={onLogout}
          style={{
            border: "1px solid #ccc",
            background: "#fff",
            borderRadius: "8px",
            padding: "10px 16px",
            cursor: "pointer",
          }}
        >
          Abmelden
        </button>
      </header>

      <main
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "20px",
          }}
        >
          {/* SITZPLATZVERWALTUNG */}
          <button
            type="button"
            onClick={onOpenTheater}
            style={{
              minHeight: "160px",
              border: "1px solid #ddd",
              borderRadius: "12px",
              background: "#fff",
              padding: "24px",
              textAlign: "left",
              cursor: "pointer",
              color: "#000",
            }}
          >
            <strong
              style={{
                display: "block",
                fontSize: "20px",
                marginBottom: "8px",
              }}
            >
              Sitzplatzverwaltung
            </strong>

            <span style={{ color: "#666" }}>
              Vorstellungen, Sitzplätze und
              Zuordnungen verwalten.
            </span>
          </button>

          {/* VORSTELLUNGEN */}
          <button
            type="button"
            onClick={onOpenPerformances}
            style={{
              minHeight: "160px",
              border: "1px solid #ddd",
              borderRadius: "12px",
              background: "#fff",
              padding: "24px",
              textAlign: "left",
              cursor: "pointer",
              color: "#000",
            }}
          >
            <strong
              style={{
                display: "block",
                fontSize: "20px",
                marginBottom: "8px",
              }}
            >
              Vorstellungen
            </strong>

            <span style={{ color: "#666" }}>
              Vorstellungen verwalten.
            </span>
          </button>

          {/* BUCHUNGEN */}
          <button
            type="button"
            onClick={onOpenBookings}
            style={{
              minHeight: "160px",
              border: "1px solid #ddd",
              borderRadius: "12px",
              background: "#fff",
              padding: "24px",
              textAlign: "left",
              cursor: "pointer",
              color: "#000",
            }}
          >
            <strong
              style={{
                display: "block",
                fontSize: "20px",
                marginBottom: "8px",
              }}
            >
              Buchungen
            </strong>

            <span style={{ color: "#666" }}>
              Buchungen und Rechnungen verwalten.
            </span>
          </button>

          {/* MITARBEITER */}
          <button
            type="button"
            onClick={onOpenUserAdmin}
            style={{
              minHeight: "160px",
              border: "1px solid #ddd",
              borderRadius: "12px",
              background: "#fff",
              padding: "24px",
              textAlign: "left",
              cursor: "pointer",
              color: "#000",
            }}
          >
            <strong
              style={{
                display: "block",
                fontSize: "20px",
                marginBottom: "8px",
              }}
            >
              Mitarbeiter
            </strong>

            <span style={{ color: "#666" }}>
              Mitarbeiter freischalten und Passwörter
              zurücksetzen.
            </span>
          </button>
        </div>
      </main>
    </div>
  );
}
