import { useEffect, useMemo, useState } from "react";
import CheckoutFlow from "./CheckoutFlow";

type EventStatus = "published" | "sold_out" | "cancelled";
type SeatingMode = "assigned" | "staff_assigned" | "free";

type PriceComponent = {
  net: number;
  vat_rate: number;
  vat: number;
  gross: number;
};

type DetailedPriceComponent = PriceComponent & {
  category: "ticket" | "food" | "drink" | "other" | "service";
  name: string;
  provider_type: "internal" | "external";
  provider_name: string;
};

type PublicEvent = {
  id: number;
  title: string;
  performance_date: string;
  start_time: string;
  hall_plan_type: "hall_1" | "hall_2";
  short_description: string;
  description: string;
  image_url: string;
  venue_name: string;
  doors_time: string | null;
  sales_start_at: string | null;
  sales_end_at: string | null;
  publication_status: EventStatus;
  seating_mode: SeatingMode;
  capacity: number | null;
  price_from: number;
  max_tickets_per_order: number;
  public_slug: string;
  postal_shipping_gross: number;
  postal_shipping_vat_rate: number;
  price_breakdown?: {
    ticket?: PriceComponent;
    service: PriceComponent | DetailedPriceComponent;
    additional?: PriceComponent & { name: string };
    items?: DetailedPriceComponent[];
    service_fee_percent?: number;
    subtotal_gross?: number;
    total_net: number;
    total_vat: number;
    total_gross: number;
  };
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function resolveImageUrl(value: string) {
  if (!value || /^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? `${API_BASE}${value}` : value;
}

function eventPath(event: PublicEvent) {
  return `/events/${event.public_slug || event.id}`;
}

function eventIdFromPath() {
  const match = window.location.pathname.match(/^\/events\/([^/]+)\/?$/);
  if (!match) return null;
  const idMatch = match[1].match(/(?:^|-)(\d+)$/);
  return idMatch ? Number(idMatch[1]) : null;
}

function formatDate(value: string, includeYear = true) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(new Date(`${value}T12:00:00`));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function saleState(event: PublicEvent) {
  if (event.publication_status === "cancelled") {
    return { label: "Veranstaltung abgesagt", tone: "danger", selectable: false };
  }
  if (event.publication_status === "sold_out") {
    return { label: "Ausverkauft", tone: "danger", selectable: false };
  }

  const now = Date.now();
  const starts = event.sales_start_at ? new Date(event.sales_start_at).getTime() : null;
  const ends = event.sales_end_at ? new Date(event.sales_end_at).getTime() : null;

  if (starts && starts > now) {
    return {
      label: `Verkauf ab ${new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(starts)}`,
      tone: "waiting",
      selectable: false,
    };
  }
  if (ends && ends <= now) {
    return { label: "Verkauf beendet", tone: "muted", selectable: false };
  }
  return { label: "Tickets verfügbar", tone: "success", selectable: true };
}

function BrandHeader() {
  return (
    <>
      <div className="test-banner" role="status">
        <strong>Lokaler Testbetrieb</strong>
        <span>Stripe-Sandbox · Keine echte Abbuchung · Keine Ticket-E-Mail</span>
      </div>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Boulevardtheater Ticketshop Startseite">
          <img
            className="brand-logo"
            src="/boulevardtheater-logo.png"
            alt="Boulevardtheater Deidesheim"
          />
        </a>
        <nav aria-label="Hauptnavigation">
          <a href="/">Veranstaltungen</a>
          <span className="secure-note">Sicher buchen</span>
        </nav>
      </header>
    </>
  );
}

function EventImage({ event, compact = false }: { event: PublicEvent; compact?: boolean }) {
  const [failed, setFailed] = useState(false);

  if (!event.image_url || failed) {
    return (
      <div className={`event-image event-image-placeholder ${compact ? "compact" : ""}`}>
        <span>Vorhang auf</span>
        <strong>{event.title.slice(0, 1).toUpperCase()}</strong>
      </div>
    );
  }

  return (
    <div className={`event-image ${compact ? "compact" : ""}`}>
      <img src={resolveImageUrl(event.image_url)} alt="" onError={() => setFailed(true)} />
    </div>
  );
}

function EventsList() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/public/events`)
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.detail || "Die Veranstaltungen konnten nicht geladen werden.");
        }
        setEvents(Array.isArray(data) ? data : []);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Die Veranstaltungen konnten nicht geladen werden."),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <BrandHeader />
      <main>
        <section className="intro-section">
          <div>
            <span className="eyebrow">Programm & Tickets</span>
            <h1>Ihr Theaterbesuch beginnt hier.</h1>
          </div>
          <p>
            Wählen Sie eine Veranstaltung. Im Testbetrieb werden noch keine
            Bestellungen ausgelöst.
          </p>
        </section>

        <section className="events-section" aria-labelledby="events-title">
          <div className="section-heading">
            <h2 id="events-title">Veranstaltungen</h2>
            {!loading && !error && <span>{events.length} Termine</span>}
          </div>

          {loading && <div className="shop-state">Veranstaltungen werden geladen …</div>}
          {error && <div className="shop-state error">{error}</div>}
          {!loading && !error && events.length === 0 && (
            <div className="shop-state">
              <strong>Noch keine Veranstaltung veröffentlicht.</strong>
              <span>
                Sobald im Verwaltungsbereich ein Event auf „Veröffentlicht“ steht,
                erscheint es automatisch hier.
              </span>
            </div>
          )}

          <div className="events-list">
            {events.map((event) => {
              const state = saleState(event);
              return (
                <article className="event-card" key={event.id}>
                  <div className="date-tile">
                    <span>
                      {new Date(`${event.performance_date}T12:00:00`).toLocaleDateString("de-DE", {
                        month: "short",
                      })}
                    </span>
                    <strong>{new Date(`${event.performance_date}T12:00:00`).getDate()}</strong>
                    <small>
                      {new Date(`${event.performance_date}T12:00:00`).toLocaleDateString("de-DE", {
                        weekday: "short",
                      })}
                    </small>
                  </div>
                  <EventImage event={event} compact />
                  <div className="event-card-content">
                    <span className={`sale-state ${state.tone}`}>{state.label}</span>
                    <h3><a href={eventPath(event)}>{event.title}</a></h3>
                    <p className="event-meta">
                      {event.start_time.slice(0, 5)} Uhr · {event.venue_name}
                    </p>
                    {event.short_description && <p>{event.short_description}</p>}
                  </div>
                  <div className="event-card-buy">
                    <span>Gesamtpreis je Ticket</span>
                    <strong>{formatMoney(event.price_from)}</strong>
                    <a className="primary-action" href={eventPath(event)}>
                      Details & Tickets
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
      <ShopFooter />
    </>
  );
}

function PriceBreakdown({ event }: { event: PublicEvent }) {
  const prices = event.price_breakdown;
  if (!prices) return null;

  const structuredItems = prices.items || [];

  return (
    <div className="public-price-breakdown">
      {structuredItems.length > 0 ? (
        structuredItems.map((item, index) => (
          <div key={`${item.category}-${item.name}-${index}`}>
            <span>
              {item.name}
              {item.category !== "ticket" && (
                <small>
                  {item.vat_rate} % MwSt. · {item.provider_type === "external"
                    ? `extern${item.provider_name ? `: ${item.provider_name}` : ""}`
                    : "intern"}
                </small>
              )}
            </span>
            <strong>{formatMoney(item.gross)}</strong>
          </div>
        ))
      ) : (
        <>
          {prices.ticket && (
            <div>
              <span>Eintrittskarte</span>
              <strong>{formatMoney(prices.ticket.gross)}</strong>
            </div>
          )}
          {prices.additional && prices.additional.gross > 0 && (
            <div>
              <span>{prices.additional.name || "Sonstige Kosten"} <small>{prices.additional.vat_rate} % MwSt.</small></span>
              <strong>{formatMoney(prices.additional.gross)}</strong>
            </div>
          )}
        </>
      )}
      {prices.service.gross > 0 && (
        <div>
          <span>Servicepauschale</span>
          <strong>{formatMoney(prices.service.gross)}</strong>
        </div>
      )}
      <div className="vat-total-row">
        <span>Darin enthaltene MwSt.</span>
        <strong>{formatMoney(prices.total_vat)}</strong>
      </div>
      <div className="gross-total-row">
        <span>Endpreis je Ticket</span>
        <strong>{formatMoney(prices.total_gross)}</strong>
      </div>
    </div>
  );
}

function EventDetail({ eventId }: { eventId: number }) {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/public/events/${eventId}`)
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.detail || "Die Veranstaltung wurde nicht gefunden.");
        }
        setEvent(data);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Die Veranstaltung wurde nicht gefunden."),
      )
      .finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => {
    if (event) document.title = `${event.title} · Ticketshop (Test)`;
    return () => { document.title = "TheaterSoftware · Ticketshop (Test)"; };
  }, [event]);

  return (
    <>
      <BrandHeader />
      <main className="detail-main">
        <a className="back-link" href="/">← Alle Veranstaltungen</a>
        {loading && <div className="shop-state">Veranstaltung wird geladen …</div>}
        {error && <div className="shop-state error">{error}</div>}
        {event && (
          <>
            <section className="detail-hero">
              <EventImage event={event} />
              <div className="detail-hero-content">
                <span className={`sale-state ${saleState(event).tone}`}>{saleState(event).label}</span>
                <h1>{event.title}</h1>
                {event.short_description && <p>{event.short_description}</p>}
                <dl className="event-facts">
                  <div><dt>Termin</dt><dd>{formatDate(event.performance_date)}</dd></div>
                  <div><dt>Beginn</dt><dd>{event.start_time.slice(0, 5)} Uhr{event.doors_time ? ` · Einlass ${event.doors_time.slice(0, 5)} Uhr` : ""}</dd></div>
                  <div><dt>Ort</dt><dd>{event.venue_name}</dd></div>
                </dl>
              </div>
            </section>

            <div className="detail-grid">
              <article className="description-card">
                <span className="eyebrow">Zur Veranstaltung</span>
                <h2>{event.title}</h2>
                {event.description ? (
                  event.description.split("\n").map((paragraph, index) =>
                    paragraph.trim() ? <p key={index}>{paragraph}</p> : null,
                  )
                ) : (
                  <p>Weitere Informationen zu dieser Veranstaltung folgen.</p>
                )}
              </article>
              <aside className="booking-card">
                <div className="booking-price"><span>Endpreis je Ticket</span><strong>{formatMoney(event.price_from)}</strong></div>
                <PriceBreakdown event={event} />
                {saleState(event).selectable ? (
                  <CheckoutFlow event={event} apiBase={API_BASE} />
                ) : (
                  <div className={`selection-block blocked ${saleState(event).tone}`}>
                    {saleState(event).label}
                  </div>
                )}
                <p className="test-explainer">
                  Stripe-Sandbox: Testzahlungen und Testbuchungen werden verarbeitet,
                  es wird jedoch kein echtes Geld abgebucht und keine Ticket-E-Mail versendet.
                </p>
              </aside>
            </div>
          </>
        )}
      </main>
      <ShopFooter />
    </>
  );
}

function ShopFooter() {
  return (
    <footer className="shop-footer">
      <strong>TheaterSoftware Ticketshop</strong>
      <span>Lokale Entwicklungsversion · Nicht öffentlich erreichbar</span>
    </footer>
  );
}

export default function App() {
  const eventId = useMemo(eventIdFromPath, []);
  return eventId ? <EventDetail eventId={eventId} /> : <EventsList />;
}
