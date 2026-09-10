import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./EmailTemplateSettings.css";

type Performance = {
  id: number;
  title?: string;
  performance_date?: string | null;
  start_time?: string | null;
  venue_name?: string | null;
};

type TicketSettings = {
  sender_name: string;
  subject_template: string;
  header_label: string;
  success_heading: string;
  intro_text: string;
  ticket_heading: string;
  attachment_heading: string;
  attachment_text: string;
  entry_note: string;
  thank_you_text: string;
  closing_text: string;
  font_family: string;
  background_color: string;
  header_color: string;
  accent_color: string;
  card_color: string;
  text_color: string;
  qr_x_mm: number;
  qr_y_mm: number;
  qr_size_mm: number;
  show_ticket_data: boolean;
};

type TemplateMeta = {
  has_background: boolean;
  background_original_name: string;
  background_mime_type: string;
  is_event_specific: boolean;
  updated_at?: string | null;
};

type Props = { onBack: () => void };

const DEFAULT_SETTINGS: TicketSettings = {
  sender_name: "Boulevardtheater Deidesheim",
  subject_template: "Deine Tickets {booking_number} – {event_title}",
  header_label: "DEINE TICKETS",
  success_heading: "Vorhang auf – deine Tickets sind da!",
  intro_text:
    "im Anhang findest du deine Eintrittskarten für deinen Besuch. Du kannst die Tickets auf dem Smartphone zeigen oder ausdrucken.",
  ticket_heading: "Dein Besuch",
  attachment_heading: "Ticket-PDF im Anhang",
  attachment_text:
    "Jedes Ticket besitzt einen eigenen QR-Code. Bitte halte das passende Ticket beim Einlass bereit.",
  entry_note: "Bitte sei rechtzeitig vor Veranstaltungsbeginn am Einlass.",
  thank_you_text: "Wir freuen uns auf einen wunderbaren Abend mit dir!",
  closing_text: "Viele Grüße",
  font_family: "arial",
  background_color: "#f5f2f3",
  header_color: "#242124",
  accent_color: "#cc0167",
  card_color: "#ffffff",
  text_color: "#252125",
  qr_x_mm: 22.5,
  qr_y_mm: 86,
  qr_size_mm: 40,
  show_ticket_data: true,
};

const DEFAULT_META: TemplateMeta = {
  has_background: false,
  background_original_name: "",
  background_mime_type: "",
  is_event_specific: false,
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
  key: keyof Pick<TicketSettings, "background_color" | "header_color" | "accent_color" | "card_color" | "text_color">;
  label: string;
}> = [
  { key: "background_color", label: "Außenfläche" },
  { key: "header_color", label: "Kopf" },
  { key: "accent_color", label: "Akzent / Ticket-Pink" },
  { key: "card_color", label: "Ticketbox" },
  { key: "text_color", label: "Text" },
];

function responseMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "detail" in data && typeof data.detail === "string") {
    return data.detail;
  }
  return fallback;
}

function dateLabel(performance: Performance) {
  const raw = performance.performance_date || "";
  if (!raw) return "ohne Datum";
  const [year, month, day] = raw.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : raw;
}

function timeLabel(value?: string | null) {
  return value ? value.slice(0, 5) : "";
}

export default function TicketTemplateSettings({ onBack }: Props) {
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [selectedPerformanceId, setSelectedPerformanceId] = useState<number | null>(null);
  const [settings, setSettings] = useState<TicketSettings>(DEFAULT_SETTINGS);
  const [meta, setMeta] = useState<TemplateMeta>(DEFAULT_META);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loggedInUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("theater.loggedInUser") || "{}"); }
    catch { return {}; }
  }, []);

  const authHeaders = useMemo(() => ({
    "X-User-Id": loggedInUser.user_id?.toString() || "",
    "X-User-Name": loggedInUser.username || "",
  }), [loggedInUser]);

  const selectedPerformance = useMemo(
    () => performances.find((item) => item.id === selectedPerformanceId) ?? null,
    [performances, selectedPerformanceId]
  );

  const clearPreview = useCallback(() => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  }, []);

  const refreshPreview = useCallback(async (performanceId: number) => {
    setPreviewLoading(true);
    try {
      const response = await fetch(`/api/admin/ticket-event-templates/${performanceId}/preview.pdf`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(responseMessage(data, "Ticket-Vorschau konnte nicht erstellt werden."));
      }
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ticket-Vorschau konnte nicht erstellt werden.");
    } finally {
      setPreviewLoading(false);
    }
  }, [authHeaders]);

  const loadTemplate = useCallback(async (performanceId: number) => {
    setLoading(true); setError(""); setMessage(""); clearPreview();
    try {
      const response = await fetch(`/api/admin/ticket-event-templates/${performanceId}`, {
        headers: authHeaders,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(data, "Event-Ticketvorlage konnte nicht geladen werden."));
      const next: TicketSettings = {
        ...DEFAULT_SETTINGS,
        ...(data || {}),
        qr_x_mm: Number(data?.qr_x_mm ?? DEFAULT_SETTINGS.qr_x_mm),
        qr_y_mm: Number(data?.qr_y_mm ?? DEFAULT_SETTINGS.qr_y_mm),
        qr_size_mm: Number(data?.qr_size_mm ?? DEFAULT_SETTINGS.qr_size_mm),
        show_ticket_data: data?.show_ticket_data !== false,
      };
      setSettings(next);
      setMeta({
        has_background: Boolean(data?.has_background),
        background_original_name: String(data?.background_original_name || ""),
        background_mime_type: String(data?.background_mime_type || ""),
        is_event_specific: Boolean(data?.is_event_specific),
        updated_at: data?.updated_at || null,
      });
      await refreshPreview(performanceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Event-Ticketvorlage konnte nicht geladen werden.");
    } finally { setLoading(false); }
  }, [authHeaders, clearPreview, refreshPreview]);

  useEffect(() => {
    let active = true;
    async function loadPerformances() {
      setLoading(true); setError("");
      try {
        const response = await fetch("/api/performances");
        const data = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(data)) throw new Error("Vorstellungen konnten nicht geladen werden.");
        if (!active) return;
        setPerformances(data);
        const today = new Date().toISOString().slice(0, 10);
        const next = data.find((item: Performance) => (item.performance_date || "") >= today) || data[0];
        setSelectedPerformanceId(next?.id ?? null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Vorstellungen konnten nicht geladen werden.");
      } finally { if (active) setLoading(false); }
    }
    void loadPerformances();
    return () => { active = false; clearPreview(); };
  }, [clearPreview]);

  useEffect(() => {
    if (selectedPerformanceId) void loadTemplate(selectedPerformanceId);
  }, [selectedPerformanceId, loadTemplate]);

  function update<K extends keyof TicketSettings>(key: K, value: TicketSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage("");
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!selectedPerformanceId) return;
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/admin/ticket-event-templates/${selectedPerformanceId}`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(data, "Event-Ticketvorlage konnte nicht gespeichert werden."));
      const stored = data?.settings || {};
      setSettings((current) => ({ ...current, ...stored }));
      setMeta((current) => ({ ...current, is_event_specific: true }));
      setMessage(`Vorlage für „${selectedPerformance?.title || "Event"}“ wurde gespeichert.`);
      await refreshPreview(selectedPerformanceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Event-Ticketvorlage konnte nicht gespeichert werden.");
    } finally { setSaving(false); }
  }

  async function uploadBackground(file: File) {
    if (!selectedPerformanceId) return;
    setUploading(true); setMessage(""); setError("");
    try {
      const form = new FormData();
      form.append("background", file);
      const response = await fetch(`/api/admin/ticket-event-templates/${selectedPerformanceId}/background`, {
        method: "POST",
        headers: authHeaders,
        body: form,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(data, "Ticketgrafik konnte nicht hochgeladen werden."));
      const stored = data?.template || {};
      setMeta({
        has_background: Boolean(stored.has_background),
        background_original_name: String(stored.background_original_name || file.name),
        background_mime_type: String(stored.background_mime_type || file.type),
        is_event_specific: true,
        updated_at: stored.updated_at || null,
      });
      setMessage(`Ticketgrafik „${file.name}“ wurde für dieses Event hinterlegt.`);
      if (fileRef.current) fileRef.current.value = "";
      await refreshPreview(selectedPerformanceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ticketgrafik konnte nicht hochgeladen werden.");
    } finally { setUploading(false); }
  }

  async function deleteBackground() {
    if (!selectedPerformanceId || !meta.has_background) return;
    if (!window.confirm("Die hinterlegte Ticketgrafik für dieses Event wirklich entfernen?")) return;
    setUploading(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/admin/ticket-event-templates/${selectedPerformanceId}/background`, {
        method: "DELETE", headers: authHeaders,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(data, "Ticketgrafik konnte nicht entfernt werden."));
      setMeta((current) => ({ ...current, has_background: false, background_original_name: "", background_mime_type: "" }));
      setMessage("Ticketgrafik wurde entfernt. Das Standardticket wird wieder verwendet.");
      await refreshPreview(selectedPerformanceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ticketgrafik konnte nicht entfernt werden.");
    } finally { setUploading(false); }
  }

  async function resetEventTemplate() {
    if (!selectedPerformanceId) return;
    if (!window.confirm("Die komplette Ticket-Mail und Ticketgrafik dieses Events auf den Standard zurücksetzen?")) return;
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/admin/ticket-event-templates/${selectedPerformanceId}`, {
        method: "DELETE", headers: authHeaders,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(data, "Eventvorlage konnte nicht zurückgesetzt werden."));
      setMessage("Eventvorlage wurde auf den allgemeinen Standard zurückgesetzt.");
      await loadTemplate(selectedPerformanceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eventvorlage konnte nicht zurückgesetzt werden.");
    } finally { setSaving(false); }
  }

  async function sendTestMail() {
    if (!selectedPerformanceId) return;
    setSending(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/admin/ticket-event-templates/${selectedPerformanceId}/send-test`, {
        method: "POST", headers: authHeaders,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(data, "Testmail konnte nicht gesendet werden."));
      setMessage(`${data?.message || "Testmail wurde gesendet."} Empfänger: ${data?.recipient || "EMAIL_TEST_RECIPIENT"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Testmail konnte nicht gesendet werden.");
    } finally { setSending(false); }
  }

  const previewSubject = settings.subject_template
    .replaceAll("{booking_number}", "DSPL-1912-001")
    .replaceAll("{event_title}", selectedPerformance?.title || "Comedy & Genuss")
    .replaceAll("{customer_name}", "Erika Muster")
    .replaceAll("{event_date}", selectedPerformance ? dateLabel(selectedPerformance) : "19.12.2026")
    .replaceAll("{event_time}", selectedPerformance ? timeLabel(selectedPerformance.start_time) : "19:00")
    .replaceAll("{ticket_count}", "2")
    .replaceAll("{amount}", "203,30 EUR");

  return (
    <div className="email-settings-page">
      <header className="email-settings-header">
        <div>
          <span className="email-settings-kicker">TICKETING · EVENTVORLAGEN</span>
          <h1>Ticket-Mail</h1>
          <p>Pro Vorstellung eine eigene Mail und eine eigene 85 × 210 mm Ticketgrafik.</p>
        </div>
        <div className="email-settings-header-actions">
          <button type="button" className="secondary" onClick={onBack}>Zurück</button>
          <button type="button" className="secondary" onClick={() => void resetEventTemplate()} disabled={saving || loading || !selectedPerformanceId}>Eventvorlage zurücksetzen</button>
          <button type="submit" form="ticket-settings-form" className="primary" disabled={saving || loading || !selectedPerformanceId}>{saving ? "Wird gespeichert …" : "Eventvorlage speichern"}</button>
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
        <div className={`email-settings-template-status ${meta.is_event_specific ? "custom" : "default"}`}>
          <strong>{meta.is_event_specific ? "Eigene Eventvorlage" : "Allgemeiner Standard"}</strong>
          <span>{selectedPerformance?.venue_name || "Veranstaltungsort wird aus dem Event übernommen"}</span>
        </div>
        <button type="button" className="primary" onClick={() => void sendTestMail()} disabled={!selectedPerformanceId || sending || loading}>
          {sending ? "Testmail wird gesendet …" : "Testmail an Mailpit senden"}
        </button>
      </section>

      {loading ? <div className="email-settings-loading">Event-Ticketvorlage wird geladen …</div> : !selectedPerformanceId ? (
        <div className="email-settings-loading">Es wurde keine Vorstellung gefunden.</div>
      ) : (
        <div className="email-settings-layout">
          <form id="ticket-settings-form" className="email-settings-form" onSubmit={(event) => void saveSettings(event)}>
            <section className="email-settings-section ticket-artwork-section">
              <div className="email-settings-section-title"><span>1</span><div><h2>Ticketgrafik für dieses Event</h2><p>Die Grafik ist der feste Hintergrund. QR-Code und Ticketdaten werden bei jedem Versand neu darübergelegt.</p></div></div>
              <div className="ticket-artwork-drop">
                <div>
                  <strong>{meta.has_background ? meta.background_original_name : "Noch keine Eventgrafik hinterlegt"}</strong>
                  <span>{meta.has_background ? "Diese Datei wird nur für die ausgewählte Vorstellung verwendet." : "Ohne Upload verwendet die Software das schlichte Standardticket."}</span>
                  <small>Erlaubt: PDF, JPG oder PNG · maximal 25 MB · PDF idealerweise exakt 85 × 210 mm.</small>
                </div>
                <div className="ticket-artwork-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadBackground(file);
                    }}
                    disabled={uploading}
                  />
                  {meta.has_background && <button type="button" className="secondary" onClick={() => void deleteBackground()} disabled={uploading}>Grafik entfernen</button>}
                </div>
              </div>
              <div className="ticket-template-explainer">
                <strong>Wichtig:</strong> Der QR-Code gehört nicht fest in die Grafik. Die Software erzeugt bei jeder Eintrittskarte automatisch einen neuen QR aus <code>BTD|Ticket-Token</code> und setzt ihn über die Vorlage.
              </div>
            </section>

            <section className="email-settings-section">
              <div className="email-settings-section-title"><span>2</span><div><h2>QR-Position</h2><p>Damit können wir den dynamischen QR später exakt an das finale Printabl-Design anpassen.</p></div></div>
              <div className="email-settings-three-columns">
                <label>QR links (mm)<input type="number" min="0" max="85" step="0.5" value={settings.qr_x_mm} onChange={(e) => update("qr_x_mm", Number(e.target.value))} /></label>
                <label>QR unten (mm)<input type="number" min="28" max="195" step="0.5" value={settings.qr_y_mm} onChange={(e) => update("qr_y_mm", Number(e.target.value))} /></label>
                <label>QR Größe (mm)<input type="number" min="18" max="60" step="0.5" value={settings.qr_size_mm} onChange={(e) => update("qr_size_mm", Number(e.target.value))} /></label>
              </div>
              <label className="email-settings-check"><input type="checkbox" checked={settings.show_ticket_data} onChange={(e) => update("show_ticket_data", e.target.checked)} /><span>Buchungsnummer, Platz und „Ticket x von y“ zusätzlich unter dem QR anzeigen</span></label>
            </section>

            <section className="email-settings-section">
              <div className="email-settings-section-title"><span>3</span><div><h2>Absender und Betreff</h2><p>Auch die E-Mail-Texte werden pro Event gespeichert.</p></div></div>
              <label>Absendername<input required value={settings.sender_name} onChange={(e) => update("sender_name", e.target.value)} /></label>
              <label>Betreff<input required value={settings.subject_template} onChange={(e) => update("subject_template", e.target.value)} /><small>Platzhalter: {"{booking_number}"}, {"{event_title}"}, {"{customer_name}"}, {"{event_date}"}, {"{event_time}"}, {"{ticket_count}"}</small></label>
              <label>Schrift<select value={settings.font_family} onChange={(e) => update("font_family", e.target.value)}>{FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
            </section>

            <section className="email-settings-section">
              <div className="email-settings-section-title"><span>4</span><div><h2>Mailtexte</h2><p>Inhalt der separaten Ticket-Mail für dieses Event.</p></div></div>
              <div className="email-settings-two-columns">
                <label>Kleine Überschrift<input required value={settings.header_label} onChange={(e) => update("header_label", e.target.value)} /></label>
                <label>Hauptüberschrift<input required value={settings.success_heading} onChange={(e) => update("success_heading", e.target.value)} /></label>
              </div>
              <label>Begrüßungstext<textarea rows={3} value={settings.intro_text} onChange={(e) => update("intro_text", e.target.value)} /></label>
              <label>Überschrift Veranstaltungsdaten<input required value={settings.ticket_heading} onChange={(e) => update("ticket_heading", e.target.value)} /></label>
              <div className="email-settings-two-columns">
                <label>Überschrift Anhang<input value={settings.attachment_heading} onChange={(e) => update("attachment_heading", e.target.value)} /></label>
                <label>Kurztext Anhang<input value={settings.attachment_text} onChange={(e) => update("attachment_text", e.target.value)} /></label>
              </div>
              <label>Einlass-Hinweis<textarea rows={2} value={settings.entry_note} onChange={(e) => update("entry_note", e.target.value)} /></label>
              <label>Dankestext<textarea rows={2} value={settings.thank_you_text} onChange={(e) => update("thank_you_text", e.target.value)} /></label>
              <label>Grußformel<input value={settings.closing_text} onChange={(e) => update("closing_text", e.target.value)} /></label>
            </section>

            <section className="email-settings-section">
              <div className="email-settings-section-title"><span>5</span><div><h2>Mailfarben</h2><p>Der Ticket-PDF-Hintergrund kommt aus der hochgeladenen Grafik; diese Farben gestalten die E-Mail.</p></div></div>
              <div className="email-settings-colors">{COLOR_FIELDS.map((field) => (
                <label key={field.key} className="email-settings-color">{field.label}<span><input type="color" value={settings[field.key]} onChange={(e) => update(field.key, e.target.value)} /><code>{settings[field.key]}</code></span></label>
              ))}</div>
            </section>
            <button className="email-settings-mobile-save primary" disabled={saving}>{saving ? "Wird gespeichert …" : "Eventvorlage speichern"}</button>
          </form>

          <aside className="email-preview-column"><div className="email-preview-sticky">
            <div className="email-preview-toolbar"><div><strong>Ticket-PDF-Vorschau</strong><span>{selectedPerformance?.title || "ausgewähltes Event"}</span></div><button type="button" className="secondary" onClick={() => selectedPerformanceId && void refreshPreview(selectedPerformanceId)} disabled={previewLoading}>{previewLoading ? "…" : "Neu laden"}</button></div>
            <div className="ticket-pdf-preview">
              {previewUrl ? <iframe title="Ticket-PDF-Vorschau" src={previewUrl} /> : <div>PDF-Vorschau wird erstellt …</div>}
            </div>
            <div className="email-preview-subject"><span>Mail-Betreff</span><strong>{previewSubject}</strong></div>
            <div className="email-preview-canvas" style={{ background: settings.background_color, color: settings.text_color, fontFamily: FONT_CSS[settings.font_family] || FONT_CSS.arial }}>
              <div className="email-preview-mail">
                <div className="email-preview-accent" style={{ background: settings.accent_color }} />
                <div className="email-preview-header" style={{ background: settings.header_color }}><span style={{ color: settings.accent_color }}>{settings.header_label}</span><strong>{settings.sender_name}</strong></div>
                <div className="email-preview-body">
                  <span className="email-preview-success">✓ {settings.success_heading}</span>
                  <h2 style={{ color: settings.text_color }}>Hallo Erika Muster,</h2><p>{settings.intro_text}</p>
                  <div className="email-preview-booking" style={{ background: settings.card_color }}><strong style={{ color: settings.accent_color }}>{settings.ticket_heading}</strong><dl>
                    <div><dt>Buchungsnummer</dt><dd>DSPL-1912-001</dd></div><div><dt>Veranstaltung</dt><dd>{selectedPerformance?.title || "Comedy & Genuss"}</dd></div><div><dt>Datum</dt><dd>{selectedPerformance ? dateLabel(selectedPerformance) : "19.12.2026"}</dd></div><div><dt>Uhrzeit</dt><dd>{selectedPerformance ? timeLabel(selectedPerformance.start_time) : "19:00"} Uhr</dd></div><div><dt>Veranstaltungsort</dt><dd>{selectedPerformance?.venue_name || "—"}</dd></div><div><dt>Tickets</dt><dd>2</dd></div>
                  </dl></div>
                  <div className="email-preview-pdf" style={{ borderLeftColor: settings.accent_color }}><strong>{settings.attachment_heading}</strong><span>{settings.attachment_text}</span></div>
                  <p>{settings.entry_note}</p><p>{settings.thank_you_text}</p><p>{settings.closing_text}<br /><strong>{settings.sender_name}</strong></p>
                </div>
                <div className="email-preview-test"><strong>Offline-Testmail</strong><br />Ursprüngliche Kundenadresse: kunde@beispiel.de</div>
              </div>
            </div>
          </div></aside>
        </div>
      )}
    </div>
  );
}
