import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./EmailTemplateSettings.css";

type EmailSettings = {
  sender_name: string;
  subject_template: string;
  header_label: string;
  success_heading: string;
  intro_text: string;
  booking_heading: string;
  amount_label: string;
  pdf_heading: string;
  pdf_text: string;
  delivery_email_text: string;
  delivery_postal_text: string;
  thank_you_text: string;
  closing_text: string;
  font_family: string;
  background_color: string;
  header_color: string;
  accent_color: string;
  card_color: string;
  text_color: string;
};

type Performance = {
  id: number;
  title?: string;
  performance_date?: string | null;
  start_time?: string | null;
  venue_name?: string | null;
};

type Props = {
  onBack: () => void;
};

const DEFAULT_SETTINGS: EmailSettings = {
  sender_name: "Boulevardtheater Deidesheim",
  subject_template: "Buchungsbestätigung {booking_number} – {event_title}",
  header_label: "Buchungsbestätigung",
  success_heading: "Zahlung erfolgreich bestätigt",
  intro_text:
    "wir haben deine Zahlung erhalten. Deine Buchung ist damit erfolgreich bestätigt.",
  booking_heading: "Deine Buchung",
  amount_label: "Bezahlter Betrag",
  pdf_heading: "",
  pdf_text: "",
  delivery_email_text: "Deine Tickets und deine Rechnung erhältst du in zwei separaten E-Mails.",
  delivery_postal_text:
    "Deine Eintrittskarten werden entsprechend der gewählten Versandart per Post versendet.",
  thank_you_text:
    "Vielen Dank für deine Buchung. Wir freuen uns auf deinen Besuch!",
  closing_text: "Viele Grüße",
  font_family: "arial",
  background_color: "#f3f0ec",
  header_color: "#211c19",
  accent_color: "#b87333",
  card_color: "#fbf8f4",
  text_color: "#241f1b",
};

const FONT_OPTIONS = [
  { value: "arial", label: "Arial – klar und modern" },
  { value: "trebuchet", label: "Trebuchet – freundlich" },
  { value: "verdana", label: "Verdana – besonders gut lesbar" },
  { value: "georgia", label: "Georgia – klassisch" },
];

const FONT_CSS: Record<string, string> = {
  arial: "Arial, Helvetica, sans-serif",
  trebuchet: "'Trebuchet MS', Arial, sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
};

const COLOR_FIELDS: Array<{
  key: keyof Pick<
    EmailSettings,
    | "background_color"
    | "header_color"
    | "accent_color"
    | "card_color"
    | "text_color"
  >;
  label: string;
}> = [
  { key: "background_color", label: "Außenfläche" },
  { key: "header_color", label: "Kopf und Betrag" },
  { key: "accent_color", label: "Akzent" },
  { key: "card_color", label: "Buchungsbox" },
  { key: "text_color", label: "Text" },
];

function responseMessage(data: unknown, fallback: string) {
  if (
    data &&
    typeof data === "object" &&
    "detail" in data &&
    typeof data.detail === "string"
  ) {
    return data.detail;
  }
  return fallback;
}

function readEmailSettings(data: unknown): EmailSettings {
  const next = { ...DEFAULT_SETTINGS };
  if (!data || typeof data !== "object") return next;
  for (const key of Object.keys(next) as Array<keyof EmailSettings>) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "string") next[key] = value;
  }
  return next;
}

function dateLabel(performance: Performance | null) {
  const raw = performance?.performance_date || "";
  if (!raw) return "ohne Datum";
  const [year, month, day] = raw.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : raw;
}

function timeLabel(value?: string | null) {
  return value ? value.slice(0, 5) : "";
}

export default function EmailTemplateSettings({ onBack }: Props) {
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [selectedPerformanceId, setSelectedPerformanceId] = useState<number | null>(null);
  const [isEventSpecific, setIsEventSpecific] = useState(false);
  const [settings, setSettings] = useState<EmailSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loggedInUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("theater.loggedInUser") || "{}");
    } catch {
      return {};
    }
  }, []);

  const authHeaders = useMemo(
    () => ({
      "X-User-Id": loggedInUser.user_id?.toString() || "",
      "X-User-Name": loggedInUser.username || "",
    }),
    [loggedInUser]
  );

  const selectedPerformance = useMemo(
    () => performances.find((item) => item.id === selectedPerformanceId) ?? null,
    [performances, selectedPerformanceId]
  );

  useEffect(() => {
    let active = true;
    async function loadPerformances() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/performances");
        const data = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(data)) {
          throw new Error("Vorstellungen konnten nicht geladen werden.");
        }
        if (!active) return;
        setPerformances(data);
        const today = new Date().toISOString().slice(0, 10);
        const next = data.find(
          (item: Performance) => (item.performance_date || "") >= today
        ) || data[0];
        setSelectedPerformanceId(next?.id ?? null);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Vorstellungen konnten nicht geladen werden."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadPerformances();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedPerformanceId) return;
    let active = true;
    async function loadSettings() {
      setLoading(true);
      setError("");
      setMessage("");
      try {
        const response = await fetch(
          `/api/admin/email-event-templates/${selectedPerformanceId}`,
          { headers: authHeaders }
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            responseMessage(data, "Event-E-Mail-Vorlage konnte nicht geladen werden.")
          );
        }
        if (active) {
          setSettings(readEmailSettings(data));
          setIsEventSpecific(Boolean(data?.is_event_specific));
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Event-E-Mail-Vorlage konnte nicht geladen werden."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadSettings();
    return () => { active = false; };
  }, [authHeaders, selectedPerformanceId]);

  function update<K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage("");
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!selectedPerformanceId) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(
        `/api/admin/email-event-templates/${selectedPerformanceId}`,
        {
          method: "PUT",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(settings),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(data, "E-Mail-Vorlage konnte nicht gespeichert werden.")
        );
      }
      if (data?.settings) {
        setSettings(readEmailSettings(data.settings));
      }
      setIsEventSpecific(true);
      setMessage(
        `Die E-Mail-Vorlage für „${selectedPerformance?.title || "Event"}“ wurde gespeichert.`
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "E-Mail-Vorlage konnte nicht gespeichert werden."
      );
    } finally {
      setSaving(false);
    }
  }

  async function resetSettings() {
    if (!selectedPerformanceId) return;
    if (!window.confirm(
      `Die E-Mail-Vorlage für „${selectedPerformance?.title || "dieses Event"}“ wirklich auf den allgemeinen Standard zurücksetzen?`
    )) {
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(
        `/api/admin/email-event-templates/${selectedPerformanceId}`,
        { method: "DELETE", headers: authHeaders }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(data, "E-Mail-Vorlage konnte nicht zurückgesetzt werden.")
        );
      }
      setSettings(readEmailSettings(data?.settings));
      setIsEventSpecific(false);
      setMessage("Für dieses Event wird wieder die allgemeine Standardvorlage verwendet.");
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "E-Mail-Vorlage konnte nicht zurückgesetzt werden."
      );
    } finally {
      setSaving(false);
    }
  }

  const previewSubject = settings.subject_template
    .replaceAll("{booking_number}", "DSPL-1912-001")
    .replaceAll("{event_title}", selectedPerformance?.title || "Dinnershow")
    .replaceAll("{customer_name}", "Erika Muster")
    .replaceAll("{event_date}", dateLabel(selectedPerformance))
    .replaceAll("{event_time}", timeLabel(selectedPerformance?.start_time) || "19:00")
    .replaceAll("{ticket_count}", "2")
    .replaceAll("{amount}", "203,30 EUR");

  return (
    <div className="email-settings-page">
      <header className="email-settings-header">
        <div>
          <span className="email-settings-kicker">KOMMUNIKATION</span>
          <h1>Event-E-Mail-Vorlage</h1>
          <p>Für jede Vorstellung eine eigene Buchungs- und Rechnungs-Mail gestalten.</p>
        </div>
        <div className="email-settings-header-actions">
          <button type="button" className="secondary" onClick={onBack}>
            Zurück
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void resetSettings()}
            disabled={saving || loading || !selectedPerformanceId}
          >
            Eventvorlage zurücksetzen
          </button>
          <button
            type="submit"
            form="email-settings-form"
            className="primary"
            disabled={saving || loading || !selectedPerformanceId}
          >
            {saving ? "Wird gespeichert …" : "Eventvorlage speichern"}
          </button>
        </div>
      </header>

      {message && <div className="email-settings-message success">{message}</div>}
      {error && <div className="email-settings-message error">{error}</div>}

      <section className="email-settings-eventbar">
        <label>
          <span>Vorstellung / Event</span>
          <select
            value={selectedPerformanceId ?? ""}
            onChange={(event) => setSelectedPerformanceId(Number(event.target.value) || null)}
            disabled={performances.length === 0}
          >
            {performances.map((performance) => (
              <option key={performance.id} value={performance.id}>
                {dateLabel(performance)} {timeLabel(performance.start_time)} · {performance.title || `Vorstellung ${performance.id}`}
              </option>
            ))}
          </select>
        </label>
        <div className={`email-settings-template-status ${isEventSpecific ? "custom" : "default"}`}>
          <strong>{isEventSpecific ? "Eigene Eventvorlage" : "Allgemeiner Standard"}</strong>
          <span>{selectedPerformance?.venue_name || "Veranstaltungsort wird aus dem Event übernommen"}</span>
        </div>
        <div className="email-settings-template-status default">
          <strong>Automatische Auswahl</strong>
          <span>Buchungs- und Rechnungs-Mail verwenden beim Versand dieses Event.</span>
        </div>
      </section>

      {loading ? (
        <div className="email-settings-loading">Event-E-Mail-Vorlage wird geladen …</div>
      ) : !selectedPerformanceId ? (
        <div className="email-settings-loading">Es wurde keine Vorstellung gefunden.</div>
      ) : (
        <div className="email-settings-layout">
          <form
            id="email-settings-form"
            className="email-settings-form"
            onSubmit={(event) => void saveSettings(event)}
          >
            <section className="email-settings-section">
              <div className="email-settings-section-title">
                <span>1</span>
                <div>
                  <h2>Absender und Betreff</h2>
                  <p>Diese Angaben sehen Kundinnen und Kunden zuerst.</p>
                </div>
              </div>

              <label>
                Absendername
                <input
                  required
                  maxLength={160}
                  value={settings.sender_name}
                  onChange={(event) => update("sender_name", event.target.value)}
                />
              </label>

              <label>
                Betreff
                <input
                  required
                  maxLength={240}
                  value={settings.subject_template}
                  onChange={(event) =>
                    update("subject_template", event.target.value)
                  }
                />
                <small>
                  Platzhalter: {"{booking_number}"}, {"{event_title}"}, {"{customer_name}"}, {"{event_date}"}, {"{event_time}"}, {"{ticket_count}"}, {"{amount}"}
                </small>
              </label>

              <label>
                Schrift
                <select
                  value={settings.font_family}
                  onChange={(event) => update("font_family", event.target.value)}
                >
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="email-settings-section">
              <div className="email-settings-section-title">
                <span>2</span>
                <div>
                  <h2>Texte</h2>
                  <p>Alle sichtbaren Formulierungen der Bestätigung.</p>
                </div>
              </div>

              <div className="email-settings-two-columns">
                <label>
                  Kleine Überschrift
                  <input
                    required
                    value={settings.header_label}
                    onChange={(event) => update("header_label", event.target.value)}
                  />
                </label>
                <label>
                  Erfolgs-Hinweis
                  <input
                    required
                    value={settings.success_heading}
                    onChange={(event) =>
                      update("success_heading", event.target.value)
                    }
                  />
                </label>
              </div>

              <label>
                Begrüßungstext
                <textarea
                  rows={3}
                  value={settings.intro_text}
                  onChange={(event) => update("intro_text", event.target.value)}
                />
              </label>

              <div className="email-settings-two-columns">
                <label>
                  Überschrift Buchungsdaten
                  <input
                    required
                    value={settings.booking_heading}
                    onChange={(event) =>
                      update("booking_heading", event.target.value)
                    }
                  />
                </label>
                <label>
                  Beschriftung Betrag
                  <input
                    required
                    value={settings.amount_label}
                    onChange={(event) => update("amount_label", event.target.value)}
                  />
                </label>
              </div>


              <label>
                Hinweis bei digitaler Zustellung
                <input
                  value={settings.delivery_email_text}
                  onChange={(event) =>
                    update("delivery_email_text", event.target.value)
                  }
                />
              </label>

              <label>
                Hinweis bei Postversand
                <input
                  value={settings.delivery_postal_text}
                  onChange={(event) =>
                    update("delivery_postal_text", event.target.value)
                  }
                />
              </label>

              <label>
                Dankestext
                <textarea
                  rows={3}
                  value={settings.thank_you_text}
                  onChange={(event) => update("thank_you_text", event.target.value)}
                />
              </label>

              <label>
                Grußformel
                <input
                  value={settings.closing_text}
                  onChange={(event) => update("closing_text", event.target.value)}
                />
              </label>
            </section>

            <section className="email-settings-section">
              <div className="email-settings-section-title">
                <span>3</span>
                <div>
                  <h2>Farben</h2>
                  <p>Die Vorschau rechts reagiert sofort.</p>
                </div>
              </div>

              <div className="email-settings-colors">
                {COLOR_FIELDS.map((field) => (
                  <label key={field.key} className="email-settings-color">
                    {field.label}
                    <span>
                      <input
                        type="color"
                        value={settings[field.key]}
                        onChange={(event) => update(field.key, event.target.value)}
                      />
                      <code>{settings[field.key]}</code>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <button className="email-settings-mobile-save primary" disabled={saving || !selectedPerformanceId}>
              {saving ? "Wird gespeichert …" : "Eventvorlage speichern"}
            </button>
          </form>

          <aside className="email-preview-column">
            <div className="email-preview-sticky">
              <div className="email-preview-toolbar">
                <div>
                  <strong>Live-Vorschau</strong>
                  <span>Beispieldaten – es wird keine E-Mail versendet</span>
                </div>
              </div>

              <div className="email-preview-subject">
                <span>Betreff</span>
                <strong>{previewSubject}</strong>
              </div>

              <div
                className="email-preview-canvas"
                style={{
                  background: settings.background_color,
                  color: settings.text_color,
                  fontFamily: FONT_CSS[settings.font_family] || FONT_CSS.arial,
                }}
              >
                <div className="email-preview-mail">
                  <div
                    className="email-preview-accent"
                    style={{ background: settings.accent_color }}
                  />
                  <div
                    className="email-preview-header"
                    style={{ background: settings.header_color }}
                  >
                    <span style={{ color: settings.accent_color }}>
                      {settings.header_label}
                    </span>
                    <strong>{settings.sender_name}</strong>
                  </div>
                  <div className="email-preview-body">
                    <span className="email-preview-success">
                      ✓ {settings.success_heading}
                    </span>
                    <h2 style={{ color: settings.text_color }}>
                      Hallo Erika Muster,
                    </h2>
                    <p>{settings.intro_text}</p>

                    <div
                      className="email-preview-booking"
                      style={{ background: settings.card_color }}
                    >
                      <strong style={{ color: settings.accent_color }}>
                        {settings.booking_heading}
                      </strong>
                      <dl>
                        <div><dt>Buchungsnummer</dt><dd>DSPL-1912-001</dd></div>
                        <div><dt>Veranstaltung</dt><dd>{selectedPerformance?.title || "Dinnershow"}</dd></div>
                        <div><dt>Datum</dt><dd>{dateLabel(selectedPerformance)}</dd></div>
                        <div><dt>Uhrzeit</dt><dd>{timeLabel(selectedPerformance?.start_time) || "19:00"} Uhr</dd></div>
                        <div><dt>Anzahl Tickets</dt><dd>2</dd></div>
                      </dl>
                    </div>

                    <div
                      className="email-preview-amount"
                      style={{ background: settings.header_color }}
                    >
                      <span>{settings.amount_label}</span>
                      <strong>203,30 EUR</strong>
                    </div>

                    <p>{settings.delivery_email_text}</p>
                    <p>{settings.thank_you_text}</p>
                    <p>
                      {settings.closing_text}<br />
                      <strong>{settings.sender_name}</strong>
                    </p>
                  </div>
                  <div className="email-preview-test">
                    <strong>Offline-Testmail</strong><br />
                    Ursprüngliche Kundenadresse: kunde@beispiel.de
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
