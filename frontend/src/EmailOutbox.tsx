import { useCallback, useEffect, useMemo, useState } from "react";
import "./EmailOutbox.css";

type MessageStatus = "prepared" | "sending" | "sent" | "failed" | "not_ready" | "pending";

type OutboxMessage = {
  key: "reservation_reminder" | "reservation" | "booking_confirmation" | "tickets" | "invoice";
  label: string;
  status: MessageStatus;
  attempt_count: number;
  original_recipient: string;
  actual_recipient: string;
  last_error: string;
  sent_at: string | null;
  updated_at: string | null;
  can_send: boolean;
  unavailable_reason: string;
};

type OutboxBooking = {
  booking_id: number;
  booking_number: string;
  booking_status: string;
  payment_state: string;
  delivery_method: string;
  ticket_count: number;
  customer_name: string;
  customer_email: string;
  event_title: string;
  event_date: string | null;
  invoice_id: number | null;
  invoice_number: string;
  invoice_date: string | null;
  messages: OutboxMessage[];
};

type OutboxResponse = {
  test_mode: boolean;
  test_recipient: string;
  bookings: OutboxBooking[];
};

type Props = { onBack: () => void };
type Filter = "all" | "prepared" | "sent" | "failed";

function authHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem("theater.loggedInUser");
    const user = raw ? JSON.parse(raw) : null;
    return {
      "X-User-Id": String(user?.user_id ?? ""),
      "X-User-Name": String(user?.display_name || user?.username || "Mitarbeiter"),
    };
  } catch {
    return {};
  }
}

async function responseError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null);
  return typeof data?.detail === "string"
    ? data.detail
    : `Anfrage fehlgeschlagen (${response.status}).`;
}

function formatDate(value: string | null): string {
  if (!value) return "–";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("de-DE");
}

function formatDateTime(value: string | null): string {
  if (!value) return "Noch nicht versendet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value.replace("T", " ").slice(0, 16)
    : parsed.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

const statusText: Record<MessageStatus, string> = {
  prepared: "Vorbereitet",
  pending: "Vorbereitet",
  sending: "Wird gesendet",
  sent: "Versendet",
  failed: "Fehler",
  not_ready: "Noch nicht bereit",
};

export default function EmailOutbox({ onBack }: Props) {
  const [data, setData] = useState<OutboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sendingKey, setSendingKey] = useState("");

  const loadOutbox = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/email-outbox", { headers: authHeaders() });
      if (!response.ok) throw new Error(await responseError(response));
      setData((await response.json()) as OutboxResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "E-Mail-Ausgang konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOutbox();
  }, [loadOutbox]);

  const summary = useMemo(() => {
    const messages = data?.bookings.flatMap((booking) => booking.messages) ?? [];
    return {
      prepared: messages.filter((item) => ["prepared", "pending"].includes(item.status)).length,
      sent: messages.filter((item) => item.status === "sent").length,
      failed: messages.filter((item) => item.status === "failed").length,
    };
  }, [data]);

  const bookings = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("de-DE");
    return (data?.bookings ?? []).filter((booking) => {
      const matchesSearch = !query || [
        booking.booking_number,
        booking.invoice_number,
        booking.customer_name,
        booking.customer_email,
        booking.event_title,
      ].join(" ").toLocaleLowerCase("de-DE").includes(query);
      const matchesFilter = filter === "all" || booking.messages.some((message) => {
        if (filter === "prepared") return ["prepared", "pending"].includes(message.status);
        return message.status === filter;
      });
      return matchesSearch && matchesFilter;
    });
  }, [data, filter, search]);

  async function sendMessage(booking: OutboxBooking, message: OutboxMessage) {
    const repeated = message.status === "sent";
    if (repeated && !window.confirm(
      `${message.label} für ${booking.booking_number} wurde bereits versendet. Wirklich erneut senden?`
    )) return;

    const key = `${booking.booking_id}-${message.key}`;
    setSendingKey(key);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/email-outbox/${booking.booking_id}/${message.key}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ force: repeated }),
        }
      );
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json();
      setNotice(result?.message || `${message.label} wurde gesendet.`);
      await loadOutbox();
    } catch (err) {
      await loadOutbox();
      setError(err instanceof Error ? err.message : "E-Mail konnte nicht gesendet werden.");
    } finally {
      setSendingKey("");
    }
  }

  return (
    <div className="email-outbox-shell">
      <header className="email-outbox-header">
        <button type="button" className="email-outbox-back" onClick={onBack}>← Zurück</button>
        <div>
          <span className="email-outbox-eyebrow">VERSANDZENTRALE</span>
          <h1>E-Mail-Ausgang</h1>
          <p>Vorbereitete und versendete Nachrichten zentral verwalten.</p>
        </div>
        <button type="button" className="email-outbox-refresh" onClick={() => void loadOutbox()} disabled={loading}>
          {loading ? "Lädt …" : "Aktualisieren"}
        </button>
      </header>

      <main className="email-outbox-main">
        <div className="email-outbox-test-note">
          <strong>Reservierung mit Zahlungslink:</strong> Zuerst die Buchung und eine offene Rechnung speichern.
          Dann die Reservierungsbestätigung senden. Nach bestätigter Stripe-Zahlung werden Bestätigung,
          Rechnung und digitale Tickets automatisch versendet. Bei Postversand entfällt die Ticket-Mail.
        </div>
        {data?.test_mode && (
          <div className="email-outbox-test-note">
            <strong>Testbetrieb:</strong> Alle Nachrichten gehen momentan ausschließlich an <strong>{data.test_recipient}</strong>. Die Kundenadresse wird nur zur Kontrolle angezeigt.
          </div>
        )}

        <section className="email-outbox-summary" aria-label="Versandübersicht">
          <button className={filter === "prepared" ? "active" : ""} onClick={() => setFilter("prepared")}>
            <strong>{summary.prepared}</strong><span>Vorbereitet</span>
          </button>
          <button className={filter === "sent" ? "active" : ""} onClick={() => setFilter("sent")}>
            <strong>{summary.sent}</strong><span>Versendet</span>
          </button>
          <button className={filter === "failed" ? "active" : ""} onClick={() => setFilter("failed")}>
            <strong>{summary.failed}</strong><span>Fehler</span>
          </button>
        </section>

        <section className="email-outbox-toolbar">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buchungsnummer, Name, E-Mail oder Veranstaltung suchen …"
          />
          <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="all">Alle Nachrichten</option>
            <option value="prepared">Vorbereitet</option>
            <option value="sent">Versendet</option>
            <option value="failed">Fehler</option>
          </select>
        </section>

        {error && <div className="email-outbox-alert error">{error}</div>}
        {notice && <div className="email-outbox-alert success">{notice}</div>}

        {loading && !data ? (
          <div className="email-outbox-empty">E-Mail-Ausgang wird geladen …</div>
        ) : bookings.length === 0 ? (
          <div className="email-outbox-empty">Keine passenden Nachrichten gefunden.</div>
        ) : (
          <div className="email-outbox-list">
            {bookings.map((booking) => (
              <article className="email-outbox-booking" key={booking.booking_id}>
                <div className="email-outbox-booking-head">
                  <div>
                    <div className="email-outbox-number">{booking.booking_number}</div>
                    <h2>{booking.customer_name || "Kunde ohne Namen"}</h2>
                    <p>{booking.customer_email || "Keine Kunden-E-Mail hinterlegt"}</p>
                    {booking.payment_state === "processing" && <p>Zahlung wird verarbeitet – noch keine Zahlungsbestätigung.</p>}
                    {booking.payment_state === "failed" && <p>Zahlung fehlgeschlagen – der Zahlungslink kann erneut verwendet werden.</p>}
                    {booking.payment_state === "review" && <p role="alert">Zahlung eingegangen, aber Rechnung oder Buchung wurde geändert. Bitte in Stripe prüfen; keine erneute Zahlung anfordern.</p>}
                  </div>
                  <div className="email-outbox-event">
                    <strong>{booking.event_title}</strong>
                    <span>{formatDate(booking.event_date)} · {booking.ticket_count} Ticket{booking.ticket_count === 1 ? "" : "s"}</span>
                    <span>{booking.invoice_number ? `Rechnung ${booking.invoice_number}` : "Rechnung noch nicht vorbereitet"}</span>
                  </div>
                </div>

                <div className="email-outbox-messages">
                  {booking.messages.map((message) => {
                    const actionKey = `${booking.booking_id}-${message.key}`;
                    const isSending = sendingKey === actionKey;
                    return (
                      <div className="email-outbox-message" key={message.key}>
                        <div className={`email-outbox-status ${message.status}`}>
                          <span aria-hidden="true" />{statusText[message.status]}
                        </div>
                        <div className="email-outbox-message-info">
                          <strong>{message.label}</strong>
                          <span>{message.sent_at ? `Versendet am ${formatDateTime(message.sent_at)}` : message.unavailable_reason || "Bereit zum manuellen Versand"}</span>
                          {message.actual_recipient && <span>Empfänger: {message.actual_recipient}</span>}
                          {message.attempt_count > 0 && <span>Versandversuche: {message.attempt_count}</span>}
                          {message.last_error && <span className="email-outbox-error-text">{message.last_error}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => void sendMessage(booking, message)}
                          disabled={!message.can_send || isSending || message.status === "sending" || Boolean(sendingKey && !isSending)}
                        >
                          {isSending ? "Wird gesendet …" : message.status === "sent" ? "Erneut senden" : message.status === "failed" ? "Nochmal senden" : "Jetzt senden"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
