import { useEffect, useRef, useState } from 'react';
import './ReservationMail.css';

type Settings = Record<string, string>;
type Event = { id: number; title: string; performance_date?: string };
type Booking = { id: number; number: string; name: string; status: string; first_sent: string | null; reminder_sent: string | null; reminder_due: string | null; reminder_status: string | null; reminder_error: string | null };
function headers() {
  const user = JSON.parse(localStorage.getItem('theater.loggedInUser') || '{}');
  return { 'Content-Type': 'application/json', 'X-User-Id': String(user.user_id || ''), 'X-User-Name': user.display_name || user.username || '' };
}
async function result(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Bitte prüfe die Eingaben.');
  return data;
}
const textFields = [
  ['sender_name','Absendername'], ['subject_template','Betreff der Reservierung'],
  ['header_label','Überschrift im Kopf'], ['success_heading','Reservierungsstatus'],
  ['intro_text','Text der Reservierungsbestätigung'], ['booking_heading','Überschrift der Buchungsdaten'],
  ['amount_label','Beschriftung des offenen Betrags'], ['delivery_email_text','Hinweis für digitale Tickets'],
  ['delivery_postal_text','Hinweis für Postversand'], ['thank_you_text','Dankestext'], ['closing_text','Grußformel'],
];
const reminderFields = [['reminder_subject','Betreff der letzten Erinnerung'],['reminder_heading','Überschrift der Erinnerung'],['reminder_intro','Text der letzten Erinnerung']];
const colors = [['background_color','Hintergrund'],['header_color','Kopfbereich'],['accent_color','Akzent und Zahlungsbutton'],['card_color','Buchungsdaten'],['text_color','Schriftfarbe']];

export default function ReservationMail({ onBack, isAdmin }: { onBack: () => void; isAdmin: boolean }) {
  const [events,setEvents] = useState<Event[]>([]);
  const [eventId,setEventId] = useState('');
  const currentEvent = useRef(eventId);
  currentEvent.current = eventId;
  const [bookings,setBookings] = useState<Booking[]>([]);
  const [bookingId,setBookingId] = useState('');
  const [settings,setSettings] = useState<Settings | null>(null);
  const [saved,setSaved] = useState('');
  const [recipient,setRecipient] = useState('');
  const [reminder,setReminder] = useState(false);
  const [preview,setPreview] = useState({html:'',subject:''});
  const [previewError,setPreviewError] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const selected = bookings.find(b => String(b.id) === bookingId);
  const dirty = settings !== null && JSON.stringify(settings) !== saved;
  const blocked = !selected || ['bezahlt','storniert','storno'].includes(selected.status.toLowerCase());

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/performances',{headers:headers(),signal:controller.signal}).then(result).then(data => {
      const list = Array.isArray(data) ? data : data.performances || [];
      setEvents(list); if (list.length) setEventId(String(list[0].id));
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  },[]);
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    setSettings(null); setBookings([]); setBookingId(''); setPreview({html:'',subject:''}); setError(''); setNotice('');
    Promise.all([
      fetch(`/api/reservation-templates/${eventId}`,{headers:headers(),signal:controller.signal}).then(result),
      fetch(`/api/reservation-mail-bookings/${eventId}`,{headers:headers(),signal:controller.signal}).then(result),
    ]).then(([template,data]) => {
      if (controller.signal.aborted) return;
      setSettings(template.settings); setSaved(JSON.stringify(template.settings)); setRecipient(template.test_recipient);
      setBookings(data.bookings);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  },[eventId]);
  useEffect(() => {
    if (!settings || !eventId) return;
    const controller = new AbortController();
    setPreviewError('');
    const timer = window.setTimeout(() => {
      fetch(`/api/reservation-templates/${eventId}/preview`,{
        method:'POST',headers:headers(),signal:controller.signal,
        body:JSON.stringify({settings,booking_id:bookingId ? Number(bookingId) : null,reminder}),
      }).then(result).then(data => { if (!controller.signal.aborted) setPreview(data); })
        .catch(e => { if (!controller.signal.aborted) { setPreview({html:'',subject:''}); setPreviewError(e.message); } });
    },250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  },[settings,eventId,bookingId,reminder]);

  async function refresh() {
    const data = await fetch(`/api/reservation-mail-bookings/${eventId}`,{headers:headers()}).then(result);
    if (currentEvent.current === eventId) setBookings(data.bookings);
  }
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      await fetch(`/api/reservation-templates/${eventId}`,{method:'PUT',headers:headers(),body:JSON.stringify(settings)}).then(result);
      setSaved(JSON.stringify(settings)); setNotice('Vorlage für diese Veranstaltung gespeichert.');
    } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function send() {
    if (!selected || dirty) return;
    if (selected.first_sent && !window.confirm('Die Reservierungsmail wurde bereits versendet. Erneut senden? Die Erinnerungsfrist bleibt bestehen.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await fetch(`/api/email-outbox/${selected.id}/reservation/send`,{
        method:'POST',headers:headers(),body:JSON.stringify({force:Boolean(selected.first_sent)}),
      }).then(result);
      setNotice(data.message); await refresh();
    } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function field([key,label]: string[]) {
    return <label key={key}>{label}{key.includes('text') || key.includes('intro') ?
      <textarea rows={4} value={settings?.[key] || ''} onChange={e => setSettings({...settings,[key]:e.target.value})} /> :
      <input value={settings?.[key] || ''} onChange={e => setSettings({...settings,[key]:e.target.value})} />}</label>;
  }
  return <div className="reservation-mail">
    <header><button onClick={onBack}>← Zurück</button><div><small>RESERVIERUNGEN</small><h1>Reservierungsbestätigung mit Zahlungslink</h1><p>Vorlage gestalten, Buchung auswählen und persönlich versenden.</p></div></header>
    {error && <p className="rm-error" role="alert">{error}</p>}
    {notice && <p className="rm-notice" role="status">{notice}</p>}
    <section className="rm-card"><label>Veranstaltung<select value={eventId} disabled={busy} onChange={e => {
      if (!dirty || window.confirm('Ungespeicherte Änderungen verwerfen?')) setEventId(e.target.value);
    }}><option value="">Veranstaltung auswählen</option>{events.map(e => <option key={e.id} value={e.id}>{e.title} · {e.performance_date}</option>)}</select></label>
    <p>Alle Einstellungen gelten für die ausgewählte Veranstaltung. {recipient && <>Testbetrieb: Versand ausschließlich an <strong>{recipient}</strong>.</>}</p></section>
    {settings && <div className="rm-columns"><div>
      <section className="rm-card"><h2>1 · Reservierung manuell senden</h2>
        <p>Lege zuerst die Person und Buchung an und speichere eine Rechnung mit Zahlungsstatus „offen“.</p>
        <label>Buchung<select value={bookingId} disabled={busy} onChange={e => setBookingId(e.target.value)}><option value="">Muster-Vorschau · keine Buchung ausgewählt</option>{bookings.map(b => <option key={b.id} value={b.id}>{b.number} · {b.name} · {b.status}</option>)}</select></label>
        {selected && <div className="rm-status"><p>Erste Reservierungsmail: <strong>{selected.first_sent || 'Noch nicht gesendet'}</strong></p><p>Letzte Erinnerung: <strong>{selected.reminder_sent ? `Versendet am ${selected.reminder_sent}` : blocked ? 'Kein Versand bei bezahlter oder stornierter Buchung' : selected.reminder_due ? `Frühestens ${selected.reminder_due}, falls noch unbezahlt` : '5 Tage nach der ersten Reservierungsmail'}</strong></p>{selected.reminder_error && <p role="alert">Versandfehler: {selected.reminder_error}</p>}</div>}
        {dirty && <p>Bitte die Vorlage vor dem Versand speichern.</p>}
        <div className="rm-actions"><button className="rm-primary" disabled={busy || blocked || dirty} onClick={() => void send()}>{busy ? 'Bitte warten …' : 'Reservierungsmail mit Zahlungslink senden'}</button><button disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}>Status aktualisieren</button></div>
      </section>
      <section className="rm-card"><h2>2 · Vorlage bearbeiten</h2><p>Platzhalter: {'{booking_number}, {event_title}, {customer_name}, {event_date}, {event_time}, {ticket_count}, {amount}'}</p>{!isAdmin && <p>Die Vorlage kann ein Administrator bearbeiten. Du kannst gespeicherte Reservierungsmails versenden.</p>}
        <fieldset disabled={!isAdmin || busy}>{textFields.map(field)}</fieldset>
      </section>
      <section className="rm-card"><h2>3 · Letzte Erinnerung nach 5 Tagen</h2><p>Einmalig und automatisch, sofern noch unbezahlt. Während eine Zahlung verarbeitet wird, erfolgt keine Erinnerung. Gestaltung und Zahlungslink entsprechen der Reservierungsmail.</p><fieldset disabled={!isAdmin || busy}>{reminderFields.map(field)}</fieldset><p>Der automatische Versand läuft, solange das Backend eingeschaltet ist. Nach einer Pause werden fällige Erinnerungen nachgeholt.</p></section>
      <section className="rm-card"><h2>4 · Gestaltung</h2><fieldset disabled={!isAdmin || busy}><label>Schriftart<select value={settings.font_family} onChange={e => setSettings({...settings,font_family:e.target.value})}><option value="arial">Arial</option><option value="trebuchet">Trebuchet</option><option value="verdana">Verdana</option><option value="georgia">Georgia</option></select></label><div className="rm-colors">{colors.map(([key,label]) => <label key={key}>{label}<div><input type="color" value={/^#[0-9a-f]{6}$/i.test(settings[key]) ? settings[key] : '#000000'} onChange={e => setSettings({...settings,[key]:e.target.value})}/><input aria-label={`${label} Farbcode`} value={settings[key]} onChange={e => setSettings({...settings,[key]:e.target.value})}/></div></label>)}</div></fieldset><button className="rm-primary" disabled={!isAdmin || busy || !dirty} onClick={() => void save()}>Vorlage für diese Veranstaltung speichern</button></section>
    </div><aside className="rm-card rm-preview"><h2>Live-Vorschau</h2><div className="rm-actions"><button aria-pressed={!reminder} onClick={() => setReminder(false)}>Reservierung</button><button aria-pressed={reminder} onClick={() => setReminder(true)}>Letzte Erinnerung</button></div><p><strong>{preview.subject}</strong></p>{previewError && <p role="alert">{previewError}</p>}<iframe title="Reservierungsmail-Vorschau" sandbox="allow-same-origin" srcDoc={preview.html} /><small>Direkt in der Nachricht scrollen. Die Vorschau löst keine Zahlung und keinen Versand aus.</small></aside></div>}
  </div>;
}
