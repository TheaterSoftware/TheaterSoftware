import { useEffect, useMemo, useState, type ReactNode } from "react";
import html2canvas from "html2canvas";
import "./InvoicePanel.css";

type InvoicePriceItem = {
  category: "ticket" | "food" | "drink" | "other";
  name: string;
  gross_amount: number;
  vat_rate: number;
};

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
  additional_fee?: number;
  additional_items?: InvoicePriceItem[];
  shipping_fee?: number;
  performanceId: number;
};

export type InvoicePerformance = {
  id: number;
  date: string;
  time: string;
  title: string;
  venue_name?: string;
  service_fee_percent?: number;
  price_breakdown?: {
    service_fee_percent?: number;
  };
  price_items?: InvoicePriceItem[];
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
  service_calculation?: "percentage" | "amount";
  show_on_invoice?: boolean;
  append_event_details?: boolean;
};

type TemplateData = {
  sender_line?: string;
  company_name?: string;
  tax_number?: string;
  processor?: string;
  iban?: string;
  bank_name?: string;
  venue_text?: string;
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
  servicePercentage?: number;
  serviceCalculation?: "percentage" | "amount";
  taxLabel?: string;
};

type TicketSplitRow = {
  category: "ticket" | "food" | "drink";
  name: string;
  gross: number;
  net: number;
  tax: number;
  vatRate: number;
  configured: boolean;
};

type TicketSplit = {
  rows: TicketSplitRow[];
  gross: number;
  net: number;
  tax: number;
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
  voucher_amount?: number;
  amount_due?: number;
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
  venue_text: string;
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
  number_suffix: "",
  number_sequence_start: 1,
  default_tax_rate: 7,
  sender_line: THEATER_MASTER.sender_line,
  company_name: THEATER_MASTER.company_name,
  tax_number: THEATER_MASTER.tax_number,
  iban: THEATER_MASTER.iban,
  bank_name: THEATER_MASTER.bank_name,
  venue_text: "",
  payment_text: "Bitte überweisen Sie den Betrag direkt nach Erhalt der Rechnung auf unser Konto.",
  reference_label: "Verwendungszweck / Referenz Nr.",
  thank_you_text: "Vielen Dank und bis bald im Boulevardtheater!",
  exchange_text: EXCHANGE_NOTICE,
  footer_lines: THEATER_MASTER.footer_lines.join("\n"),
  sequence_width: 3,
  items: [
    { description: "Eintrittskarte", source: "tickets", tax_rate: 7, append_event_details: true },
    {
      description: "Servicepauschale",
      source: "service_percent",
      percentage: 3,
      service_calculation: "percentage",
      show_on_invoice: true,
      tax_rate: 19,
    },
  ],
};

const LEGACY_TICKET_DESCRIPTION = "{{event_title}} am {{event_date}}";
const LEGACY_VENUE_EXAMPLE = [
  "Plopsaland Deutschland",
  "Holiday-Park-Str. 1-5",
  "67454 Haßloch",
].join("\n");

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

function calculateTicketSplit(priceItems?: InvoicePriceItem[]): TicketSplit | null {
  const configuredItems = Array.isArray(priceItems) ? priceItems : [];
  const defaults = [
    ["ticket", "Eintrittskarte"],
    ["food", "Essen / Menü"],
    ["drink", "Getränke"],
  ] as const;
  const rows = defaults.map(([category, defaultName]) => {
    const item = configuredItems.find((candidate) => candidate.category === category);
    const gross = roundMoney(Math.max(0, Number(item?.gross_amount) || 0));
    const vatRate = Number(item?.vat_rate) || 0;
    const net = roundMoney(gross / (1 + vatRate / 100));
    return {
      category,
      name: item?.name?.trim() || defaultName,
      gross,
      net,
      tax: roundMoney(gross - net),
      vatRate,
      configured: Boolean(item),
    };
  });
  const gross = roundMoney(rows.reduce((sum, row) => sum + row.gross, 0));
  if (gross <= 0) return null;
  return {
    rows,
    gross,
    net: roundMoney(rows.reduce((sum, row) => sum + row.net, 0)),
    tax: roundMoney(rows.reduce((sum, row) => sum + row.tax, 0)),
  };
}

function combineTicketComponentsForFront(
  lines: InvoiceLine[],
  split: TicketSplit | null,
  ticketCount: number,
  description: string,
) {
  if (!split) return lines;
  const directTicketIndex = lines.findIndex((line) => (
    line.templateSource === "tickets"
    && roundMoney(line.unit_gross) === split.gross
  ));
  if (directTicketIndex >= 0) {
    return lines.map((line, index) => index === directTicketIndex
      ? {
          ...line,
          description,
          tax_rate: 0,
          taxLabel: "siehe Seite 2",
        }
      : line);
  }
  const componentNames = new Set(
    split.rows
      .filter((row) => row.configured && row.gross > 0)
      .map((row) => row.name.trim().toLocaleLowerCase("de-DE")),
  );
  if (!componentNames.size) return lines;
  const matchingIndexes = lines
    .map((line, index) => (
      componentNames.has(line.description.trim().toLocaleLowerCase("de-DE"))
        ? index
        : -1
    ))
    .filter((index) => index >= 0);
  if (matchingIndexes.length < componentNames.size) return lines;

  const firstIndex = Math.min(...matchingIndexes);
  const hiddenIndexes = new Set(matchingIndexes);
  const combined: InvoiceLine = {
    localId: "combined-ticket-front",
    description,
    quantity: Math.max(1, ticketCount),
    unit_gross: split.gross,
    tax_rate: 0,
    taxLabel: "siehe Seite 2",
    templateSource: "tickets",
  };
  const result: InvoiceLine[] = [];
  lines.forEach((line, index) => {
    if (index === firstIndex) result.push(combined);
    if (!hiddenIndexes.has(index)) result.push(line);
  });
  return result;
}

function calculateInvoiceTotals(
  lines: InvoiceLine[],
  ticketSplit: TicketSplit | null = null,
) {
  const groups = new Map<number, TaxGroup>();
  const addAmount = (taxRate: number, grossAmount: number) => {
    const gross = roundMoney(grossAmount);
    const net = roundMoney(gross / (1 + taxRate / 100));
    const tax = roundMoney(gross - net);
    const group = groups.get(taxRate) || {
      tax_rate: taxRate,
      net_amount: 0,
      tax_amount: 0,
      gross_amount: 0,
    };
    group.net_amount = roundMoney(group.net_amount + net);
    group.tax_amount = roundMoney(group.tax_amount + tax);
    group.gross_amount = roundMoney(group.gross_amount + gross);
    groups.set(taxRate, group);
  };

  lines.forEach((line) => {
    if (
      ticketSplit
      && line.templateSource === "tickets"
      && roundMoney(line.unit_gross) === ticketSplit.gross
    ) {
      ticketSplit.rows
        .filter((row) => row.gross > 0)
        .forEach((row) => addAmount(
          row.vatRate,
          row.gross * Number(line.quantity),
        ));
      return;
    }
    const sum = calculateLine(line);
    addAmount(line.tax_rate, sum.gross);
  });

  const taxGroups = [...groups.values()].sort((a, b) => a.tax_rate - b.tax_rate);
  return {
    net: roundMoney(taxGroups.reduce((sum, item) => sum + item.net_amount, 0)),
    tax: roundMoney(taxGroups.reduce((sum, item) => sum + item.tax_amount, 0)),
    gross: roundMoney(taxGroups.reduce((sum, item) => sum + item.gross_amount, 0)),
    groups: taxGroups,
  };
}

function invoiceEventDatePart(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return match ? `${match[3]}${match[2]}` : "TTMM";
}

function invoiceNumberExample(
  prefix: string,
  performanceDate?: string,
  sequenceWidth = 3,
) {
  const normalizedPrefix = String(prefix || "RE")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "") || "RE";
  const width = Math.max(1, Math.min(Number(sequenceWidth || 3), 8));
  return `${normalizedPrefix}-${invoiceEventDatePart(performanceDate)}-${String(1).padStart(width, "0")}`;
}

function normalizeServicePercentage(value: unknown) {
  const percentage = Number(value);
  if (!Number.isFinite(percentage)) return 3;
  return Math.min(100, Math.max(0, percentage));
}

function normalizeServiceAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return roundMoney(Math.max(0, amount));
}

function normalizeServiceCalculation(value: unknown) {
  return value === "amount" ? "amount" as const : "percentage" as const;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("de-DE");
}

function combineBytes(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function createA4Pdf(
  pages: Array<{ jpegDataUrl: string; imageWidth: number; imageHeight: number }>,
) {
  if (!pages.length) throw new Error("Die PDF-Grafik konnte nicht erstellt werden.");
  const encoder = new TextEncoder();
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n% Generated by TheaterSoftware\n")];
  const offsets = [0];
  let byteLength = chunks[0].length;

  const append = (chunk: Uint8Array) => {
    chunks.push(chunk);
    byteLength += chunk.length;
  };
  const appendText = (value: string) => append(encoder.encode(value));
  const beginObject = (number: number) => {
    offsets[number] = byteLength;
    appendText(`${number} 0 obj\n`);
  };

  beginObject(1);
  appendText("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  beginObject(2);
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 3);
  appendText(`<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, index) => {
    const encodedImage = page.jpegDataUrl.split(",")[1];
    if (!encodedImage) throw new Error("Die PDF-Grafik konnte nicht erstellt werden.");
    const binaryImage = atob(encodedImage);
    const imageBytes = Uint8Array.from(binaryImage, (character) => character.charCodeAt(0));
    const pageObject = 3 + index * 3;
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const imageName = `Im${index}`;
    const contentBytes = encoder.encode(
      `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${imageName} Do\nQ\n`,
    );

    beginObject(pageObject);
    appendText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`);
    beginObject(contentObject);
    appendText(`<< /Length ${contentBytes.length} >>\nstream\n`);
    append(contentBytes);
    appendText("endstream\nendobj\n");
    beginObject(imageObject);
    appendText(`<< /Type /XObject /Subtype /Image /Width ${page.imageWidth} /Height ${page.imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`);
    append(imageBytes);
    appendText("\nendstream\nendobj\n");
  });

  const crossReferenceOffset = byteLength;
  const objectCount = 2 + pages.length * 3;
  appendText(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let number = 1; number <= objectCount; number += 1) {
    appendText(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  appendText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF`);

  const bytes = combineBytes(chunks);
  return new Blob([bytes.buffer], { type: "application/pdf" });
}

async function downloadInvoicePopupAsPdf(popup: Window, fileName: string) {
  const sourcePages = Array.from(
    popup.document.querySelectorAll<HTMLElement>(".page"),
  );
  if (!sourcePages.length) throw new Error("Die Rechnungsvorschau wurde nicht gefunden.");
  const sourceWidth = Math.round(180 * 96 / 25.4);
  const renderedPages: Array<{
    jpegDataUrl: string;
    imageWidth: number;
    imageHeight: number;
  }> = [];

  for (const sourcePage of sourcePages) {
    const page = sourcePage.cloneNode(true) as HTMLElement;
    page.querySelector(".bar")?.remove();
    page.style.width = `${sourceWidth}px`;
    page.style.maxWidth = "none";
    page.style.minHeight = "272mm";
    page.style.margin = "0";
    page.style.background = "#fff";
    const measurement = popup.document.createElement("div");
    measurement.style.cssText = `position:fixed;left:-10000px;top:0;width:${sourceWidth}px;background:#fff;pointer-events:none;`;
    measurement.appendChild(page);
    popup.document.body.appendChild(measurement);

    try {
      const sourceHeight = Math.ceil(Math.max(page.scrollHeight, page.getBoundingClientRect().height));
      const renderedPage = await html2canvas(page, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
        width: sourceWidth,
        height: sourceHeight,
        windowWidth: sourceWidth,
        windowHeight: sourceHeight,
        scrollX: 0,
        scrollY: 0,
      });
      const canvas = document.createElement("canvas");
      canvas.width = 1240;
      canvas.height = 1754;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Die PDF-Zeichenfläche ist nicht verfügbar.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const marginX = Math.round(canvas.width * 15 / 210);
      const marginY = Math.round(canvas.height * 12 / 297);
      const scale = Math.min(
        (canvas.width - 2 * marginX) / sourceWidth,
        (canvas.height - 2 * marginY) / sourceHeight,
      );
      const width = sourceWidth * scale;
      const height = sourceHeight * scale;
      context.drawImage(renderedPage, (canvas.width - width) / 2, marginY, width, height);
      renderedPages.push({
        jpegDataUrl: canvas.toDataURL("image/jpeg", 0.96),
        imageWidth: canvas.width,
        imageHeight: canvas.height,
      });
    } finally {
      measurement.remove();
    }
  }

  const pdf = createA4Pdf(renderedPages);
  const pdfUrl = URL.createObjectURL(pdf);
  const link = document.createElement("a");
  link.href = pdfUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 1_000);
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
    ...items.filter((item) => !["service", "service_percent"].includes(item.source)),
    ...items.filter((item) => ["service", "service_percent"].includes(item.source)),
  ];
}

function normalizeTemplateItems(items: TemplateItem[]) {
  const normalized = items.map((storedItem) => storedItem.source === "service_percent" || storedItem.source === "service"
    ? {
        ...storedItem,
        source: "service_percent" as const,
        description: "Servicepauschale",
        percentage: normalizeServicePercentage(storedItem.percentage),
        unit_gross: normalizeServiceAmount(storedItem.unit_gross),
        service_calculation: normalizeServiceCalculation(storedItem.service_calculation),
        show_on_invoice: storedItem.show_on_invoice !== false,
        tax_rate: 19,
      }
    : { ...storedItem });
  const serviceIndex = normalized.findIndex((item) => item.source === "service_percent");
  const legacyFixedIndex = normalized.findIndex((item) => (
    item.source === "fixed"
    && /^Servicepauschale$/i.test(item.description.trim())
  ));
  if (serviceIndex >= 0 && legacyFixedIndex >= 0) {
    const serviceItem = normalized[serviceIndex];
    const legacyItem = normalized[legacyFixedIndex];
    if (
      normalizeServiceCalculation(serviceItem.service_calculation) === "percentage"
      && normalizeServicePercentage(serviceItem.percentage) <= 0
    ) {
      normalized[serviceIndex] = {
        ...serviceItem,
        service_calculation: "amount",
        unit_gross: normalizeServiceAmount(
          Number(legacyItem.quantity ?? 1) * Number(legacyItem.unit_gross ?? 0),
        ),
        show_on_invoice: true,
      };
    }
    normalized.splice(legacyFixedIndex, 1);
  }
  return keepServiceItemLast(normalized);
}

function refreshFixedServiceAmount(lines: InvoiceLine[]) {
  const serviceBaseGross = lines
    .filter((line) => ![
      "service_percent",
      "service",
    ].includes(line.templateSource || ""))
    .reduce((sum, line) => sum + calculateLine(line).gross, 0);
  return lines.map((line) => {
    if (!["service", "service_percent"].includes(line.templateSource || "")) return line;
    const percentage = normalizeServicePercentage(line.servicePercentage);
    if (line.serviceCalculation === "amount") {
      const unitGross = roundMoney(Math.max(0, Number(line.unit_gross) || 0));
      return {
        ...line,
        description: "Servicepauschale",
        quantity: 1,
        unit_gross: unitGross,
        tax_rate: 19,
        servicePercentage: serviceBaseGross > 0
          ? Math.round((unitGross / serviceBaseGross) * 10000) / 100
          : percentage,
        serviceCalculation: "amount" as const,
        templateSource: "service_percent" as const,
      };
    }
    return {
      ...line,
      description: "Servicepauschale",
      quantity: 1,
      unit_gross: roundMoney(serviceBaseGross * percentage / 100),
      tax_rate: 19,
      servicePercentage: percentage,
      serviceCalculation: "percentage" as const,
      templateSource: "service_percent" as const,
    };
  });
}

function insertBeforeServiceLine(lines: InvoiceLine[], newLine: InvoiceLine) {
  const result = [...lines];
  const serviceIndex = result.findIndex((line) => ["service", "service_percent"].includes(line.templateSource || ""));
  if (serviceIndex < 0) result.push(newLine);
  else result.splice(serviceIndex, 0, newLine);
  return result;
}

function isServiceLine(line: Pick<InvoiceLine, "description" | "templateSource">) {
  return ["service", "service_percent"].includes(line.templateSource || "")
    || /^(Servicepauschale|Servicekosten(?:\s*\(\s*\d+(?:[.,]\d+)?\s*%\s*\))?)/i.test(line.description.trim());
}

function orderInvoiceLines(lines: InvoiceLine[]) {
  return [...lines].sort((first, second) => {
    const firstIsTicket = first.templateSource === "tickets";
    const secondIsTicket = second.templateSource === "tickets";
    if (firstIsTicket !== secondIsTicket) return firstIsTicket ? -1 : 1;
    const firstIsService = isServiceLine(first);
    const secondIsService = isServiceLine(second);
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

function normalizeVenueText(value: unknown) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function resolveTemplateVenueText(
  storedVenue: unknown,
  performanceVenue?: unknown,
) {
  const stored = normalizeVenueText(storedVenue);
  const fromPerformance = normalizeVenueText(performanceVenue);

  if (fromPerformance && (!stored || stored === LEGACY_VENUE_EXAMPLE)) {
    return fromPerformance;
  }
  return stored === LEGACY_VENUE_EXAMPLE ? "" : stored;
}

function templateToForm(
  template: InvoiceTemplate,
  performance?: InvoicePerformance | null,
): TemplateForm {
  const data = template.template_data || {};
  return {
    id: template.id,
    name: template.name,
    description: template.description || "",
    performance_id: template.performance_id ?? "",
    number_prefix: template.number_prefix || "RE",
    number_suffix: "",
    number_sequence_start: 1,
    default_tax_rate: template.default_tax_rate,
    sender_line: THEATER_MASTER.sender_line,
    company_name: THEATER_MASTER.company_name,
    tax_number: THEATER_MASTER.tax_number,
    iban: THEATER_MASTER.iban,
    bank_name: THEATER_MASTER.bank_name,
    venue_text: resolveTemplateVenueText(
      data.venue_text,
      performance?.venue_name,
    ),
    payment_text: String(data.payment_text || ""),
    reference_label: String(data.reference_label || "Verwendungszweck / Referenz Nr."),
    thank_you_text: String(data.thank_you_text || ""),
    exchange_text: EXCHANGE_NOTICE,
    footer_lines: THEATER_MASTER.footer_lines.join("\n"),
    sequence_width: 3,
    items: Array.isArray(data.items) && data.items.length
      ? normalizeTemplateItems(data.items).map((item) => {
        if (item.source === "tickets" && item.description.trim() === LEGACY_TICKET_DESCRIPTION) {
          return { ...item, description: "Eintrittskarte", append_event_details: true };
        }
        return item;
      })
      : DEFAULT_FORM.items.map((item) => ({ ...item })),
  };
}

function formPayload(form: TemplateForm) {
  return {
    name: form.name,
    description: form.description,
    performance_id: form.performance_id === "" ? null : form.performance_id,
    number_prefix: form.number_prefix,
    number_suffix: "",
    number_sequence_start: 1,
    default_tax_rate: Number(form.default_tax_rate),
    template_data: {
      sender_line: THEATER_MASTER.sender_line,
      company_name: THEATER_MASTER.company_name,
      tax_number: THEATER_MASTER.tax_number,
      iban: THEATER_MASTER.iban,
      bank_name: THEATER_MASTER.bank_name,
      venue_text: form.venue_text,
      payment_text: form.payment_text,
      reference_label: form.reference_label,
      thank_you_text: form.thank_you_text,
      exchange_text: EXCHANGE_NOTICE,
      footer_lines: [...THEATER_MASTER.footer_lines],
      sequence_width: 3,
      items: normalizeTemplateItems(form.items),
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
  const [voucherAmount, setVoucherAmount] = useState(0);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [created, setCreated] = useState<StoredInvoice | null>(null);
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState("");
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

  const totals = useMemo(() => calculateInvoiceTotals(lines), [lines]);
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
    const eventServicePercentage = normalizeServicePercentage(
      selectedPerformance?.service_fee_percent
        ?? selectedPerformance?.price_breakdown?.service_fee_percent
        ?? 0,
    );
    const result: InvoiceLine[] = [];
    normalizeTemplateItems(selected.template_data.items || []).forEach((item, index) => {
      let quantity = Number(item.quantity ?? 1);
      let unitGross = Number(item.unit_gross ?? 0);
      if (item.source === "tickets") {
        quantity = Number(selectedBooking.ticket_count || 0);
        unitGross = item.unit_gross === undefined
          ? Number(selectedBooking.ticket_price || 0)
          : Number(item.unit_gross || 0);
      } else if (item.source === "service_percent") {
        if (item.show_on_invoice === false) return;
        quantity = 1;
        unitGross = normalizeServiceCalculation(item.service_calculation) === "amount"
          ? normalizeServiceAmount(item.unit_gross)
          : 0;
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
        tax_rate: item.source === "service_percent" ? 19 : Number(item.tax_rate ?? selected.default_tax_rate),
        templateSource: item.source,
        servicePercentage: item.source === "service_percent"
          ? eventServicePercentage
          : undefined,
        serviceCalculation: item.source === "service_percent"
          ? normalizeServiceCalculation(item.service_calculation)
          : undefined,
      });
    });
    (
      selectedBooking.additional_items?.length
        ? selectedBooking.additional_items
        : selectedPerformance?.price_items || []
    )
      .filter((item) => item.category === "other" && Number(item.gross_amount) > 0)
      .forEach((item, index) => {
        if (result.some((line) => line.description.trim() === item.name.trim())) return;
        const additionalLine: InvoiceLine = {
          localId: `${Date.now()}-additional-${index}`,
          description: item.name.trim() || "Sonstige Kosten",
          quantity: Number(selectedBooking.ticket_count || 0),
          unit_gross: Number(item.gross_amount || 0),
          tax_rate: Number(item.vat_rate || 0),
          templateSource: "fixed",
        };
        const nextLines = insertBeforeServiceLine(result, additionalLine);
        result.splice(0, result.length, ...nextLines);
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
    setNextInvoiceNumber("");
    setPostShipping(false);
    setVoucherAmount(0);
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
        setVoucherAmount(Number(existing.voucher_amount || 0));
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

  useEffect(() => {
    if (tab !== "invoice" || created || !bookingId || !templateId) {
      setNextInvoiceNumber("");
      return;
    }

    let cancelled = false;
    setNextInvoiceNumber("");
    const params = new URLSearchParams({
      booking_id: String(bookingId),
      template_id: String(templateId),
    });

    fetch(`/api/invoices/next-number?${params}`, {
      headers: authHeaders(),
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.detail || "Nächste Rechnungsnummer konnte nicht geladen werden.");
        }
        return data;
      })
      .then((data) => {
        if (!cancelled) setNextInvoiceNumber(String(data?.invoice_number || ""));
      })
      .catch(() => {
        if (!cancelled) setNextInvoiceNumber("");
      });

    return () => { cancelled = true; };
  }, [bookingId, templateId, tab, created?.id]);

  function updateLine(id: string, patch: Partial<InvoiceLine>) {
    setLines((current) => refreshFixedServiceAmount(
      current.map((line) => line.localId === id ? { ...line, ...patch } : line),
    ));
  }

  function updateServicePercentage(id: string, percentage: number) {
    setLines((current) => refreshFixedServiceAmount(
      current.map((line) => line.localId === id
        ? {
            ...line,
            servicePercentage: normalizeServicePercentage(percentage),
            serviceCalculation: "percentage" as const,
          }
        : line),
    ));
  }

  function updateServiceAmount(id: string, amount: number) {
    setLines((current) => refreshFixedServiceAmount(
      current.map((line) => line.localId === id
        ? {
            ...line,
            quantity: 1,
            unit_gross: roundMoney(Math.max(0, Number(amount) || 0)),
            tax_rate: 19,
            serviceCalculation: "amount" as const,
          }
        : line),
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
      setLines((current) => refreshFixedServiceAmount(insertBeforeServiceLine(
          current.filter((line) => !line.localId.startsWith("shipping-")),
          {
            localId: `shipping-${Date.now()}`,
            description: "Versandpauschale",
            quantity: 1,
            unit_gross: Number(performance?.postal_shipping_gross || 0),
            tax_rate: Number(performance?.postal_shipping_vat_rate ?? 19),
            templateSource: "shipping",
          },
        )));
    } else {
      setLines((current) => refreshFixedServiceAmount(
        current.filter((line) => !line.localId.startsWith("shipping-")),
      ));
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
    const serviceLine = lines.find((line) => isServiceLine(line));
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
          voucher_amount: roundMoney(Math.max(0, Number(voucherAmount) || 0)),
          service_percentage: isAdmin && serviceLine
            ? normalizeServicePercentage(serviceLine.servicePercentage)
            : undefined,
          service_gross_override: isAdmin && serviceLine?.serviceCalculation === "amount"
            ? roundMoney(serviceLine.unit_gross)
            : undefined,
          items: orderedLines.map(({
            description,
            quantity,
            unit_gross,
            tax_rate,
            templateSource,
          }) => ({
            description,
            quantity,
            unit_gross,
            tax_rate,
            source: templateSource || "",
          })),
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
      setForm(templateToForm(
        saved,
        performances.find((item) => item.id === saved.performance_id),
      ));
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
      if (copy) {
        setForm(templateToForm(
          copy,
          performances.find((item) => item.id === copy.performance_id),
        ));
      }
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
        ? {
            source,
            percentage: 3,
            unit_gross: 0,
            service_calculation: "percentage",
            show_on_invoice: true,
            tax_rate: 19,
          }
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

  function changeTemplatePerformance(value: string) {
    const performanceId = value ? Number(value) : "";
    const selectedPerformance = performanceId === ""
      ? null
      : performances.find((item) => item.id === performanceId);
    setForm((current) => ({
      ...current,
      performance_id: performanceId,
      venue_text: performanceId === ""
        ? current.venue_text
        : normalizeVenueText(selectedPerformance?.venue_name),
    }));
    setMessage("");
  }

  const templateData: TemplateData = created
    ? readSnapshotData(created.template_snapshot)
    : {
        ...(template?.template_data || {}),
        ...THEATER_MASTER,
        venue_text: resolveTemplateVenueText(
          template?.template_data?.venue_text,
          performance?.venue_name,
        ),
        footer_lines: [...THEATER_MASTER.footer_lines],
        exchange_text: EXCHANGE_NOTICE,
        processor,
      };
  const snapshotPriceItems = Array.isArray(templateData.price_items)
    ? templateData.price_items as InvoicePriceItem[]
    : undefined;
  const ticketSplit = calculateTicketSplit(
    snapshotPriceItems ?? performance?.price_items,
  );
  const ticketTemplateItem = Array.isArray(templateData.items)
    ? templateData.items.find((item) => item.source === "tickets")
    : undefined;
  const ticketDescription = booking && ticketTemplateItem
    ? resolveTemplateItemDescription(ticketTemplateItem, booking, performance)
    : "Eintrittskarte / Arrangement";
  const displayLines = combineTicketComponentsForFront(
    orderedLines,
    ticketSplit,
    booking?.ticket_count || 1,
    ticketDescription,
  );
  const previewTotals = ticketSplit
    ? calculateInvoiceTotals(lines, ticketSplit)
    : totals;
  const numberPreview = created?.invoice_number || nextInvoiceNumber || (template
    ? invoiceNumberExample(
        template.number_prefix,
        performance?.date,
        Number(template.template_data.sequence_width || 3),
      )
    : "—");
  const formPerformance = performances.find(
    (item) => item.id === form.performance_id,
  );
  const formNumberExample = invoiceNumberExample(
    form.number_prefix,
    formPerformance?.date,
    form.sequence_width,
  );
  const taxTotal = created?.tax_amount ?? previewTotals.tax;
  const grossTotal = created?.gross_amount ?? previewTotals.gross;
  const voucherApplied = created
    ? Number(created.voucher_amount || 0)
    : roundMoney(Math.min(Math.max(0, Number(voucherAmount) || 0), grossTotal));
  const amountDue = created?.amount_due === undefined
    ? roundMoney(Math.max(0, grossTotal - voucherApplied))
    : Number(created.amount_due);

  function printInvoice() {
    if (!booking) return;
    const data = templateData;
    const recipient = created?.recipient_snapshot || booking;
    const printableLines = displayLines.map((line, index) => {
      const sum = calculateLine(line);
      return { ...line, position_no: index + 1, net_amount: sum.net, tax_amount: sum.tax, gross_amount: sum.gross };
    });
    const popup = window.open("", "_blank", "width=1000,height=900");
    if (!popup) {
      setError("Das Druckfenster wurde blockiert. Bitte Pop-ups erlauben.");
      return;
    }
    const rows = printableLines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.quantity.toLocaleString("de-DE"))}</td><td>${escapeHtml(money(line.unit_gross))}</td><td>${isServiceLine(line) ? "" : escapeHtml(line.taxLabel || `${line.tax_rate} %`)}</td><td>${escapeHtml(money(line.gross_amount))}</td></tr>`).join("");
    const taxes = `<tr><td colspan="2">Enthaltene MwSt. gesamt</td><td>${escapeHtml(money(taxTotal))}</td></tr>`;
    const paymentTotal = voucherApplied > 0
      ? `<tr><td colspan="2">Rechnungsbetrag</td><td>${escapeHtml(money(grossTotal))}</td></tr><tr class="voucher"><td colspan="2">Geschenkgutschein</td><td>− ${escapeHtml(money(voucherApplied))}</td></tr><tr class="grand"><td colspan="2">Noch zu zahlen</td><td>${escapeHtml(money(amountDue))}</td></tr>`
      : `<tr class="grand"><td colspan="2">Gesamtbetrag</td><td>${escapeHtml(money(grossTotal))}</td></tr>`;
    const venueText = String(data.venue_text || "").trim();
    const venueBlock = venueText
      ? `<div class="venue"><strong>VERANSTALTUNGSORT</strong><span>${escapeHtml(venueText).replaceAll("\r\n", "\n").replaceAll("\n", "<br>")}</span></div>`
      : "";
    const footer = (Array.isArray(data.footer_lines) ? data.footer_lines : []).map((line) => `<div>${escapeHtml(line)}</div>`).join("");
    const splitRows = ticketSplit?.rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.vatRate)} %</td><td>${escapeHtml(money(row.net))}</td><td>${escapeHtml(money(row.tax))}</td><td>${escapeHtml(money(row.gross))}</td></tr>`).join("") || "";
    const ticketSplitPage = ticketSplit
      ? `<div class="page split-page"><div class="title">Steuerliche Aufteilung des Ticketpreises</div><p>Die folgenden Beträge sind bereits im Ticketpreis enthalten und werden nicht zusätzlich berechnet. Die Aufteilung gilt je Eintrittskarte.</p><table><thead><tr><th>Bestandteil</th><th>MwSt.</th><th>Netto</th><th>MwSt.-Betrag</th><th>Brutto</th></tr></thead><tbody>${splitRows}<tr class="grand"><td>Summe Ticket</td><td></td><td>${escapeHtml(money(ticketSplit.net))}</td><td>${escapeHtml(money(ticketSplit.tax))}</td><td>${escapeHtml(money(ticketSplit.gross))}</td></tr></tbody></table><p class="split-note">Anzahl Tickets auf dieser Rechnung: ${escapeHtml(booking.ticket_count)} · Ticketpreis je Ticket: ${escapeHtml(money(ticketSplit.gross))}</p><p>Diese Seite erläutert ausschließlich die steuerliche Zusammensetzung des auf Seite 1 ausgewiesenen Ticketpreises.</p></div>`
      : "";
    popup.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Rechnung ${escapeHtml(numberPreview)}</title><style>@page{size:A4;margin:12mm 15mm}*{box-sizing:border-box}body{font-family:Arial;color:#111;font-size:13px;margin:0}.page{max-width:790px;min-height:1060px;margin:auto;position:relative;padding-bottom:100px}.logo{width:330px;max-height:72px;object-fit:contain;object-position:left;margin-bottom:14px}.sender{font-size:10px;text-decoration:underline;margin-bottom:18px}.head{display:grid;grid-template-columns:1fr 280px;gap:40px;min-height:170px}.address{font-size:15px;line-height:1.5}.meta{display:grid;grid-template-columns:112px 1fr;align-content:start;gap:5px 8px;font-size:11px}.title{font-size:23px;font-weight:700;margin:20px 0}.venue{margin:0 0 18px;line-height:1.45}.venue strong{display:block;margin-bottom:3px}.venue span{white-space:normal}table{width:100%;border-collapse:collapse}th,td{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.sum{width:400px;margin:14px 0 0 auto}.sum td{border:0}.voucher td{font-weight:700}.grand{font-size:17px;font-weight:700;border-top:2px solid #111}.payment{margin-top:30px;line-height:1.5}.bank{display:grid;grid-template-columns:160px 1fr;gap:5px 15px;margin:15px 0}.thanks{margin-top:25px;font-size:15px}.exchange{margin-top:24px;font-weight:700;font-style:italic}.footer{position:absolute;bottom:0;left:0;right:0;border-top:1px solid #aaa;padding-top:9px;text-align:center;font-size:10px;line-height:1.45}.bar{text-align:right}.bar button{padding:10px 18px;background:#111;color:#fff;border:0;border-radius:7px;cursor:pointer}.bar button:disabled{cursor:wait;opacity:.7}@media print{.bar{display:none}}</style></head><body><div class="page"><div class="bar"><button type="button">PDF direkt herunterladen</button></div><img class="logo" src="/invoice-logo.png"><div class="sender">${escapeHtml(data.sender_line)}</div><div class="head"><div class="address">${escapeHtml(recipient.first_name)} ${escapeHtml(recipient.last_name)}<br>${escapeHtml(recipient.street)}<br>${escapeHtml(recipient.postal_code)} ${escapeHtml(recipient.city)}</div><div class="meta"><strong>Rechnungsdatum</strong><span>${escapeHtml(formatDate(created?.invoice_date || invoiceDate))}</span><strong>Bearbeiter</strong><span>${escapeHtml(data.processor)}</span><strong>Steuernummer</strong><span>${escapeHtml(data.tax_number)}</span></div></div><div class="title">Rechnung Nr. ${escapeHtml(numberPreview)}</div>${venueBlock}<table><thead><tr><th>Bezeichnung</th><th>Menge</th><th>Einzelpreis</th><th>MwSt.</th><th>Gesamt</th></tr></thead><tbody>${rows}</tbody></table><table class="sum">${taxes}${paymentTotal}</table><div class="payment">${escapeHtml(data.payment_text)}</div><div class="bank"><strong>Kontoinhaber</strong><span>${escapeHtml(data.company_name)}</span><strong>IBAN</strong><span>${escapeHtml(data.iban)}</span><strong>Bank</strong><span>${escapeHtml(data.bank_name)}</span><strong>${escapeHtml(data.reference_label)}</strong><span>${escapeHtml(created?.reference_number || numberPreview)}</span></div><div class="thanks">${escapeHtml(data.thank_you_text)}</div><div class="exchange">${escapeHtml(data.exchange_text)}</div><div class="footer">${footer}</div></div></body></html>`);
    const printLayoutFix = popup.document.createElement("style");
    printLayoutFix.textContent = ".page+.page{break-before:page;page-break-before:always;padding-top:20px}.split-page p{line-height:1.55}.split-note{margin-top:22px}@media print{.page{min-height:272mm!important}.page+.page{break-before:page!important;page-break-before:always!important}}";
    popup.document.head.appendChild(printLayoutFix);
    popup.document.close();
    if (ticketSplitPage) {
      const splitContainer = popup.document.createElement("div");
      splitContainer.innerHTML = ticketSplitPage;
      const splitElement = splitContainer.firstElementChild;
      if (splitElement) popup.document.body.appendChild(splitElement);
    }
    const pdfButton = popup.document.querySelector<HTMLButtonElement>(".bar button");
    pdfButton?.addEventListener("click", () => {
      const safeNumber = numberPreview.replace(/[^a-z0-9_-]+/gi, "-");
      pdfButton.disabled = true;
      pdfButton.textContent = "PDF wird erstellt …";
      void downloadInvoicePopupAsPdf(popup, `Rechnung-${safeNumber}.pdf`)
        .then(() => {
          pdfButton.textContent = "PDF wurde heruntergeladen";
          window.setTimeout(() => {
            if (!popup.closed) pdfButton.textContent = "PDF erneut herunterladen";
          }, 1_500);
        })
        .catch((caught) => {
          pdfButton.textContent = "PDF konnte nicht erstellt werden";
          setError(caught instanceof Error ? caught.message : "PDF konnte nicht erstellt werden.");
        })
        .finally(() => {
          pdfButton.disabled = false;
        });
    });
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
          <div className="invoice-v2-grid">
            <label>Geschenkgutschein verrechnen<input type="number" min="0" step="0.01" inputMode="decimal" disabled={Boolean(created) || !booking} value={created ? voucherApplied : voucherAmount} onChange={(event) => setVoucherAmount(Math.max(0, Number(event.target.value) || 0))} /><small>Wird nach Steuern vom Rechnungsbetrag abgezogen; höchstens bis 0,00 € Restbetrag.</small></label>
          </div>

          <SectionTitle number="3" title="Rechnungspositionen" extra={<button disabled={Boolean(created)} onClick={addLine}>+ Sonstige Kosten</button>} />
          <div className="invoice-v2-lines">{lines.map((line, index) => {
            const sum = calculateLine(line);
            const serviceLocked = isServiceLine(line);
            return <div className="invoice-v2-line" key={line.localId}>
              <b>{index + 1}</b>
              <label className="wide">Bezeichnung<input disabled={Boolean(created)} value={line.description} onChange={(event) => updateLine(line.localId, { description: event.target.value })} /></label>
              {serviceLocked ? <>
                {isAdmin ? <>
                  <label>Service in %<input disabled={Boolean(created)} type="number" min="0" max="100" step="0.01" value={normalizeServicePercentage(line.servicePercentage)} onChange={(event) => updateServicePercentage(line.localId, Number(event.target.value))} /></label>
                  <label>Servicebetrag brutto<input disabled={Boolean(created)} type="number" min="0" step="0.01" value={line.unit_gross} onChange={(event) => updateServiceAmount(line.localId, Number(event.target.value))} /></label>
                </> : <label>Berechnung<input readOnly value="Automatisch" /></label>}
              </> : <>
                <label>Menge<input disabled={Boolean(created)} type="number" min="1" step="1" inputMode="numeric" value={line.quantity} onChange={(event) => updateLine(line.localId, { quantity: Math.max(1, Math.round(Number(event.target.value) || 1)) })} /></label>
                <label>Brutto je Stück<input disabled={Boolean(created)} type="number" min="0" step="0.01" value={line.unit_gross} onChange={(event) => updateLine(line.localId, { unit_gross: Number(event.target.value) })} /></label>
                <label>MwSt.<select disabled={Boolean(created)} value={line.tax_rate} onChange={(event) => updateLine(line.localId, { tax_rate: Number(event.target.value) })}>{TAX_RATES.map((rate) => <option key={rate} value={rate}>{rate} %</option>)}</select></label>
              </>}
              <div className="invoice-v2-line-total"><span>Brutto</span><strong>{money(sum.gross)}</strong><small>{money(sum.net)} netto</small></div>
              {!created && !serviceLocked && <button className="invoice-v2-remove" onClick={() => setLines((current) => refreshFixedServiceAmount(current.filter((item) => item.localId !== line.localId)))}>×</button>}
            </div>;
          })}</div>
          <label>Interne Notiz<textarea rows={2} disabled={Boolean(created)} value={created?.notes || notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <div className="invoice-v2-actions"><button className="secondary" disabled={!booking} onClick={printInvoice}>Vorschau / Drucken</button>{!created && <button className="primary" disabled={saving || loading || !booking || !templateId} onClick={createInvoice}>{saving ? "Wird gespeichert …" : "Rechnung endgültig erstellen"}</button>}</div>
        </section>

        <section className="invoice-v2-preview"><div className="invoice-v2-paper">
          <img src="/invoice-logo.png" alt="Boulevardtheater" />
          <div className="invoice-v2-sender">{String(templateData.sender_line || "")}</div>
          <div className="invoice-v2-paper-head"><div>{booking ? <>{booking.first_name} {booking.last_name}<br />{booking.street}<br />{booking.postal_code} {booking.city}</> : "Empfänger auswählen"}</div><dl><dt>Rechnungsdatum</dt><dd>{formatDate(created?.invoice_date || invoiceDate)}</dd><dt>Bearbeiter</dt><dd>{String(templateData.processor || "—")}</dd><dt>Steuernummer</dt><dd>{String(templateData.tax_number || "—")}</dd></dl></div>
          <h1>Rechnung Nr. {numberPreview}</h1>
          {!created && <div className="invoice-v2-number-note">Vorschau der aktuell nächsten freien Nummer – endgültig reserviert wird sie beim Speichern.</div>}
          {String(templateData.venue_text || "").trim() && <div style={{ margin: "0 0 18px", lineHeight: 1.45 }}><strong style={{ display: "block", marginBottom: 3 }}>VERANSTALTUNGSORT</strong><span style={{ whiteSpace: "pre-line" }}>{String(templateData.venue_text || "").trim()}</span></div>}
          <table><thead><tr><th>Bezeichnung</th><th>Menge</th><th>MwSt.</th><th>Gesamt</th></tr></thead><tbody>{displayLines.map((line) => <tr key={line.localId}><td>{line.description}</td><td>{line.quantity.toLocaleString("de-DE")}</td><td>{isServiceLine(line) ? "" : (line.taxLabel || `${line.tax_rate} %`)}</td><td>{money(calculateLine(line).gross)}</td></tr>)}</tbody></table>
          <div className="invoice-v2-totals"><div><span>Enthaltene MwSt. gesamt</span><span>{money(taxTotal)}</span></div>{voucherApplied > 0 ? <><div><span>Rechnungsbetrag</span><span>{money(grossTotal)}</span></div><div><strong>Geschenkgutschein</strong><strong>− {money(voucherApplied)}</strong></div><div className="grand"><strong>Noch zu zahlen</strong><strong>{money(amountDue)}</strong></div></> : <div className="grand"><strong>Gesamtbetrag</strong><strong>{money(grossTotal)}</strong></div>}</div>
          <p>{String(templateData.payment_text || "")}</p>
          <div className="invoice-v2-bank"><strong>Kontoinhaber</strong><span>{String(templateData.company_name || "")}</span><strong>IBAN</strong><span>{String(templateData.iban || "")}</span><strong>Bank</strong><span>{String(templateData.bank_name || "")}</span><strong>{String(templateData.reference_label || "Referenz")}</strong><span>{created?.reference_number || numberPreview}</span></div>
          <p className="invoice-v2-thanks">{String(templateData.thank_you_text || "")}</p><p className="invoice-v2-exchange">{String(templateData.exchange_text || "")}</p>
          <footer>{(Array.isArray(templateData.footer_lines) ? templateData.footer_lines : []).map((line, index) => <div key={index}>{line}</div>)}</footer>
        </div>
        {ticketSplit && <div className="invoice-v2-paper invoice-v2-tax-page">
          <h1>Steuerliche Aufteilung des Ticketpreises</h1>
          <p>Die folgenden Beträge sind bereits im Ticketpreis enthalten und werden nicht zusätzlich berechnet. Die Aufteilung gilt je Eintrittskarte.</p>
          <table><thead><tr><th>Bestandteil</th><th>MwSt.</th><th>Netto</th><th>MwSt.-Betrag</th><th>Brutto</th></tr></thead><tbody>
            {ticketSplit.rows.map((row) => <tr key={row.category}><td>{row.name}</td><td>{row.vatRate} %</td><td>{money(row.net)}</td><td>{money(row.tax)}</td><td>{money(row.gross)}</td></tr>)}
            <tr><td><strong>Summe Ticket</strong></td><td /><td><strong>{money(ticketSplit.net)}</strong></td><td><strong>{money(ticketSplit.tax)}</strong></td><td><strong>{money(ticketSplit.gross)}</strong></td></tr>
          </tbody></table>
          <p>Anzahl Tickets auf dieser Rechnung: {booking?.ticket_count || 0} · Ticketpreis je Ticket: {money(ticketSplit.gross)}</p>
          <p>Diese Seite erläutert ausschließlich die steuerliche Zusammensetzung des auf Seite 1 ausgewiesenen Ticketpreises.</p>
        </div>}
        </section>
      </div> : <div className="invoice-v2-template-workspace">
        <aside className="invoice-v2-template-list"><button className="invoice-v2-new" onClick={() => setForm(newForm())}>+ Neue Vorlage</button>{loading && <p>Lade Vorlagen …</p>}{templates.map((item) => { const itemPerformance = performances.find((performanceItem) => performanceItem.id === item.performance_id); return <button key={item.id} className={form.id === item.id ? "selected" : ""} onClick={() => setForm(templateToForm(item, itemPerformance))}><strong>{item.name}</strong><span>{itemPerformance?.title || (item.performance_id ? "Event" : "Alle Events")}</span><small>{invoiceNumberExample(item.number_prefix, itemPerformance?.date, Number(item.template_data.sequence_width || 3))} · {item.is_active ? "Aktiv" : "Inaktiv"}</small></button>; })}</aside>
        <section className="invoice-v2-template-editor">
          <div className="invoice-v2-editor-title"><div><h3>{form.id ? "Vorlage bearbeiten" : "Neue Vorlage"}</h3><p>Die verwendete Vorlage wird bei jeder fertigen Rechnung unveränderlich mitgespeichert.</p></div>{form.id && <div className="invoice-v2-editor-buttons"><button onClick={() => { const selected = templates.find((item) => item.id === form.id); if (selected) void duplicateTemplate(selected); }}>Vorlage duplizieren</button>{isAdmin && <button className="danger" onClick={() => { const selected = templates.find((item) => item.id === form.id); if (selected) { setDeleteTarget(selected); setDeleteConfirmation(""); } }}>Vorlage löschen</button>}</div>}</div>
          <div className="invoice-v2-form-grid"><label>Vorlagenname<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Event-Zuordnung<select value={form.performance_id} onChange={(event) => changeTemplatePerformance(event.target.value)}><option value="">Allgemein – alle Events</option>{performances.map((item) => <option key={item.id} value={item.id}>{formatDate(item.date)} · {item.title}</option>)}</select></label><label>Standard-MwSt. für neue Positionen<select value={form.default_tax_rate} onChange={(event) => setForm({ ...form, default_tax_rate: Number(event.target.value) })}>{TAX_RATES.map((rate) => <option key={rate} value={rate}>{rate} %</option>)}</select></label><label>Laufende Nummer<input readOnly value="3 Stellen (001)" /></label><label className="full">Interne Beschreibung<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>
          <h4>Rechnungsnummer</h4><div className="invoice-v2-number-grid"><label>Event-Kürzel<input value={form.number_prefix} onChange={(event) => setForm({ ...form, number_prefix: event.target.value })} /></label><span>– TTMM –</span><label>Beispiel<input readOnly value={formNumberExample} /></label></div><div className="invoice-v2-hint">Format: Event-Kürzel – Veranstaltungstag und -monat – laufende Nummer. Jede Vorstellung beginnt bei 001; die Nummer wird transaktionssicher vergeben.</div>
          <h4>Veranstaltungsort auf der Rechnung</h4><div className="invoice-v2-hint">Optional. Hier kannst du den Namen und die vollständige Adresse frei und mehrzeilig eingeben. Bleibt das Feld leer, wird kein Veranstaltungsort gedruckt.</div><div className="invoice-v2-form-grid"><label className="full">Veranstaltungsort und Adresse<textarea rows={4} placeholder={"Boulevardtheater Deidesheim Stadthalle\nBahnhofstr. 11\n67146 Deidesheim"} value={form.venue_text} onChange={(event) => setForm({ ...form, venue_text: event.target.value })} /></label></div>
          <h4>Absender und Zahlung</h4><div className="invoice-v2-hint">Absender, Steuernummer, IBAN, Bank und Fußzeile sind feste Theaterdaten. Der Bearbeiter wird bei jeder Rechnung automatisch aus der angemeldeten Person übernommen.</div><div className="invoice-v2-form-grid invoice-v2-master-data"><label className="full">Absenderzeile<input readOnly value={form.sender_line} /></label><label>Firmen-/Kontoinhaber<input readOnly value={form.company_name} /></label><label>Steuernummer<input readOnly value={form.tax_number} /></label><label>IBAN<input readOnly value={form.iban} /></label><label>Bank<input readOnly value={form.bank_name} /></label><label>Referenz-Bezeichnung<input value={form.reference_label} onChange={(event) => setForm({ ...form, reference_label: event.target.value })} /></label><label className="full">Zahlungshinweis<textarea rows={2} value={form.payment_text} onChange={(event) => setForm({ ...form, payment_text: event.target.value })} /></label></div>
          <h4>Standardpositionen und Steuer</h4>
          <div className="invoice-v2-template-items">
            {form.items.map((item, index) => <div className="invoice-v2-template-item" key={index}>
              <b>{index + 1}</b>
              <label>Quelle<select disabled={item.source === "service_percent"} value={item.source} onChange={(event) => changeTemplateItemSource(index, event.target.value as TemplateItem["source"])}><option value="tickets">Ticketdaten</option><option value="service_percent" disabled={item.source !== "service_percent"}>Servicepauschale</option><option value="fixed">Fester/Sonstiger Posten</option></select></label>
              <label className="wide">Bezeichnung auf der Rechnung<input value={item.description} onChange={(event) => updateTemplateItem(index, { description: event.target.value })} />{item.source === "tickets" && <span className="invoice-v2-auto-event"><input type="checkbox" checked={Boolean(item.append_event_details)} onChange={(event) => updateTemplateItem(index, { append_event_details: event.target.checked })} /> Eventname und Datum automatisch ergänzen</span>}</label>
              {item.source !== "service_percent" && <label>MwSt.<select value={item.tax_rate} onChange={(event) => updateTemplateItem(index, { tax_rate: Number(event.target.value) })}>{TAX_RATES.map((rate) => <option key={rate} value={rate}>{rate} %</option>)}</select></label>}
              <div className={`invoice-v2-template-values${item.source === "fixed" ? " split" : ""}`}>
                {item.source === "tickets" && <label>Ticketpreis brutto<input type="number" min="0" step="0.01" placeholder="Preis aus Buchung" value={item.unit_gross ?? ""} onChange={(event) => updateTemplateItem(index, { unit_gross: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>}
                {item.source === "service_percent" && (isAdmin
                  ? <>
                    <label>Berechnung<select value={normalizeServiceCalculation(item.service_calculation)} onChange={(event) => updateTemplateItem(index, { service_calculation: event.target.value as "percentage" | "amount" })}><option value="percentage">Prozentual</option><option value="amount">Fester Bruttobetrag</option></select></label>
                    {normalizeServiceCalculation(item.service_calculation) === "amount"
                      ? <label>Service brutto in €<input type="number" min="0" step="0.01" value={normalizeServiceAmount(item.unit_gross)} onChange={(event) => updateTemplateItem(index, { unit_gross: normalizeServiceAmount(event.target.value) })} /></label>
                      : <label>Service in %<input type="number" min="0" max="100" step="0.01" value={normalizeServicePercentage(item.percentage)} onChange={(event) => updateTemplateItem(index, { percentage: normalizeServicePercentage(event.target.value) })} /></label>}
                    <span className="invoice-v2-auto-event"><input type="checkbox" checked={item.show_on_invoice !== false} onChange={(event) => updateTemplateItem(index, { show_on_invoice: event.target.checked })} /> Auf Rechnung berechnen und anzeigen</span>
                  </>
                  : <label>Berechnung<input readOnly value={item.show_on_invoice === false ? "Nicht berechnen" : "Automatisch"} /></label>)}
                {item.source === "service" && <label>Betrag<input readOnly value="Aus Buchung" /></label>}
                {item.source === "fixed" && <><label>Menge<input type="number" min="1" step="1" inputMode="numeric" value={item.quantity ?? 1} onChange={(event) => updateTemplateItem(index, { quantity: Math.max(1, Math.round(Number(event.target.value) || 1)) })} /></label><label>Brutto<input type="number" min="0" step="0.01" value={item.unit_gross ?? 0} onChange={(event) => updateTemplateItem(index, { unit_gross: Number(event.target.value) })} /></label></>}
              </div>
              <div className="invoice-v2-template-item-actions"><button type="button" title={item.source === "service_percent" ? "Die Servicepauschale bleibt immer ganz unten." : "Position nach oben"} disabled={index === 0 || item.source === "service_percent"} onClick={() => moveTemplateItem(index, -1)}>↑</button><button type="button" title={item.source === "service_percent" || form.items[index + 1]?.source === "service_percent" ? "Die Servicepauschale bleibt immer ganz unten." : "Position nach unten"} disabled={index === form.items.length - 1 || item.source === "service_percent" || form.items[index + 1]?.source === "service_percent"} onClick={() => moveTemplateItem(index, 1)}>↓</button><button type="button" className="delete" title={item.source === "service_percent" ? "Die feste Servicepauschale kann nicht entfernt werden." : "Position entfernen"} disabled={item.source === "service_percent"} onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>×</button></div>
            </div>)}
            <button onClick={() => setForm((current) => { const items = [...current.items]; const serviceIndex = items.findIndex((item) => item.source === "service_percent"); const nextItem: TemplateItem = { description: "Sonstige Kosten", source: "fixed", tax_rate: current.default_tax_rate, quantity: 1, unit_gross: 0 }; if (serviceIndex < 0) items.push(nextItem); else items.splice(serviceIndex, 0, nextItem); return { ...current, items }; })}>+ Standardposition ergänzen</button>
          </div>
          <div className="invoice-v2-hint">Bei „Ticketdaten“ kann ein eigener Ticketpreis gespeichert werden; bleibt das Feld leer, wird der Preis aus der Buchung verwendet. Eventname und Veranstaltungsdatum werden auf Wunsch automatisch ergänzt. Administratoren können die Servicepauschale pro Vorlage prozentual oder als festen Bruttobetrag mit 19 % MwSt. festlegen. Wird „Auf Rechnung berechnen und anzeigen“ ausgeschaltet, entfällt die Pauschale vollständig. Auf der Rechnung stehen die teuersten Positionen oben und die Servicepauschale bleibt ganz unten.</div>
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
