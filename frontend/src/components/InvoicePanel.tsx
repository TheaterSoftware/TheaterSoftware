import { useEffect, useMemo, useState, type ReactNode } from "react";
import "./InvoicePanel.css";

export type InvoiceBooking = {
  id: number;
  booking_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  street?: string;
  postal_code?: string;
  city?: string;
  ticket_count: number;
  ticket_price: number;
  service_fee: number;
  performanceId: number;
};

export type InvoicePerformance = {
  id: number;
  date: string;
  time: string;
  title: string;
  postal_shipping_gross?: number;
  postal_shipping_vat_rate?: number;
};

type TemplateItem = {
  description: string;
  source: "tickets" | "service" | "service_percent" | "fixed";
  tax_rate: number;
  quantity?: number;
  unit_gross?: number;
  percentage?: number;
  append_event_details?: boolean;
};

type TemplateData = {
  sender_line?: string;
  company_name?: string;
  tax_number?: string;
  processor?: string;
  iban?: string;
  bank_name?: string;
  payment_text?: string;
  reference_label?: string;
  thank_you_text?: string;
  exchange_text?: string;
  footer_lines?: string[];
  sequence_width?: number;
  items?: TemplateItem[];
  event_title?: string;
  event_date?: string;
  event_time?: string;
  [key: string]: unknown;
};

type InvoiceTemplate = {
  id: number;
  template_key: string;
  name: string;
  description: string;
  performance_id: number | null;
  number_prefix: string;
  number_suffix: string;
  number_sequence_start: number;
  default_tax_rate: number;
  template_data: TemplateData;
  is_active: boolean;
};

type InvoiceLine = {
  localId: string;
  description: string;
  quantity: number;
  unit_gross: number;
  tax_rate: number;
  templateSource?: TemplateItem["source"] | "shipping";
};

type StoredLine = Omit<InvoiceLine, "localId"> & {
  position_no: number;
  net_amount: number;
  tax_amount: number;
  gross_amount: number;
};

type StoredInvoice = {
  id?: number;
  invoice_id?: number;
  invoice_number: string;
  reference_number: string;
  booking_id: number;
  booking_number: string;
  invoice_date: string;
  payment_status?: string;
  net_amount: number;
  tax_amount: number;
  gross_amount: number;
  tax_breakdown: TaxGroup[];
  recipient_snapshot: Record<string, string>;
  template_snapshot: TemplateData;
  items: StoredLine[];
  notes?: string;
};

type TaxGroup = {
  tax_rate: number;
  net_amount: number;
  tax_amount: number;
  gross_amount: number;
};

type TemplateForm = {
  id: number | null;
  name: string;
  description: string;
  performance_id: number | "";
  number_prefix: string;
  number_suffix: string;
  number_sequence_start: number;
  default_tax_rate: number;
  sender_line: string;
  company_name: string;
  tax_number: string;
  iban: string;
  bank_name: string;
  payment_text: string;
  reference_label: string;
  thank_you_text: string;
  exchange_text: string;
  footer_lines: string;
  sequence_width: number;
  items: TemplateItem[];
};

type Props = {
  bookings: InvoiceBooking[];
  performances: InvoicePerformance[];
  initialBookingId?: number | null;
  initialView?: "invoice" | "templates";
  onClose: () => void;
  onInvoiceCreated?: (message: string) => void;
};

const TAX_RATES = [0, 7, 19];
const DELETE_CONFIRMATION = "ENDGÜLTIG LÖSCHEN";
const EXCHANGE_NOTICE = "Die Karten sind aus organisatorischen Gründen vom Umtausch ausgeschlossen!";
const THEATER_MASTER = {
  sender_line: "Boulevardtheater - Bahnhofstraße 11 - 67146 Deidesheim",
  company_name: "Boulevardtheater Deidesheim e. V.",
  tax_number: "3166802088",
  iban: "DE60 5469 1200 0113 5388 05",
  bank_name: "VR Bank Mittelhaardt eG",
  footer_lines: [
    "Boulevardtheater Deidesheim e. V. - Bahnhofstraße 11",
    "67146 Deidesheim - Ticket-Hotline: 06326-2558855 - www.boulevard-deidesheim.de",
    "Mail: info@boulevard-deidesheim.de",
  ],
} as const;

type LoggedInUser = {
  user_id?: number;
  username?: string;
  display_name?: string;
  role?: string;
};

const DEFAULT_FORM: TemplateForm = {
  id: null,
  name: "Dinnershow – Rechnungsvorlage",
  description: "Grundlayout für Rechnungen dieser Veranstaltung.",
  performance_id: "",
  number_prefix: "DWH",
  number_suffix: "10",
  number_sequence_start: 134,
  default_tax_rate: 7,
  sender_line: THEATER_MASTER.sender_line,
  company_name: THEATER_MASTER.company_name,
  tax_number: THEATER_MASTER.tax_number,
  iban: THEATER_MASTER.iban,
  bank_name: THEATER_MASTER.bank_name,
  payment_text: "Bitte überweisen Sie den Betrag direkt nach Erhalt der Rechnung auf unser Konto.",
  reference_label: "Verwendungszweck / Referenz Nr.",
  thank_you_text: "Vielen Dank und bis bald im Boulevardtheater!",
  exchange_text: EXCHANGE_NOTICE,
  footer_lines: THEATER_MASTER.footer_lines.join("\n"),
  sequence_width: 3,
  items: [
    { description: "Eintrittskarte", source: "tickets", tax_rate: 7, append_event_details: true },
    { description: "Servicepauschale", source: "service_percent", percentage: 10, tax_rate: 19 },
  ],
};

const LEGACY_TICKET_DESCRIPTION = "{{event_title}} am {{event_date}}";

const newForm = (): TemplateForm => ({
  ...DEFAULT_FORM,
  items: DEFAULT_FORM.items.map((item) => ({ ...item })),
});

function money(value: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("de-DE");
}

function berlinToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function calculateLine(line: InvoiceLine) {
  const gross = roundMoney(Number(line.quantity) * Number(line.unit_gross));
  const net = roundMoney(gross / (1 + Number(line.tax_rate) / 100));
  return { gross, net, tax: roundMoney(gross - net) };
}

function keepServiceItemLast(items: TemplateItem[]) {
  return [
    ...items.filter((item) => item.source !== "service_percent"),
    ...items.filter((item) => item.source === "service_percent"),
  ];
}

function refreshFixedServiceAmount(lines: InvoiceLine[]) {
  const serviceBaseGross = lines
    .filter((line) => ![
      "service_percent",
      "service",
      "shipping",
    ].includes(line.templateSource || ""))
    .reduce((sum, line) => sum + calculateLine(line).gross, 0);
  return lines.map((line) => line.templateSource === "service_percent"
    ? { ...line, quantity: 1, unit_gross: roundMoney(serviceBaseGross * 10 / 100), tax_rate: 19 }
    : line);
}

function insertBeforeServiceLine(lines: InvoiceLine[], newLine: InvoiceLine) {
  const result = [...lines];
  const serviceIndex = result.findIndex((line) => line.templateSource === "service_percent");
  if (serviceIndex < 0) result.push(newLine);
  else result.splice(serviceIndex, 0, newLine);
  return result;
}

function orderInvoiceLines(lines: InvoiceLine[]) {
  return [...lines].sort((first, second) => {
    const firstIsService = first.templateSource === "service_percent"
      || /^(Servicepauschale|Servicekosten\s*\(\s*10\s*%\s*\))/i.test(first.description.trim());
    const secondIsService = second.templateSource === "service_percent"
      || /^(Servicepauschale|Servicekosten\s*\(\s*10\s*%\s*\))/i.test(second.description.trim());
    if (firstIsService !== secondIsService) return firstIsService ? 1 : -1;
    return calculateLine(second).gross - calculateLine(first).gross;
  });
}

function getLoggedInUser(): LoggedInUser {
  try {
    return JSON.parse(localStorage.getItem("theater.loggedInUser") || "{}") as LoggedInUser;
  } catch {
    return {};
  }
}

function formatProcessorName(name?: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0].charAt(0).toUpperCase()}.${parts.at(-1)}`;
  return parts[0] || "—";
}

function authHeaders(json = false) {
  const user = getLoggedInUser();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "X-User-Id": user.user_id?.toString() || "",
    "X-User-Name": user.username || "",
  };
}

function readSnapshotData(snapshot?: TemplateData | null): TemplateData {
  if (!snapshot) return {};
  const nested = snapshot.template_data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...(nested as TemplateData), ...snapshot };
  }
  return snapshot;
}

function replaceTokens(text: string, booking: InvoiceBooking, performance: InvoicePerformance | null) {
  return text
    .replaceAll("{{event_title}}", performance?.title || "Veranstaltung")
    .replaceAll("{{event_date}}", formatDate(performance?.date))
    .replaceAll("{{booking_number}}", booking.booking_number)
    .replaceAll("{{customer_name}}", `${booking.first_name} ${booking.last_name}`.trim());
}

function resolveTemplateItemDescription(
  item: TemplateItem,
  booking: InvoiceBooking,
  performance: InvoicePerformance | null,
) {
  const description = replaceTokens(item.description, booking, performance).trim();
  const containsLegacyEventTokens = item.description.includes("{{event_title}}")
    || item.description.includes("{{event_date}}");
  if (item.source !== "tickets" || !item.append_event_details || containsLegacyEventTokens) {
    return description || "Rechnungsposition";
  }
  const eventTitle = performance?.title || "Veranstaltung";
  const eventDate = formatDate(performance?.date);
  return `${description || "Eintrittskarte"} – ${eventTitle} am ${eventDate}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function templateToForm(template: InvoiceTemplate): TemplateForm {
  const data = template.template_data || {};
  return {
    id: template.id,
    name: template.name,
    description: template.description || "",
    performance_id: template.performance_id ?? "",
    number_prefix: template.number_prefix || "RE",
    number_suffix: template.number_suffix || "",
    number_sequence_start: template.number_sequence_start || 1,
    default_tax_rate: template.default_tax_rate,
    sender_line: THEATER_MASTER.sender_line,
    company_name: THEATER_MASTER.company_name,
    tax_number: THEATER_MASTER.tax_number,
    iban: THEATER_MASTER.iban,
    bank_name: THEATER_MASTER.bank_name,
    payment_text: String(data.payment_text || ""),
    reference_label: String(data.reference_label || "Verwendungszweck / Referenz Nr."),
    thank_you_text: String(data.thank_you_text || ""),
    exchange_text: EXCHANGE_NOTICE,
    footer_lines: THEATER_MASTER.footer_lines.join("\n"),
    sequence_width: Number(data.sequence_width || 3),
    items: Array.isArray(data.items) && data.items.length
      ? keepServiceItemLast(data.items.map((storedItem) => {
        const item = storedItem.source === "service_percent"
          ? { ...storedItem, description: "Servicepauschale", percentage: 10, tax_rate: 19 }
          : { ...storedItem };
        if (item.source === "tickets" && item.description.trim() === LEGACY_TICKET_DESCRIPTION) {
          return { ...item, description: "Eintrittskarte", append_event_details: true };
        }
        return item;
      }))
      : DEFAULT_FORM.items.map((item) => ({ ...item })),
  };
}

function formPayload(form: TemplateForm) {
  return {
    name: form.name,
    description: form.description,
    performance_id: form.performance_id === "" ? null : form.performance_id,
    number_prefix: form.number_prefix,
    number_suffix: form.number_suffix,
    number_sequence_start: Number(form.number_sequence_start),
    default_tax_rate: Number(form.default_tax_rate),
    template_data: {
      sender_line: THEATER_MASTER.sender_line,
      company_name: THEATER_MASTER.company_name,
      tax_number: THEATER_MASTER.tax_number,
      iban: THEATER_MASTER.iban,
      bank_name: THEATER_MASTER.bank_name,
      payment_text: form.payment_text,
      reference_label: form.reference_label,
      thank_you_text: form.thank_you_text,
      exchange_text: EXCHANGE_NOTICE,
      footer_lines: [...THEATER_MASTER.footer_lines],
      sequence_width: Number(form.sequence_width),
      items: keepServiceItemLast(form.items).map((item) => item.source === "service_percent"
        ? { ...item, description: "Servicepauschale", percentage: 10, tax_rate: 19 }
        : item),
    },
  };
}

export default function InvoicePanel({
  bookings,
  performances,
  initialBookingId = null,
  initialView = "invoice",
  onClose,
  onInvoiceCreated,
}: Props) {
  const loggedInUser = useMemo(() => getLoggedInUser(), []);
  const isAdmin = String(loggedInUser.role || "").toLowerCase() === "admin";
  const automaticProcessor = useMemo(
    () => formatProcessorName(loggedInUser.display_name || loggedInUser.username),
    [loggedInUser.display_name, loggedInUser.username],
  );
  const [tab, setTab] = useState<"invoice" | "templates">(initialView);
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [bookingId, setBookingId] = useState<number | "">(initialBookingId ?? "");
  const [templateId, setTemplateId] = useState<number | "">("");
  const [invoiceDate, setInvoiceDate] = useState(berlinToday());
  const [processor, setProcessor] = useState(automaticProcessor);
  const [notes, setNotes] = useState("");
  const [postShipping, setPostShipping] = useState(false);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [created, setCreated] = useState<StoredInvoice | null>(null);
  const [form, setForm] = useState<TemplateForm>(newForm());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<InvoiceTemplate | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  const booking = bookings.find((item) => item.id === bookingId) ?? null;
  const performance = performances.find((item) => item.id === booking?.performanceId) ?? null;
  const template = templates.find((item) => item.id === templateId) ?? null;

  const filteredBookings = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return bookings;
    return bookings.filter((item) => `${item.booking_number} ${item.first_name} ${item.last_name}`.toLowerCase().includes(term));
  }, [bookings, search]);

  const totals = useMemo(() => {
    const groups = new Map<number, TaxGroup>();
    lines.forEach((line) => {
      const sum = calculateLine(line);
      const group = groups.get(line.tax_rate) || { tax_rate: line.tax_rate, net_amount: 0, tax_amount: 0, gross_amount: 0 };
      group.net_amount = roundMoney(group.net_amount + sum.net);
      group.tax_amount = roundMoney(group.tax_amount + sum.tax);
      group.gross_amount = roundMoney(group.gross_amount + sum.gross);
      groups.set(line.tax_rate, group);
    });
    const taxGroups = [...groups.values()].sort((a, b) => a.tax_rate - b.tax_rate);
    return {
      net: roundMoney(taxGroups.reduce((sum, item) => sum + item.net_amount, 0)),
      tax: roundMoney(taxGroups.reduce((sum, item) => sum + item.tax_amount, 0)),
      gross: roundMoney(taxGroups.reduce((sum, item) => sum + item.gross_amount, 0)),
      groups: taxGroups,
    };
  }, [lines]);
  const orderedLines = useMemo(
    () => orderInvoiceLines(lines),
    [lines],
  );

  async function loadTemplates(performanceId?: number, inactive = false) {
    const params = new URLSearchParams();
    if (performanceId) params.set("performance_id", String(performanceId));
    if (inactive) params.set("include_inactive", "true");
    const response = await fetch(`/api/invoice-templates?${params}`, {
      headers: authHeaders(),
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.detail || "Rechnungsvorlagen konnten nicht geladen werden.");
    const result = Array.isArray(data) ? data as InvoiceTemplate[] : [];
    setTemplates(result);
    return result;
  }

  function applyTemplate(selected: InvoiceTemplate, selectedBooking: InvoiceBooking) {
    const selectedPerformance = performances.find((item) => item.id === selectedBooking.performanceId) ?? null;
    const result: InvoiceLine[] = [];
    const ticketTemplateItem = (selected.template_data.items || []).find((item) => item.source === "tickets");
    const ticketUnitGross = ticketTemplateItem?.unit_gross === undefined
      ? Number(selectedBooking.ticket_price || 0)
      : Number(ticketTemplateItem.unit_gross || 0);
    const ticketGrossForService = Number(selectedBooking.ticket_count || 0) * ticketUnitGross;
    (selected.template_data.items || []).forEach((item, index) => {
      let quantity = Number(item.quantity ?? 1);
      let unitGross = Number(item.unit_gross ?? 0);
      if (item.source === "tickets") {
        quantity = Number(selectedBooking.ticket_count || 0);
        unitGross = item.unit_gross === undefined
          ? Number(selectedBooking.ticket_price || 0)
          : Number(item.unit_gross || 0);
      } else if (item.source === "service_percent") {
        quantity = 1;
        unitGross = roundMoney(ticketGrossForService * 10 / 100);
      } else if (item.source === "service") {
        unitGross = Number(selectedBooking.service_fee || 0);
        if (unitGross <= 0) return;
      }
      result.push({
        localId: `${Date.now()}-${index}`,
        description: item.source === "service_percent"
          ? "Servicepauschale"
          : resolveTemplateItemDescription(item, selectedBooking, selectedPerformance),
        quantity,
        unit_gross: unitGross,
        tax_rate: Number(item.tax_rate ?? selected.default_tax_rate),
        templateSource: item.source,
      });
    });
    if (!result.length) {
      result.push({
        localId: `${Date.now()}-ticket`,
        description: `${selectedPerformance?.title || "Eintrittskarten"} am ${formatDate(selectedPerformance?.date)}`,
        quantity: selectedBooking.ticket_count,
        unit_gross: selectedBooking.ticket_price,
        tax_rate: selected.default_tax_rate,
        templateSource: "tickets",
      });
    }
    setLines(refreshFixedServiceAmount(result));
  }

  useEffect(() => {
    if (tab !== "templates") return;
    setLoading(true);
    loadTemplates(undefined, true)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Fehler beim Laden."))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    if (!booking || tab !== "invoice") return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setMessage("");
    setCreated(null);
    setPostShipping(false);
    setInvoiceDate(berlinToday());
    setProcessor(automaticProcessor);
    Promise.all([
      loadTemplates(booking.performanceId),
      fetch(`/api/invoices?booking_id=${booking.id}`).then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.detail || "Rechnungen konnten nicht geladen werden.");
        return Array.isArray(data) ? data as StoredInvoice[] : [];
      }),
    ]).then(([available, invoices]) => {
      if (cancelled) return;
      if (invoices.length) {
        const existing = invoices[0];
        const existingData = readSnapshotData(existing.template_snapshot);
        setCreated(existing);
        setInvoiceDate(existing.invoice_date);
        setProcessor(String(existingData.processor || automaticProcessor));
        setLines(existing.items.map((item, index) => ({
          localId: `stored-${index}`,
          description: item.description,
          quantity: item.quantity,
          unit_gross: item.unit_gross,
          tax_rate: item.tax_rate,
        })));
      } else if (available.length) {
        setTemplateId(available[0].id);
        applyTemplate(available[0], booking);
      } else {
        setTemplateId("");
        setLines([]);
      }
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Fehler beim Laden.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [bookingId, tab, automaticProcessor]);

  function updateLine(id: string, patch: Partial<InvoiceLine>) {
    setLines((current) => refreshFixedServiceAmount(
      current.map((line) => line.localId === id ? { ...line, ...patch } : line),
    ));
  }

  function addLine() {
    setLines((current) => insertBeforeServiceLine(current, {
      localId: `new-${Date.now()}`,
      description: "Sonstige Kosten",
      quantity: 1,
      unit_gross: 0,
      tax_rate: template?.default_tax_rate ?? 19,
      templateSource: "fixed",
    }));
  }

  function togglePostShipping(enabled: boolean) {
    setPostShipping(enabled);
    if (enabled) {
      setLines((current) => insertBeforeServiceLine(
        current.filter((line) => !line.localId.startsWith("shipping-")),
        {
          localId: `shipping-${Date.now()}`,
          description: "Versandpauschale",
          quantity: 1,
          unit_gross: Number(performance?.postal_shipping_gross || 0),
          tax_rate: Number(performance?.postal_shipping_vat_rate ?? 19),
          templateSource: "shipping",
        },
      ));
    } else {
      setLines((current) => current.filter((line) => !line.localId.startsWith("shipping-")));
    }
  }

  async function createInvoice() {
    if (!booking || !templateId || !lines.length) {
      setError("Bitte Buchung, Vorlage und mindestens eine Position auswählen.");
      return;
    }
    if (lines.some((line) => !line.description.trim() || line.quantity <= 0 || line.unit_gross < 0)) {
      setError("Bitte alle Rechnungspositionen vollständig und korrekt ausfüllen.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          booking_id: booking.id,
          template_id: templateId,
          invoice_date: invoiceDate,
          processor,
          notes,
          items: orderedLines.map(({ description, quantity, unit_gross, tax_rate }) => ({ description, quantity, unit_gross, tax_rate })),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || "Rechnung konnte nicht erstellt werden.");
      setCreated(data as StoredInvoice);
      const text = `Rechnung ${data.invoice_number} wurde endgültig gespeichert.`;
      setMessage(text);
      onInvoiceCreated?.(text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rechnung konnte nicht erstellt werden.");
    } finally {
      setSaving(false);
    }
  }

  async function saveTemplate() {
    if (!form.name.trim()) {
      setError("Bitte zuerst einen Namen für die Rechnungsvorlage eingeben.");
      return;
    }
    if (!form.number_prefix.trim()) {
      setError("Bitte ein Kürzel für die Rechnungsnummer eingeben.");
      return;
    }
    if (!form.items.length) {
      setError("Die Vorlage benötigt mindestens eine Rechnungsposition.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(form.id ? `/api/invoice-templates/${form.id}` : "/api/invoice-templates", {
        method: form.id ? "PUT" : "POST",
        headers: authHeaders(true),
        body: JSON.stringify(formPayload(form)),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || "Vorlage konnte nicht gespeichert werden.");
      const savedId = Number(form.id || data?.id);
      if (!savedId) throw new Error("Der Server hat keine gültige Vorlagen-ID zurückgegeben.");
      const refreshed = await loadTemplates(undefined, true);
      const saved = refreshed.find((item) => item.id === savedId);
      if (!saved) throw new Error("Die Vorlage wurde gesendet, konnte danach aber nicht erneut geladen werden.");
      setForm(templateToForm(saved));
      setTemplateId(saved.id);
      setMessage(`Rechnungsvorlage „${saved.name}“ wurde gespeichert und erneut geprüft.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Vorlage konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateTemplate(selected: InvoiceTemplate) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/invoice-templates/${selected.id}/duplicate`, { method: "POST", headers: authHeaders() });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || "Vorlage konnte nicht dupliziert werden.");
      const refreshed = await loadTemplates(undefined, true);
      const copy = refreshed.find((item) => item.id === data.id);
      if (copy) setForm(templateToForm(copy));
      setMessage("Vorlage wurde dupliziert. Die Kopie kann jetzt angepasst werden.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Vorlage konnte nicht dupliziert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate() {
    if (!deleteTarget || deleteConfirmation !== DELETE_CONFIRMATION) return;
    setDeleting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/invoice-templates/${deleteTarget.id}/delete`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || "Vorlage konnte nicht gelöscht werden.");
      const deletedName = deleteTarget.name;
      const deletedId = deleteTarget.id;
      const refreshed = await loadTemplates(undefined, true);
      if (refreshed.some((item) => item.id === deletedId)) {
        throw new Error("Die Vorlage wurde gesendet, ist nach dem Neuladen aber noch vorhanden.");
      }
      if (templateId === deletedId) setTemplateId("");
      setForm(newForm());
      setDeleteTarget(null);
      setDeleteConfirmation("");
      setMessage(`Rechnungsvorlage „${deletedName}“ wurde endgültig gelöscht.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Vorlage konnte nicht gelöscht werden.");
    } finally {
      setDeleting(false);
    }
  }

  function updateTemplateItem(index: number, patch: Partial<TemplateItem>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  function changeTemplateItemSource(index: number, source: TemplateItem["source"]) {
    updateTemplateItem(
      index,
      source === "service_percent"
        ? { source, percentage: 10, tax_rate: 19 }
        : source === "tickets"
          ? { source, append_event_details: true }
        : { source },
    );
  }

  function moveTemplateItem(index: number, direction: -1 | 1) {
    setForm((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.items.length) return current;
      if (
        current.items[index].source === "service_percent"
        || current.items[targetIndex].source === "service_percent"
      ) return current;
      const items = [...current.items];
      [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
      return { ...current, items };
    });
    setMessage("");
  }

  const templateData: TemplateData = created
    ? readSnapshotData(created.template_snapshot)
    : {
        ...(template?.template_data || {}),
        ...THEATER_MASTER,
        footer_lines: [...THEATER_MASTER.footer_lines],
        exchange_text: EXCHANGE_NOTICE,
        processor,
      };
  const year = String(new Date(performance?.date || invoiceDate).getFullYear()).slice(-2);
  const numberPreview = created?.invoice_number || (template
    ? `${template.number_prefix}-${year}-${String(template.number_sequence_start).padStart(Number(template.template_data.sequence_width || 3), "0")}${template.number_suffix ? `-${template.number_suffix}` : ""}`
    : "—");
  const taxGroups = created?.tax_breakdown || totals.groups;
  const grossTotal = created?.gross_amount ?? totals.gross;

  function printInvoice() {
    if (!booking) return;
    const data = templateData;
    const recipient = created?.recipient_snapshot || booking;
    const printableLines = orderedLines.map((line, index) => {
      const sum = calculateLine(line);
      return { ...line, position_no: index + 1, net_amount: sum.net, tax_amount: sum.tax, gross_amount: sum.gross };
    });
    const popup = window.open("", "_blank", "width=1000,height=900");
    if (!popup) {
      setError("Das Druckfenster wurde blockiert. Bitte Pop-ups erlauben.");
      return;
    }
    const rows = printableLines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.quantity.toLocaleString("de-DE"))}</td><td>${escapeHtml(money(line.unit_gross))}</td><td>${escapeHtml(line.tax_rate)} %</td><td>${escapeHtml(money(line.gross_amount))}</td></tr>`).join("");
    const taxes = taxGroups.map((group) => `<tr><td>Enthaltene MwSt. ${escapeHtml(group.tax_rate)} %</td><td>${escapeHtml(money(group.net_amount))} netto</td><td>${escapeHtml(money(group.tax_amount))}</td></tr>`).join("");
    const footer = (Array.isArray(data.footer_lines) ? data.footer_lines : []).map((line) => `<div>${escapeHtml(line)}</div>`).join("");
    popup.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Rechnung ${escapeHtml(numberPreview)}</title><style>@page{size:A4;margin:12mm 15mm}*{box-sizing:border-box}body{font-family:Arial;color:#111;font-size:13px;margin:0}.page{max-width:790px;min-height:1060px;margin:auto;position:relative;padding-bottom:100px}.logo{width:330px;max-height:72px;object-fit:contain;object-position:left;margin-bottom:14px}.sender{font-size:10px;text-decoration:underline;margin-bottom:18px}.head{display:grid;grid-template-columns:1fr 280px;gap:40px;min-height:170px}.address{font-size:15px;line-height:1.5}.meta{display:grid;grid-template-columns:112px 1fr;align-content:start;gap:5px 8px;font-size:11px}.title{font-size:23px;font-weight:700;margin:20px 0}table{width:100%;border-collapse:collapse}th,td{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.sum{width:400px;margin:14px 0 0 auto}.sum td{border:0}.grand{font-size:17px;font-weight:700;border-top:2px solid #111}.payment{margin-top:30px;line-height:1.5}.bank{display:grid;grid-template-columns:160px 1fr;gap:5px 15px;margin:15px 0}.thanks{margin-top:25px;font-size:15px}.exchange{margin-top:24px;font-weight:700;font-style:italic}.footer{position:absolute;bottom:0;left:0;right:0;border-top:1px solid #aaa;padding-top:9px;text-align:center;font-size:10px;line-height:1.45}.bar{text-align:right}.bar button{padding:10px 18px;background:#111;color:#fff;border:0;border-radius:7px}@media print{.bar{display:none}}</style></head><body><div class="page"><div class="bar"><button onclick="window.print()">Drucken / als PDF speichern</button></div><img class="logo" src="/invoice-logo.png"><div class="sender">${escapeHtml(data.sender_line)}</div><div class="head"><div class="address">${escapeHtml(recipient.first_name)} ${escapeHtml(recipient.last_name)}<br>${escapeHtml(recipient.street)}<br>${escapeHtml(recipient.postal_code)} ${escapeHtml(recipient.city)}</div><div class="meta"><strong>Rechnungsdatum</strong><span>${escapeHtml(formatDate(created?.invoice_date || invoiceDate))}</span><strong>Bearbeiter</strong><span>${escapeHtml(data.processor)}</span><strong>Steuernummer</strong><span>${escapeHtml(data.tax_number)}</span></div></div><div class="title">Rechnung Nr. ${escapeHtml(numberPreview)}</div><table><thead><tr><th>Bezeichnung</th><th>Menge</th><th>Einzelpreis</th><th>MwSt.</th><th>Gesamt</th></tr></thead><tbody>${rows}</tbody></table><table class="sum">${taxes}<tr class="grand"><td colspan="2">Gesamtbetrag</td><td>${escapeHtml(money(grossTotal))}</td></tr></table><div class="payment">${escapeHtml(data.payment_text)}</div><div class="bank"><strong>Kontoinhaber</strong><span>${escapeHtml(data.company_name)}</span><strong>IBAN</strong><span>${escapeHtml(data.iban)}</span><strong>Bank</strong><span>${escapeHtml(data.bank_name)}</span><strong>${escapeHtml(data.reference_label)}</strong><span>${escapeHtml(created?.reference_number || numberPreview)}</span></div><div class="thanks">${escapeHtml(data.thank_you_text)}</div><div class="exchange">${escapeHtml(data.exchange_text)}</div><div class="footer">${footer}</div></div></body></html>`);
    popup.document.close();
  }

  return <div className="invoice-v2-overlay" role="dialog" aria-modal="true">
    <div className="invoice-v2-shell">
      <header className="invoice-v2-header">
        <div><span>RECHNUNGSZENTRALE</span><h2>{tab === "invoice" ? "Rechnung erstellen" : "Rechnungsvorlagen"}</h2><p>Eventvorlagen, Steuerzeilen und eindeutige Rechnungsnummern.</p></div>
        <button type="button" onClick={onClose}>Schließen</button>
      </header>
      <nav className="invoice-v2-tabs">
        <button className={tab === "invoice" ? "active" : ""} onClick={() => setTab("invoice")}>Rechnung erstellen</button>
        <button className={tab === "templates" ? "active" : ""} onClick={() => setTab("templates")}>Vorlagen verwalten</button>
      </nav>
      {error && <div className="invoice-v2-alert error">{error}</div>}
      {message && <div className="invoice-v2-alert success">{message}</div>}

      {tab === "invoice" ? <div className="invoice-v2-workspace">
        <section className="invoice-v2-controls">
          <SectionTitle number="1" title="Buchung auswählen" extra={created ? <strong className="invoice-v2-final">FINAL GESPEICHERT</strong> : null} />
          <label>Suche<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name oder Buchungsnummer" /></label>
          <label>Buchung<select value={bookingId} onChange={(event) => setBookingId(event.target.value ? Number(event.target.value) : "")}><option value="">Bitte auswählen</option>{filteredBookings.map((item) => <option key={item.id} value={item.id}>{item.booking_number} · {item.first_name} {item.last_name}</option>)}</select></label>
          {booking && <div className="invoice-v2-customer"><strong>{booking.first_name} {booking.last_name}</strong><span>{booking.street || "Keine Straße hinterlegt"}</span><span>{booking.postal_code} {booking.city}</span><small>{performance?.title} · {formatDate(performance?.date)}</small></div>}

          <SectionTitle number="2" title="Vorlage und Datum" />
          {created ? <><div className="invoice-v2-final-notice"><strong>Diese Rechnung wurde bereits endgültig erstellt.</strong><span>Die Rechnungsdaten sind deshalb gesperrt. Für eine andere Vorlage bitte eine Buchung ohne fertige Rechnung auswählen.</span></div><label>Verwendete Vorlage<input readOnly value={String(templateData.template_name || "Mit der Rechnung fest gespeichert")} /></label></> : <label>Eventvorlage<select disabled={!booking} value={templateId} onChange={(event) => { const id = Number(event.target.value); setTemplateId(id); const selected = templates.find((item) => item.id === id); if (selected && booking) applyTemplate(selected, booking); }}><option value="">Bitte auswählen</option>{templates.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}{item.performance_id ? " · Eventbezogen" : " · Allgemein"}</option>)}</select></label>}
          {!templates.length && booking && !loading && <div className="invoice-v2-hint">Für dieses Event gibt es noch keine aktive Vorlage. Öffne „Vorlagen verwalten“.</div>}
          <div className="invoice-v2-grid">
            <label>Rechnungsdatum<input type="date" disabled={Boolean(created)} value={created?.invoice_date || invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></label>
            <label>Bearbeiter<input disabled={Boolean(created) || !isAdmin} value={created ? String(templateData.processor || "—") : processor} onChange={(event) => setProcessor(event.target.value)} /><small>{isAdmin ? "Als Admin kannst du den automatisch ermittelten Namen ändern." : "Automatisch aus der angemeldeten Person übernommen."}</small></label>
          </div>
          <label className="invoice-v2-shipping-choice"><span><input type="checkbox" disabled={Boolean(created) || !booking} checked={created ? created.items.some((item) => /^(Versandpauschale|Ticketversand per Post|Postversand)/i.test(item.description)) : postShipping} onChange={(event) => togglePostShipping(event.target.checked)} /> Versandpauschale</span><small>{performance ? `${money(Number(performance.postal_shipping_gross || 0))} brutto · ${Number(performance.postal_shipping_vat_rate ?? 19)} % MwSt. · aus der Veranstaltung übernommen` : "Zuerst eine Buchung auswählen."}</small></label>

          <SectionTitle number="3" title="Rechnungspositionen" extra={<button disabled={Boolean(created)} onClick={addLine}>+ Sonstige Kosten</button>} />
          <div className="invoice-v2-lines">{lines.map((line, index) => {
            const sum = calculateLine(line);
            const serviceLocked = line.templateSource === "service_percent";
            return <div className="invoice-v2-line" key={line.localId}><b>{index + 1}</b><label className="wide">Bezeichnung<input disabled={Boolean(created)} value={line.description} onChange={(event) => updateLine(line.localId, { description: event.target.value })} /></label><label>Menge<input disabled={Boolean(created) || serviceLocked} type="number" min="1" step="1" inputMode="numeric" value={line.quantity} onChange={(event) => updateLine(line.localId, { quantity: Math.max(1, Math.round(Number(event.target.value) || 1)) })} /></label><label>Brutto je Stück<input disabled={Boolean(created) || serviceLocked} type="number" min="0" step="0.01" value={line.unit_gross} onChange={(event) => updateLine(line.localId, { unit_gross: Number(event.target.value) })} /></label><label>MwSt.<select disabled={Boolean(created) || serviceLocked} value={line.tax_rate} onChange={(event) => updateLine(line.localId, { tax_rate: Number(event.target.value) })}>{TAX_RATES.map((rate) => <option key={rate} value={rate}>{rate} %</option>)}</select></label><div className="invoice-v2-line-total"><span>Brutto</span><strong>{money(sum.gross)}</strong><small>{money(sum.net)} netto</small></div>{!created && !serviceLocked && <button className="invoice-v2-remove" onClick={() => setLines((current) => refreshFixedServiceAmount(current.filter((item) => item.localId !== line.localId)))}>×</button>}</div>;
          })}</div>
          <label>Interne Notiz<textarea rows={2} disabled={Boolean(created)} value={created?.notes || notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <div className="invoice-v2-actions"><button className="secondary" disabled={!booking} onClick={printInvoice}>Vorschau / Drucken</button>{!created && <button className="primary" disabled={saving || loading || !booking || !templateId} onClick={createInvoice}>{saving ? "Wird gespeichert …" : "Rechnung endgültig erstellen"}</button>}</div>
        </section>

        <section className="invoice-v2-preview"><div className="invoice-v2-paper">
          <img src="/invoice-logo.png" alt="Boulevardtheater" />
          <div className="invoice-v2-sender">{String(templateData.sender_line || "")}</div>
          <div className="invoice-v2-paper-head"><div>{booking ? <>{booking.first_name} {booking.last_name}<br />{booking.street}<br />{booking.postal_code} {booking.city}</> : "Empfänger auswählen"}</div><dl><dt>Rechnungsdatum</dt><dd>{formatDate(created?.invoice_date || invoiceDate)}</dd><dt>Bearbeiter</dt><dd>{String(templateData.processor || "—")}</dd><dt>Steuernummer</dt><dd>{String(templateData.tax_number || "—")}</dd></dl></div>
          <h1>Rechnung Nr. {numberPreview}</h1>
          {!created && <div className="invoice-v2-number-note">Vorschau – die wirklich nächste freie Nummer wird erst beim Speichern vergeben.</div>}
          <table><thead><tr><th>Bezeichnung</th><th>Menge</th><th>MwSt.</th><th>Gesamt</th></tr></thead><tbody>{orderedLines.map((line) => <tr key={line.localId}><td>{line.description}</td><td>{line.quantity.toLocaleString("de-DE")}</td><td>{line.tax_rate} %</td><td>{money(calculateLine(line).gross)}</td></tr>)}</tbody></table>
          <div className="invoice-v2-totals">{taxGroups.map((group) => <div key={group.tax_rate}><span>Enthaltene MwSt. {group.tax_rate} %</span><span>{money(group.tax_amount)}</span></div>)}<div className="grand"><strong>Gesamtbetrag</strong><strong>{money(grossTotal)}</strong></div></div>
          <p>{String(templateData.payment_text || "")}</p>
          <div className="invoice-v2-bank"><strong>Kontoinhaber</strong><span>{String(templateData.company_name || "")}</span><strong>IBAN</strong><span>{String(templateData.iban || "")}</span><strong>Bank</strong><span>{String(templateData.bank_name || "")}</span><strong>{String(templateData.reference_label || "Referenz")}</strong><span>{created?.reference_number || numberPreview}</span></div>
          <p className="invoice-v2-thanks">{String(templateData.thank_you_text || "")}</p><p className="invoice-v2-exchange">{String(templateData.exchange_text || "")}</p>
          <footer>{(Array.isArray(templateData.footer_lines) ? templateData.footer_lines : []).map((line, index) => <div key={index}>{line}</div>)}</footer>
        </div></section>
      </div> : <div className="invoice-v2-template-workspace">
        <aside className="invoice-v2-template-list"><button className="invoice-v2-new" onClick={() => setForm(newForm())}>+ Neue Vorlage</button>{loading && <p>Lade Vorlagen …</p>}{templates.map((item) => <button key={item.id} className={form.id === item.id ? "selected" : ""} onClick={() => setForm(templateToForm(item))}><strong>{item.name}</strong><span>{item.performance_id ? performances.find((performanceItem) => performanceItem.id === item.performance_id)?.title || "Event" : "Alle Events"}</span><small>{item.number_prefix}-JJ-…{item.number_suffix ? `-${item.number_suffix}` : ""} · {item.is_active ? "Aktiv" : "Inaktiv"}</small></button>)}</aside>
        <section className="invoice-v2-template-editor">
          <div className="invoice-v2-editor-title"><div><h3>{form.id ? "Vorlage bearbeiten" : "Neue Vorlage"}</h3><p>Die verwendete Vorlage wird bei jeder fertigen Rechnung unveränderlich mitgespeichert.</p></div>{form.id && <div className="invoice-v2-editor-buttons"><button onClick={() => { const selected = templates.find((item) => item.id === form.id); if (selected) void duplicateTemplate(selected); }}>Vorlage duplizieren</button>{isAdmin && <button className="danger" onClick={() => { const selected = templates.find((item) => item.id === form.id); if (selected) { setDeleteTarget(selected); setDeleteConfirmation(""); } }}>Vorlage löschen</button>}</div>}</div>
          <div className="invoice-v2-form-grid"><label>Vorlagenname<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Event-Zuordnung<select value={form.performance_id} onChange={(event) => setForm({ ...form, performance_id: event.target.value ? Number(event.target.value) : "" })}><option value="">Allgemein – alle Events</option>{performances.map((item) => <option key={item.id} value={item.id}>{formatDate(item.date)} · {item.title}</option>)}</select></label><label>Standard-MwSt. für neue Positionen<select value={form.default_tax_rate} onChange={(event) => setForm({ ...form, default_tax_rate: Number(event.target.value) })}>{TAX_RATES.map((rate) => <option key={rate} value={rate}>{rate} %</option>)}</select></label><label>Stellen der laufenden Nummer<select value={form.sequence_width} onChange={(event) => setForm({ ...form, sequence_width: Number(event.target.value) })}><option value={3}>3 Stellen (134)</option><option value={4}>4 Stellen (0134)</option><option value={5}>5 Stellen (00134)</option></select></label><label className="full">Interne Beschreibung<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>
          <h4>Rechnungsnummer</h4><div className="invoice-v2-number-grid"><label>Kürzel<input value={form.number_prefix} onChange={(event) => setForm({ ...form, number_prefix: event.target.value })} /></label><span>– JJ –</span><label>Mindestnummer<input type="number" min="1" value={form.number_sequence_start} onChange={(event) => setForm({ ...form, number_sequence_start: Number(event.target.value) })} /></label><label>Endung<input value={form.number_suffix} onChange={(event) => setForm({ ...form, number_suffix: event.target.value })} /></label></div><div className="invoice-v2-hint">Die laufende Nummer wird global und transaktionssicher geführt. Sie kann niemals zurückspringen oder doppelt vergeben werden.</div>
          <h4>Absender und Zahlung</h4><div className="invoice-v2-hint">Absender, Steuernummer, IBAN, Bank und Fußzeile sind feste Theaterdaten. Der Bearbeiter wird bei jeder Rechnung automatisch aus der angemeldeten Person übernommen.</div><div className="invoice-v2-form-grid invoice-v2-master-data"><label className="full">Absenderzeile<input readOnly value={form.sender_line} /></label><label>Firmen-/Kontoinhaber<input readOnly value={form.company_name} /></label><label>Steuernummer<input readOnly value={form.tax_number} /></label><label>IBAN<input readOnly value={form.iban} /></label><label>Bank<input readOnly value={form.bank_name} /></label><label>Referenz-Bezeichnung<input value={form.reference_label} onChange={(event) => setForm({ ...form, reference_label: event.target.value })} /></label><label className="full">Zahlungshinweis<textarea rows={2} value={form.payment_text} onChange={(event) => setForm({ ...form, payment_text: event.target.value })} /></label></div>
          <h4>Standardpositionen und Steuer</h4>
          <div className="invoice-v2-template-items">
            {form.items.map((item, index) => <div className="invoice-v2-template-item" key={index}>
              <b>{index + 1}</b>
              <label>Quelle<select disabled={item.source === "service_percent"} value={item.source} onChange={(event) => changeTemplateItemSource(index, event.target.value as TemplateItem["source"])}><option value="tickets">Ticketdaten</option><option value="service_percent" disabled={item.source !== "service_percent"}>Servicepauschale</option><option value="service">Hinterlegte Servicepauschale</option><option value="fixed">Fester/Sonstiger Posten</option></select></label>
              <label className="wide">Bezeichnung auf der Rechnung<input value={item.description} onChange={(event) => updateTemplateItem(index, { description: event.target.value })} />{item.source === "tickets" && <span className="invoice-v2-auto-event"><input type="checkbox" checked={Boolean(item.append_event_details)} onChange={(event) => updateTemplateItem(index, { append_event_details: event.target.checked })} /> Eventname und Datum automatisch ergänzen</span>}</label>
              <label>MwSt.<select disabled={item.source === "service_percent"} value={item.source === "service_percent" ? 19 : item.tax_rate} onChange={(event) => updateTemplateItem(index, { tax_rate: Number(event.target.value) })}>{TAX_RATES.map((rate) => <option key={rate} value={rate}>{rate} %</option>)}</select></label>
              <div className={`invoice-v2-template-values${item.source === "fixed" ? " split" : ""}`}>
                {item.source === "tickets" && <label>Ticketpreis brutto<input type="number" min="0" step="0.01" placeholder="Preis aus Buchung" value={item.unit_gross ?? ""} onChange={(event) => updateTemplateItem(index, { unit_gross: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>}
                {item.source === "service_percent" && <label>Fester Anteil<input readOnly value="10 %" /></label>}
                {item.source === "service" && <label>Betrag<input readOnly value="Aus Buchung" /></label>}
                {item.source === "fixed" && <><label>Menge<input type="number" min="1" step="1" inputMode="numeric" value={item.quantity ?? 1} onChange={(event) => updateTemplateItem(index, { quantity: Math.max(1, Math.round(Number(event.target.value) || 1)) })} /></label><label>Brutto<input type="number" min="0" step="0.01" value={item.unit_gross ?? 0} onChange={(event) => updateTemplateItem(index, { unit_gross: Number(event.target.value) })} /></label></>}
              </div>
              <div className="invoice-v2-template-item-actions"><button type="button" title={item.source === "service_percent" ? "Die Servicepauschale bleibt immer ganz unten." : "Position nach oben"} disabled={index === 0 || item.source === "service_percent"} onClick={() => moveTemplateItem(index, -1)}>↑</button><button type="button" title={item.source === "service_percent" || form.items[index + 1]?.source === "service_percent" ? "Die Servicepauschale bleibt immer ganz unten." : "Position nach unten"} disabled={index === form.items.length - 1 || item.source === "service_percent" || form.items[index + 1]?.source === "service_percent"} onClick={() => moveTemplateItem(index, 1)}>↓</button><button type="button" className="delete" title={item.source === "service_percent" ? "Die feste Servicepauschale kann nicht entfernt werden." : "Position entfernen"} disabled={item.source === "service_percent"} onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>×</button></div>
            </div>)}
            <button onClick={() => setForm((current) => { const items = [...current.items]; const serviceIndex = items.findIndex((item) => item.source === "service_percent"); const nextItem: TemplateItem = { description: "Sonstige Kosten", source: "fixed", tax_rate: current.default_tax_rate, quantity: 1, unit_gross: 0 }; if (serviceIndex < 0) items.push(nextItem); else items.splice(serviceIndex, 0, nextItem); return { ...current, items }; })}>+ Standardposition ergänzen</button>
          </div>
          <div className="invoice-v2-hint">Bei „Ticketdaten“ kann ein eigener Ticketpreis gespeichert werden; bleibt das Feld leer, wird der Preis aus der Buchung verwendet. Eventname und Veranstaltungsdatum werden auf Wunsch automatisch ergänzt. Die Servicepauschale beträgt 10 % der Summe aller abrechenbaren Positionen; Versandpauschale und Servicepauschale zählen nicht erneut zur Berechnungsgrundlage. Auf der Rechnung stehen die teuersten Positionen oben und die Servicepauschale bleibt ganz unten.</div>
          <h4>Abschluss und Fußzeile</h4><div className="invoice-v2-form-grid"><label className="full">Dankestext<input value={form.thank_you_text} onChange={(event) => setForm({ ...form, thank_you_text: event.target.value })} /></label><label className="full">Fester Umtauschhinweis<input readOnly value={form.exchange_text} /></label><label className="full">Feste Fußzeilen<textarea readOnly rows={4} value={form.footer_lines} /></label></div>
          <div className="invoice-v2-actions"><button className="primary" disabled={saving} onClick={saveTemplate}>{saving ? "Speichert …" : "Vorlage speichern"}</button></div>
        </section>
      </div>}
      {deleteTarget && <div className="invoice-v2-delete-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !deleting) setDeleteTarget(null); }}><section className="invoice-v2-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="invoice-delete-title"><span>ENDGÜLTIGE AKTION</span><h3 id="invoice-delete-title">Vorlage „{deleteTarget.name}“ löschen?</h3><p>Die Vorlage wird dauerhaft entfernt. Bereits final gespeicherte Rechnungen bleiben unverändert erhalten.</p><label>Bitte exakt <strong>{DELETE_CONFIRMATION}</strong> eingeben<input autoFocus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label><div><button className="secondary" disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteConfirmation(""); }}>Abbrechen</button><button className="danger" disabled={deleting || deleteConfirmation !== DELETE_CONFIRMATION} onClick={() => void deleteTemplate()}>{deleting ? "Wird gelöscht …" : "Vorlage endgültig löschen"}</button></div></section></div>}
    </div>
  </div>;
}

function SectionTitle({ number, title, extra }: { number: string; title: string; extra?: ReactNode }) {
  return <div className="invoice-v2-section-title"><div><span>{number}</span><h3>{title}</h3></div>{extra}</div>;
}
