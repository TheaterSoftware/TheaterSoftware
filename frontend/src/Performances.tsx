import { useEffect, useState, type FormEvent } from "react";
import "./Performances.css";

type PublicationStatus = "draft" | "published" | "sold_out" | "cancelled";
type SeatingMode = "assigned" | "staff_assigned" | "free";
type ProviderType = "internal" | "external";
type PriceCategory = "ticket" | "food" | "drink" | "other";

type PriceItem = {
  category: PriceCategory;
  name: string;
  gross_amount: number;
  vat_rate: number;
  provider_type: ProviderType;
  provider_name: string;
};

type Performance = {
  id: number;
  title: string;
  performance_date: string;
  start_time: string;
  hall_plan_type?: "hall_1" | "hall_2";
  short_description?: string;
  description?: string;
  image_url?: string;
  venue_name?: string;
  doors_time?: string | null;
  sales_start_at?: string | null;
  sales_end_at?: string | null;
  publication_status?: PublicationStatus;
  seating_mode?: SeatingMode;
  capacity?: number | null;
  price_from?: number;
  max_tickets_per_order?: number;
  public_slug?: string;
  ticket_price_net?: number;
  ticket_vat_rate?: number;
  service_fee_net?: number;
  service_vat_rate?: number;
  additional_fee_name?: string;
  additional_fee_net?: number;
  additional_fee_vat_rate?: number;
  price_items?: PriceItem[];
  service_fee_percent?: number;
  postal_shipping_gross?: number;
  postal_shipping_vat_rate?: number;
};

type Props = { onBack: () => void };

const TICKETSHOP_BASE =
  import.meta.env.VITE_TICKETSHOP_URL || "http://127.0.0.1:5174";

const STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  sold_out: "Ausverkauft",
  cancelled: "Abgesagt",
};

const SEATING_LABELS: Record<SeatingMode, string> = {
  assigned: "Sitzplan – Gäste wählen ihre Plätze",
  staff_assigned: "Sitzplan – Plätze werden vom Theater zugewiesen",
  free: "Freie Platzwahl",
};

function toDatetimeLocal(value?: string | null) {
  if (!value) return "";
  const dateValue = new Date(value);
  const localValue = new Date(
    dateValue.getTime() - dateValue.getTimezoneOffset() * 60_000,
  );
  return localValue.toISOString().slice(0, 16);
}

function formatPublicationDateTime(value?: string | null) {
  if (!value) return "sofort nach dem Speichern";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

function getActorHeaders() {
  const user = JSON.parse(
    localStorage.getItem("theater.loggedInUser") || "{}",
  );
  return {
    "X-User-Id": user.user_id?.toString() || "",
    "X-User-Name": user.username || "",
  };
}

function calculateGrossComponent(grossValue: string | number, vatRate: number) {
  const gross = Math.round((Number(grossValue) || 0) * 100) / 100;
  const net = Math.round((gross / (1 + vatRate / 100)) * 100) / 100;
  return { net, vat: Math.round((gross - net) * 100) / 100, gross };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

type OptionalPriceRowProps = {
  title: string;
  name: string;
  setName: (value: string) => void;
  gross: string;
  setGross: (value: string) => void;
  vatRate: number;
  setVatRate: (value: number) => void;
  providerType: ProviderType;
  setProviderType: (value: ProviderType) => void;
  providerName: string;
  setProviderName: (value: string) => void;
};

function OptionalPriceRow(props: OptionalPriceRowProps) {
  const component = calculateGrossComponent(props.gross, props.vatRate);

  return (
    <div className="pricing-row optional-price-row">
      <label className="field">
        <span>{props.title}</span>
        <input value={props.name} onChange={(event) => props.setName(event.target.value)} placeholder="Bezeichnung" required={Number(props.gross) > 0} />
      </label>
      <label className="field">
        <span>Bruttopreis</span>
        <input type="number" min="0" step="0.01" value={props.gross} onChange={(event) => props.setGross(event.target.value)} />
      </label>
      <label className="field">
        <span>MwSt.</span>
        <select value={props.vatRate} onChange={(event) => props.setVatRate(Number(event.target.value))}>
          <option value={0}>0 %</option>
          <option value={7}>7 %</option>
          <option value={19}>19 %</option>
        </select>
      </label>
      <label className="field">
        <span>Leistung</span>
        <select value={props.providerType} onChange={(event) => props.setProviderType(event.target.value as ProviderType)}>
          <option value="internal">Intern</option>
          <option value="external">Extern</option>
        </select>
      </label>
      {props.providerType === "external" && (
        <label className="field">
          <span>Externer Anbieter</span>
          <input value={props.providerName} onChange={(event) => props.setProviderName(event.target.value)} required={Number(props.gross) > 0} />
        </label>
      )}
      <div className="pricing-result">
        <span>netto {formatMoney(component.net)} · MwSt. {formatMoney(component.vat)}</span>
        <strong>{formatMoney(component.gross)}</strong>
      </div>
    </div>
  );
}

export default function Performances({ onBack }: Props) {
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [hallPlanType, setHallPlanType] = useState<"hall_1" | "hall_2">("hall_1");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [venueName, setVenueName] = useState("");
  const [doorsTime, setDoorsTime] = useState("");
  const [salesStartAt, setSalesStartAt] = useState("");
  const [salesEndAt, setSalesEndAt] = useState("");
  const [publicationStatus, setPublicationStatus] = useState<PublicationStatus>("draft");
  const [seatingMode, setSeatingMode] = useState<SeatingMode>("assigned");
  const [capacity, setCapacity] = useState("");
  const [ticketPriceGross, setTicketPriceGross] = useState("0");
  const [ticketVatRate, setTicketVatRate] = useState(7);
  const [serviceVatRate, setServiceVatRate] = useState(19);
  const [postalShippingGross, setPostalShippingGross] = useState("0");
  const [postalShippingVatRate, setPostalShippingVatRate] = useState(19);
  const [foodName, setFoodName] = useState("");
  const [foodPriceGross, setFoodPriceGross] = useState("0");
  const [foodVatRate, setFoodVatRate] = useState(7);
  const [foodProviderType, setFoodProviderType] = useState<ProviderType>("internal");
  const [foodProviderName, setFoodProviderName] = useState("");
  const [drinkName, setDrinkName] = useState("");
  const [drinkPriceGross, setDrinkPriceGross] = useState("0");
  const [drinkVatRate, setDrinkVatRate] = useState(19);
  const [drinkProviderType, setDrinkProviderType] = useState<ProviderType>("internal");
  const [drinkProviderName, setDrinkProviderName] = useState("");
  const [additionalFeeName, setAdditionalFeeName] = useState("");
  const [additionalFeeGross, setAdditionalFeeGross] = useState("0");
  const [additionalFeeVatRate, setAdditionalFeeVatRate] = useState(19);
  const [additionalProviderType, setAdditionalProviderType] = useState<ProviderType>("internal");
  const [additionalProviderName, setAdditionalProviderName] = useState("");
  const [maxTicketsPerOrder, setMaxTicketsPerOrder] = useState("10");

  const ticketPrice = calculateGrossComponent(ticketPriceGross, ticketVatRate);
  const foodPrice = calculateGrossComponent(foodPriceGross, foodVatRate);
  const drinkPrice = calculateGrossComponent(drinkPriceGross, drinkVatRate);
  const additionalPrice = calculateGrossComponent(additionalFeeGross, additionalFeeVatRate);
  const subtotalGross = Math.round((ticketPrice.gross + foodPrice.gross + drinkPrice.gross + additionalPrice.gross) * 100) / 100;
  const serviceFeeGross = Math.round(subtotalGross * 0.1 * 100) / 100;
  const servicePrice = calculateGrossComponent(serviceFeeGross, serviceVatRate);
  const postalShippingPrice = calculateGrossComponent(postalShippingGross, postalShippingVatRate);
  const totalNet = ticketPrice.net + foodPrice.net + drinkPrice.net + additionalPrice.net + servicePrice.net;
  const totalVat = ticketPrice.vat + foodPrice.vat + drinkPrice.vat + additionalPrice.vat + servicePrice.vat;
  const totalGross = Math.round((subtotalGross + serviceFeeGross) * 100) / 100;

  const configuredPriceItems: PriceItem[] = [
    {
      category: "ticket",
      name: "Eintrittskarte",
      gross_amount: ticketPrice.gross,
      vat_rate: ticketVatRate,
      provider_type: "internal",
      provider_name: "",
    },
    ...(foodPrice.gross > 0
      ? [{ category: "food" as const, name: foodName.trim(), gross_amount: foodPrice.gross, vat_rate: foodVatRate, provider_type: foodProviderType, provider_name: foodProviderName.trim() }]
      : []),
    ...(drinkPrice.gross > 0
      ? [{ category: "drink" as const, name: drinkName.trim(), gross_amount: drinkPrice.gross, vat_rate: drinkVatRate, provider_type: drinkProviderType, provider_name: drinkProviderName.trim() }]
      : []),
    ...(additionalPrice.gross > 0
      ? [{ category: "other" as const, name: additionalFeeName.trim(), gross_amount: additionalPrice.gross, vat_rate: additionalFeeVatRate, provider_type: additionalProviderType, provider_name: additionalProviderName.trim() }]
      : []),
  ];

  async function loadPerformances() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/performances");
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `Vorstellungen konnten nicht geladen werden (HTTP ${response.status}).`,
        );
      }
      setPerformances(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Vorstellungen konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPerformances();
  }, []);

  function resetFields() {
    setTitle("");
    setDate("");
    setStartTime("");
    setHallPlanType("hall_1");
    setShortDescription("");
    setDescription("");
    setImageUrl("");
    setImageUploadError("");
    setVenueName("");
    setDoorsTime("");
    setSalesStartAt("");
    setSalesEndAt("");
    setPublicationStatus("draft");
    setSeatingMode("assigned");
    setCapacity("");
    setTicketPriceGross("0");
    setTicketVatRate(7);
    setServiceVatRate(19);
    setPostalShippingGross("0");
    setPostalShippingVatRate(19);
    setFoodName("");
    setFoodPriceGross("0");
    setFoodVatRate(7);
    setFoodProviderType("internal");
    setFoodProviderName("");
    setDrinkName("");
    setDrinkPriceGross("0");
    setDrinkVatRate(19);
    setDrinkProviderType("internal");
    setDrinkProviderName("");
    setAdditionalFeeName("");
    setAdditionalFeeGross("0");
    setAdditionalFeeVatRate(19);
    setAdditionalProviderType("internal");
    setAdditionalProviderName("");
    setMaxTicketsPerOrder("10");
  }

  function closeForm() {
    resetFields();
    setEditingId(null);
    setShowForm(false);
  }

  function startCreate() {
    resetFields();
    setEditingId(null);
    setShowForm(true);
    setError("");
  }

  function startEdit(performance: Performance) {
    setEditingId(performance.id);
    setTitle(performance.title);
    setDate(performance.performance_date);
    setStartTime(performance.start_time.slice(0, 5));
    setHallPlanType(performance.hall_plan_type === "hall_2" ? "hall_2" : "hall_1");
    setShortDescription(performance.short_description || "");
    setDescription(performance.description || "");
    setImageUrl(performance.image_url || "");
    setImageUploadError("");
    setVenueName(performance.venue_name || "");
    setDoorsTime(performance.doors_time?.slice(0, 5) || "");
    setSalesStartAt(toDatetimeLocal(performance.sales_start_at));
    setSalesEndAt(toDatetimeLocal(performance.sales_end_at));
    setPublicationStatus(performance.publication_status || "draft");
    setSeatingMode(performance.seating_mode || "assigned");
    setCapacity(performance.capacity?.toString() || "");
    const priceItems = performance.price_items || [];
    const ticketItem = priceItems.find((item) => item.category === "ticket");
    const foodItem = priceItems.find((item) => item.category === "food");
    const drinkItem = priceItems.find((item) => item.category === "drink");
    const otherItem = priceItems.find((item) => item.category === "other");
    const legacyTicketRate = performance.ticket_vat_rate ?? 0;
    const legacyTicketGross = performance.ticket_price_net != null
      ? Math.round(performance.ticket_price_net * (1 + legacyTicketRate / 100) * 100) / 100
      : performance.price_from ?? 0;
    const legacyAdditionalRate = performance.additional_fee_vat_rate ?? 19;
    const legacyAdditionalGross = performance.additional_fee_net != null
      ? Math.round(performance.additional_fee_net * (1 + legacyAdditionalRate / 100) * 100) / 100
      : 0;

    setTicketPriceGross((ticketItem?.gross_amount ?? legacyTicketGross).toString());
    setTicketVatRate(ticketItem?.vat_rate ?? legacyTicketRate);
    setServiceVatRate(performance.service_vat_rate ?? 19);
    setPostalShippingGross((performance.postal_shipping_gross ?? 0).toString());
    setPostalShippingVatRate(performance.postal_shipping_vat_rate ?? 19);
    setFoodName(foodItem?.name || "");
    setFoodPriceGross((foodItem?.gross_amount ?? 0).toString());
    setFoodVatRate(foodItem?.vat_rate ?? 7);
    setFoodProviderType(foodItem?.provider_type ?? "internal");
    setFoodProviderName(foodItem?.provider_name || "");
    setDrinkName(drinkItem?.name || "");
    setDrinkPriceGross((drinkItem?.gross_amount ?? 0).toString());
    setDrinkVatRate(drinkItem?.vat_rate ?? 19);
    setDrinkProviderType(drinkItem?.provider_type ?? "internal");
    setDrinkProviderName(drinkItem?.provider_name || "");
    setAdditionalFeeName(otherItem?.name || performance.additional_fee_name || "");
    setAdditionalFeeGross((otherItem?.gross_amount ?? legacyAdditionalGross).toString());
    setAdditionalFeeVatRate(otherItem?.vat_rate ?? legacyAdditionalRate);
    setAdditionalProviderType(otherItem?.provider_type ?? "internal");
    setAdditionalProviderName(otherItem?.provider_name || "");
    setMaxTicketsPerOrder((performance.max_tickets_per_order || 10).toString());
    setShowForm(true);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function uploadEventImage(file: File) {
    setImageUploadError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setImageUploadError("Bitte nur ein JPG-, PNG- oder WebP-Bild auswählen.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setImageUploadError("Das Bild darf höchstens 8 MB groß sein.");
      return;
    }

    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/admin/uploads/event-image", {
        method: "POST",
        headers: getActorHeaders(),
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || `Bild konnte nicht hochgeladen werden (HTTP ${response.status}).`);
      }
      setImageUrl(data.image_url);
    } catch (err) {
      setImageUploadError(err instanceof Error ? err.message : "Bild konnte nicht hochgeladen werden.");
    } finally {
      setUploadingImage(false);
    }
  }

  async function savePerformance(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const isEditing = editingId !== null;
      const response = await fetch(
        isEditing ? `/api/performances/${editingId}` : "/api/performances",
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", ...getActorHeaders() },
          body: JSON.stringify({
            title,
            performance_date: date,
            start_time: startTime,
            hall_plan_type: hallPlanType,
            short_description: shortDescription,
            description,
            image_url: imageUrl,
            venue_name: venueName,
            doors_time: doorsTime || null,
            sales_start_at: salesStartAt ? new Date(salesStartAt).toISOString() : null,
            sales_end_at: salesEndAt ? new Date(salesEndAt).toISOString() : null,
            publication_status: publicationStatus,
            seating_mode: seatingMode,
            capacity: seatingMode === "free" && capacity ? Number(capacity) : null,
            price_from: totalGross,
            ticket_price_net: ticketPrice.net,
            ticket_vat_rate: ticketVatRate,
            service_fee_net: servicePrice.net,
            service_vat_rate: serviceVatRate,
            additional_fee_name: additionalFeeName,
            additional_fee_net: additionalPrice.net,
            additional_fee_vat_rate: additionalFeeVatRate,
            price_items: configuredPriceItems,
            service_fee_percent: 10,
            postal_shipping_gross: postalShippingPrice.gross,
            postal_shipping_vat_rate: postalShippingVatRate,
            max_tickets_per_order: Number(maxTicketsPerOrder),
          }),
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `Vorstellung konnte nicht gespeichert werden (HTTP ${response.status}).`,
        );
      }
      closeForm();
      await loadPerformances();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Vorstellung konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deletePerformance(performance: Performance) {
    const loggedInUser = JSON.parse(
      localStorage.getItem("theater.loggedInUser") || "{}",
    );
    if (loggedInUser.role !== "admin") return;

    const confirmed = window.confirm(
      `Soll die Vorstellung „${performance.title}“ wirklich endgültig gelöscht werden?\n\nDieser Vorgang kann nicht rückgängig gemacht werden.`,
    );
    if (!confirmed) return;
    setError("");

    try {
      const response = await fetch(`/api/performances/${performance.id}`, {
        method: "DELETE",
        headers: getActorHeaders(),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `Vorstellung konnte nicht gelöscht werden (HTTP ${response.status}).`,
        );
      }
      setPerformances((current) =>
        current.filter((item) => item.id !== performance.id),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Vorstellung konnte nicht gelöscht werden.",
      );
    }
  }

  function formatDate(value: string) {
    return new Intl.DateTimeFormat("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00`));
  }

  const loggedInUser = JSON.parse(
    localStorage.getItem("theater.loggedInUser") || "{}",
  );
  const isAdmin = loggedInUser.role === "admin";

  return (
    <main className="performances-page">
      <div className="performances-shell">
        <header className="performances-header">
          <div>
            <span className="performances-eyebrow">Ticketshop-Verwaltung</span>
            <h1>Veranstaltungen</h1>
            <p>Events vorbereiten, prüfen und gezielt im lokalen Ticketshop anzeigen.</p>
          </div>
          <button type="button" className="button button-secondary" onClick={onBack}>
            Zurück
          </button>
        </header>

        <div className="test-notice">
          <strong>Lokaler Testbetrieb</strong>
          <span>Keine echten Zahlungen, E-Mails oder öffentlichen Verkäufe.</span>
        </div>

        <button
          type="button"
          className="button button-primary create-button"
          onClick={() => (showForm ? closeForm() : startCreate())}
        >
          {showForm ? "Formular schließen" : "+ Veranstaltung anlegen"}
        </button>

        {showForm && (
          <form className="performance-form" onSubmit={savePerformance}>
            <div className="form-heading">
              <div>
                <span className="step-label">Veranstaltungsdaten</span>
                <h2>{editingId === null ? "Neue Veranstaltung" : "Veranstaltung bearbeiten"}</h2>
              </div>
              <span className={`status-pill status-${publicationStatus}`}>
                {STATUS_LABELS[publicationStatus]}
              </span>
            </div>

            <section className="form-section">
              <h3>Termin und Ort</h3>
              <div className="form-grid">
                <label className="field field-wide">
                  <span>Titel *</span>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} required />
                </label>
                <label className="field">
                  <span>Datum *</span>
                  <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
                </label>
                <label className="field">
                  <span>Beginn *</span>
                  <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
                </label>
                <label className="field">
                  <span>Einlass</span>
                  <input type="time" value={doorsTime} onChange={(event) => setDoorsTime(event.target.value)} />
                </label>
                <label className="field field-wide">
                  <span>Veranstaltungsort {publicationStatus !== "draft" ? "*" : ""}</span>
                  <input
                    value={venueName}
                    onChange={(event) => setVenueName(event.target.value)}
                    placeholder="z. B. Theater am Stadtpark"
                    required={publicationStatus !== "draft"}
                  />
                </label>
              </div>
            </section>

            <section className="form-section">
              <h3>Darstellung im Ticketshop</h3>
              <div className="form-grid">
                <label className="field field-wide">
                  <span>Kurzbeschreibung</span>
                  <input
                    value={shortDescription}
                    onChange={(event) => setShortDescription(event.target.value)}
                    maxLength={180}
                    placeholder="Ein kurzer Satz für die Veranstaltungsübersicht"
                  />
                  <small>{shortDescription.length}/180 Zeichen</small>
                </label>
                <label className="field field-wide">
                  <span>Ausführliche Beschreibung</span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={6}
                    placeholder="Programm, Besetzung und wichtige Hinweise"
                  />
                </label>
                <div className="field field-wide event-image-upload">
                  <span>Veranstaltungsbild</span>
                  <label className={`image-dropzone ${uploadingImage ? "is-uploading" : ""}`}>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={uploadingImage}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadEventImage(file);
                        event.target.value = "";
                      }}
                    />
                    <strong>{uploadingImage ? "Bild wird hochgeladen …" : "Bild auswählen"}</strong>
                    <small>JPG, PNG oder WebP · maximal 8 MB</small>
                  </label>
                  {imageUploadError && <small className="image-upload-error">{imageUploadError}</small>}
                  {imageUrl && (
                    <div className="event-image-preview">
                      <img src={imageUrl} alt="Vorschau des Veranstaltungsbildes" />
                      <button type="button" className="button button-secondary" onClick={() => setImageUrl("")}>
                        Bild entfernen
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="form-section">
              <h3>Tickets und Veröffentlichung</h3>
              <div className="form-grid">
                <label className="field">
                  <span>Status *</span>
                  <select
                    value={publicationStatus}
                    onChange={(event) => setPublicationStatus(event.target.value as PublicationStatus)}
                  >
                    <option value="draft">Entwurf – nicht sichtbar</option>
                    <option value="published">Veröffentlicht – im Testshop sichtbar</option>
                    <option value="sold_out">Ausverkauft</option>
                    <option value="cancelled">Abgesagt</option>
                  </select>
                </label>
                <label className="field field-wide publication-datetime-field">
                  <span>Tickets veröffentlichen ab</span>
                  <input
                    type="datetime-local"
                    value={salesStartAt}
                    onChange={(event) => setSalesStartAt(event.target.value)}
                  />
                  <small>
                    Datum und Uhrzeit in Deutschland/Berlin. Bleibt das Feld leer,
                    wird die Veranstaltung beim Status „Veröffentlicht“ sofort im
                    Ticketshop sichtbar.
                  </small>
                  {salesStartAt && (
                    <button
                      type="button"
                      className="clear-publication-time"
                      onClick={() => setSalesStartAt("")}
                    >
                      Zeitpunkt entfernen und sofort veröffentlichen
                    </button>
                  )}
                </label>
                <label className="field">
                  <span>Platzwahl *</span>
                  <select value={seatingMode} onChange={(event) => setSeatingMode(event.target.value as SeatingMode)}>
                    <option value="assigned">Sitzplan – Gäste wählen ihre Plätze</option>
                    <option value="staff_assigned">Sitzplan – Plätze weisen wir zu</option>
                    <option value="free">Freie Platzwahl</option>
                  </select>
                </label>
                {seatingMode !== "free" ? (
                  <label className="field">
                    <span>Saalplan *</span>
                    <select value={hallPlanType} onChange={(event) => setHallPlanType(event.target.value as "hall_1" | "hall_2")}>
                      <option value="hall_1">Saalplan 1 – bestehender Saal</option>
                      <option value="hall_2">Saalplan 2 – Tischsaal</option>
                    </select>
                  </label>
                ) : (
                  <label className="field">
                    <span>Verfügbares Kontingent *</span>
                    <input type="number" min="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} required />
                  </label>
                )}
                {seatingMode === "staff_assigned" && (
                  <div className="seating-assignment-note field-wide">
                    <strong>Platzzuweisung durch das Theater</strong>
                    <span>
                      Gäste wählen im Ticketshop nur die Ticketanzahl. Die konkreten
                      Plätze weist ihr anschließend in der Buchungsverwaltung zu.
                    </span>
                  </div>
                )}
                <div className="pricing-editor field-wide">
                  <div className="pricing-editor-heading">
                    <div>
                      <strong>Preiszusammensetzung je Ticket</strong>
                      <span>Bruttopreise eingeben – enthaltene MwSt. und Endpreis werden automatisch berechnet.</span>
                    </div>
                    <strong className="pricing-total">Endpreis {formatMoney(totalGross)}</strong>
                  </div>

                  <div className="pricing-row">
                    <label className="field">
                      <span>Eintrittskarte brutto *</span>
                      <input type="number" min="0" step="0.01" value={ticketPriceGross} onChange={(event) => setTicketPriceGross(event.target.value)} required />
                    </label>
                    <label className="field">
                      <span>MwSt. Ticket *</span>
                      <select value={ticketVatRate} onChange={(event) => setTicketVatRate(Number(event.target.value))}>
                        <option value={0}>0 %</option>
                        <option value={7}>7 %</option>
                        <option value={19}>19 %</option>
                      </select>
                    </label>
                    <div className="provider-badge internal">Interne Leistung</div>
                    <div className="pricing-result">
                      <span>netto {formatMoney(ticketPrice.net)} · MwSt. {formatMoney(ticketPrice.vat)}</span>
                      <strong>{formatMoney(ticketPrice.gross)}</strong>
                    </div>
                  </div>

                  <OptionalPriceRow
                    title="Essen / Menü"
                    name={foodName}
                    setName={setFoodName}
                    gross={foodPriceGross}
                    setGross={setFoodPriceGross}
                    vatRate={foodVatRate}
                    setVatRate={setFoodVatRate}
                    providerType={foodProviderType}
                    setProviderType={setFoodProviderType}
                    providerName={foodProviderName}
                    setProviderName={setFoodProviderName}
                  />

                  <OptionalPriceRow
                    title="Getränke"
                    name={drinkName}
                    setName={setDrinkName}
                    gross={drinkPriceGross}
                    setGross={setDrinkPriceGross}
                    vatRate={drinkVatRate}
                    setVatRate={setDrinkVatRate}
                    providerType={drinkProviderType}
                    setProviderType={setDrinkProviderType}
                    providerName={drinkProviderName}
                    setProviderName={setDrinkProviderName}
                  />

                  <OptionalPriceRow
                    title="Sonstige Kosten"
                    name={additionalFeeName}
                    setName={setAdditionalFeeName}
                    gross={additionalFeeGross}
                    setGross={setAdditionalFeeGross}
                    vatRate={additionalFeeVatRate}
                    setVatRate={setAdditionalFeeVatRate}
                    providerType={additionalProviderType}
                    setProviderType={setAdditionalProviderType}
                    providerName={additionalProviderName}
                    setProviderName={setAdditionalProviderName}
                  />

                  <div className="pricing-row automatic-service-row">
                    <div className="automatic-service-copy">
                      <span>Servicepauschale</span>
                      <strong>10 % von {formatMoney(subtotalGross)}</strong>
                      <small>Wird immer automatisch berechnet.</small>
                    </div>
                    <label className="field">
                      <span>MwSt. Service</span>
                      <select value={serviceVatRate} onChange={(event) => setServiceVatRate(Number(event.target.value))}>
                        <option value={0}>0 %</option>
                        <option value={7}>7 %</option>
                        <option value={19}>19 %</option>
                      </select>
                    </label>
                    <div className="provider-badge external">Externe Leistung</div>
                    <div className="pricing-result">
                      <span>netto {formatMoney(servicePrice.net)} · MwSt. {formatMoney(servicePrice.vat)}</span>
                      <strong>{formatMoney(serviceFeeGross)}</strong>
                    </div>
                  </div>

                  <div className="pricing-summary">
                    <span>Zwischensumme <strong>{formatMoney(subtotalGross)}</strong></span>
                    <span>Servicepauschale <strong>{formatMoney(serviceFeeGross)}</strong></span>
                    <span>Nettosumme <strong>{formatMoney(totalNet)}</strong></span>
                    <span>MwSt. gesamt <strong>{formatMoney(totalVat)}</strong></span>
                    <span>Endpreis je Ticket <strong>{formatMoney(totalGross)}</strong></span>
                  </div>

                  <div className="pricing-row postal-shipping-row">
                    <div className="automatic-service-copy">
                      <span>Versandpauschale</span>
                      <strong>Optional je Bestellung</strong>
                      <small>Wird nur berechnet, wenn „Versandpauschale“ in der Rechnung aktiviert ist.</small>
                    </div>
                    <label className="field">
                      <span>Versand brutto</span>
                      <input type="number" min="0" step="0.01" value={postalShippingGross} onChange={(event) => setPostalShippingGross(event.target.value)} />
                    </label>
                    <label className="field">
                      <span>MwSt. Versand</span>
                      <select value={postalShippingVatRate} onChange={(event) => setPostalShippingVatRate(Number(event.target.value))}>
                        <option value={0}>0 %</option>
                        <option value={7}>7 %</option>
                        <option value={19}>19 %</option>
                      </select>
                    </label>
                    <div className="pricing-result">
                      <span>netto {formatMoney(postalShippingPrice.net)} · MwSt. {formatMoney(postalShippingPrice.vat)}</span>
                      <strong>{formatMoney(postalShippingPrice.gross)}</strong>
                    </div>
                  </div>
                </div>
                <label className="field">
                  <span>Max. Tickets je Bestellung *</span>
                  <input type="number" min="1" max="50" value={maxTicketsPerOrder} onChange={(event) => setMaxTicketsPerOrder(event.target.value)} required />
                </label>
                <label className="field">
                  <span>Ticketverkauf beenden am</span>
                  <input type="datetime-local" value={salesEndAt} onChange={(event) => setSalesEndAt(event.target.value)} />
                  <small>Optional. Bleibt das Feld leer, endet der Verkauf nicht automatisch.</small>
                </label>
              </div>
            </section>

            <div className="form-actions">
              <button type="submit" className="button button-primary" disabled={saving || uploadingImage}>
                {saving ? "Wird gespeichert …" : "Speichern"}
              </button>
              <button type="button" className="button button-secondary" onClick={closeForm}>
                Abbrechen
              </button>
            </div>
          </form>
        )}

        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <div className="empty-state">Vorstellungen werden geladen …</div>
        ) : performances.length === 0 ? (
          <div className="empty-state">
            <strong>Noch keine Veranstaltungen vorhanden.</strong>
            <span>Lege den ersten Entwurf an. Er ist zunächst nur hier sichtbar.</span>
          </div>
        ) : (
          <div className="performance-list">
            {performances.map((performance) => {
              const status = performance.publication_status || "draft";
              const isPublic = status !== "draft";
              const publicationTime = performance.sales_start_at
                ? new Date(performance.sales_start_at).getTime()
                : null;
              const isScheduled =
                publicationTime !== null && publicationTime > Date.now();
              const isVisibleInShop = isPublic && !isScheduled;
              const publicPath = performance.public_slug || String(performance.id);
              const eventDate = new Date(`${performance.performance_date}T12:00:00`);

              return (
                <article className="performance-card" key={performance.id}>
                  <div className="performance-card-date">
                    <span>{eventDate.toLocaleDateString("de-DE", { month: "short" })}</span>
                    <strong>{eventDate.getDate()}</strong>
                  </div>
                  <div className="performance-card-content">
                    <div className="performance-card-topline">
                      <span className={`status-pill status-${status}`}>
                        {status === "published" && isScheduled
                          ? "Veröffentlichung geplant"
                          : STATUS_LABELS[status]}
                      </span>
                      <span>{SEATING_LABELS[performance.seating_mode || "assigned"]}</span>
                    </div>
                    <h2>{performance.title}</h2>
                    <p>
                      {formatDate(performance.performance_date)} · {performance.start_time.slice(0, 5)} Uhr
                      {performance.venue_name ? ` · ${performance.venue_name}` : ""}
                    </p>
                    {status === "published" && (
                      <p className={`publication-information ${isScheduled ? "scheduled" : "visible"}`}>
                        {isScheduled
                          ? `Tickets werden am ${formatPublicationDateTime(performance.sales_start_at)} Uhr veröffentlicht.`
                          : "Tickets sind im Ticketshop veröffentlicht."}
                      </p>
                    )}
                    {performance.short_description && <p className="card-description">{performance.short_description}</p>}
                  </div>
                  <div className="performance-card-actions">
                    {isVisibleInShop && (
                      <a className="button button-ticketshop" href={`${TICKETSHOP_BASE}/events/${publicPath}`} target="_blank" rel="noreferrer">
                        Im Testshop öffnen
                      </a>
                    )}
                    {isPublic && isScheduled && (
                      <span className="scheduled-publication-note">
                        Noch nicht im Ticketshop sichtbar
                      </span>
                    )}
                    <button type="button" className="button button-secondary" onClick={() => startEdit(performance)}>
                      Bearbeiten
                    </button>
                    {isAdmin && (
                      <button type="button" className="button button-danger" onClick={() => deletePerformance(performance)}>
                        Löschen
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
