import {
  useEffect,
  useMemo,
  useState,
} from "react";

type InvoiceBooking = {
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

type InvoicePerformance = {
  id: number;
  date: string;
  time: string;
  title: string;
};

type InvoiceTemplate = {
  template_key: string;
  name: string;
  description: string;
};

type TaxRate = {
  id: number;
  label: string;
  rate: number;
  is_default: boolean;
};

type ExistingInvoice = {
  id: number;
  invoice_number: string;
  booking_id: number;
  booking_number: string;
  first_name: string;
  last_name: string;
  invoice_date: string | null;
  template_key: string;
  tax_rate: number;
  net_amount: number;
  tax_amount: number;
  gross_amount: number;
  status: string;
  payment_status: string;
};

type Props = {
  bookings: InvoiceBooking[];
  performances: InvoicePerformance[];
  onClose: () => void;
};

function money(value: number) {
  return value.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function InvoicePanel({
  bookings,
  performances,
  onClose,
}: Props) {
  const [templates, setTemplates] =
    useState<InvoiceTemplate[]>([]);

  const [taxRates, setTaxRates] =
    useState<TaxRate[]>([]);

  const [selectedBookingId, setSelectedBookingId] =
    useState<number | "">("");

  const [templateKey, setTemplateKey] =
    useState("RE1");

  const [taxRate, setTaxRate] =
    useState(19);

  const [invoiceDate, setInvoiceDate] =
    useState(today());

  const [search, setSearch] =
    useState("");

  const [existingInvoice, setExistingInvoice] =
    useState<ExistingInvoice | null>(null);

  const [notes, setNotes] =
    useState("");

  const [paid, setPaid] =
    useState(false);

  const [sent, setSent] =
    useState(false);

  const [storno, setStorno] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  const selectedBooking =
    bookings.find(
      (booking) =>
        booking.id === selectedBookingId
    ) ?? null;

  const selectedPerformance =
    performances.find(
      (performance) =>
        performance.id ===
        selectedBooking?.performanceId
    ) ?? null;

  const filteredBookings = useMemo(() => {
    const value =
      search.trim().toLowerCase();

    if (!value) {
      return bookings;
    }

    return bookings.filter(
      (booking) =>
        `${booking.first_name} ${booking.last_name}`
          .toLowerCase()
          .includes(value) ||
        booking.booking_number
          .toLowerCase()
          .includes(value)
    );
  }, [bookings, search]);

  const ticketGross =
    selectedBooking
      ? Number(selectedBooking.ticket_count) *
        Number(selectedBooking.ticket_price)
      : 0;

  const serviceGross =
    selectedBooking
      ? Number(selectedBooking.service_fee || 0)
      : 0;

  const gross =
    ticketGross + serviceGross;

  const net =
    gross > 0
      ? Math.round(
          (gross / (1 + taxRate / 100)) * 100
        ) / 100
      : 0;

  const tax =
    Math.round(
      (gross - net) * 100
    ) / 100;

  useEffect(() => {
    async function loadOptions() {
      try {
        const [templatesResponse, taxResponse] =
          await Promise.all([
            fetch("/api/invoice-templates"),
            fetch("/api/tax-rates"),
          ]);

        if (!templatesResponse.ok) {
          throw new Error(
            "Rechnungsvorlagen konnten nicht geladen werden."
          );
        }

        if (!taxResponse.ok) {
          throw new Error(
            "Steuersätze konnten nicht geladen werden."
          );
        }

        const [
          templateData,
          taxData,
        ] = await Promise.all([
          templatesResponse.json(),
          taxResponse.json(),
        ]);

        if (Array.isArray(templateData)) {
          setTemplates(templateData);

          if (
            templateData.length > 0 &&
            !templateData.some(
              (item) =>
                item.template_key ===
                "RE1"
            )
          ) {
            setTemplateKey(
              templateData[0].template_key
            );
          }
        }

        if (Array.isArray(taxData)) {
          setTaxRates(taxData);

          const defaultRate =
            taxData.find(
              (item: TaxRate) =>
                item.is_default
            );

          if (defaultRate) {
            setTaxRate(
              Number(defaultRate.rate)
            );
          }
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Rechnungsoptionen konnten nicht geladen werden."
        );
      }
    }

    loadOptions();
  }, []);

  useEffect(() => {
    async function checkExistingInvoice() {
      setExistingInvoice(null);

      if (
        typeof selectedBookingId !==
        "number"
      ) {
        return;
      }

      try {
        const response = await fetch(
          `/api/invoices?booking_id=${selectedBookingId}`
        );

        if (!response.ok) {
          return;
        }

        const data =
          await response.json();

        if (
          Array.isArray(data) &&
          data.length > 0
        ) {
          setExistingInvoice(data[0]);
        }
      } catch {
        // Prüfung darf die Auswahl nicht blockieren.
      }
    }

    checkExistingInvoice();
  }, [selectedBookingId]);

  function openPreview() {
    if (!selectedBooking) {
      setError(
        "Bitte zuerst eine Buchung auswählen."
      );
      return;
    }

    const customerAddress = [
      selectedBooking.street,
      selectedBooking.postal_code,
      selectedBooking.city,
    ]
      .filter(Boolean)
      .join("<br>");

    const performanceLine =
      selectedPerformance
        ? `${selectedPerformance.title} · ${selectedPerformance.date} · ${selectedPerformance.time}`
        : "";

    const html = `
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Rechnungsvorschau</title>
<style>
body {
  font-family: Arial, sans-serif;
  color: #111827;
  margin: 0;
  padding: 40px;
}
.invoice {
  max-width: 800px;
  margin: auto;
}
.header {
  display: flex;
  justify-content: space-between;
  border-bottom: 2px solid #111827;
  padding-bottom: 24px;
  margin-bottom: 36px;
}
h1 {
  margin: 0 0 8px;
}
.small {
  color: #6b7280;
  font-size: 13px;
}
.customer {
  margin-bottom: 32px;
}
.meta {
  text-align: right;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 30px;
}
th, td {
  padding: 10px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
}
.right {
  text-align: right;
}
.totals {
  width: 300px;
  margin-left: auto;
  margin-top: 24px;
}
.totals div {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
}
.total {
  border-top: 2px solid #111827;
  margin-top: 8px;
  padding-top: 12px !important;
  font-weight: 700;
  font-size: 18px;
}
.notes {
  margin-top: 36px;
}
</style>
</head>
<body>
<div class="invoice">

<div class="header">
  <div>
    <h1>Rechnung</h1>
    <div class="small">TheaterSoftware</div>
  </div>

  <div class="meta">
    <div><strong>Rechnungsdatum</strong></div>
    <div>${invoiceDate}</div>
    <br>
    <div><strong>Buchungsnummer</strong></div>
    <div>${selectedBooking.booking_number}</div>
    ${
      existingInvoice
        ? `<br><div><strong>Rechnungsnummer</strong></div>
           <div>${existingInvoice.invoice_number}</div>`
        : ""
    }
  </div>
</div>

<div class="customer">
  <strong>${selectedBooking.first_name} ${selectedBooking.last_name}</strong>
  <br>
  ${customerAddress}
  ${
    selectedBooking.email
      ? `<br>${selectedBooking.email}`
      : ""
  }
  ${
    selectedBooking.phone
      ? `<br>${selectedBooking.phone}`
      : ""
  }
</div>

<div>
  <strong>Veranstaltung</strong>
  <br>
  ${performanceLine}
</div>

<table>
<thead>
<tr>
  <th>Anzahl</th>
  <th>Beschreibung</th>
  <th class="right">Einzelpreis</th>
  <th class="right">Gesamt</th>
</tr>
</thead>
<tbody>
<tr>
  <td>${selectedBooking.ticket_count}</td>
  <td>Ticket ${selectedPerformance?.title ?? ""}</td>
  <td class="right">${money(
    Number(selectedBooking.ticket_price)
  )}</td>
  <td class="right">${money(ticketGross)}</td>
</tr>
<tr>
  <td>1</td>
  <td>Servicepauschale</td>
  <td class="right">${money(serviceGross)}</td>
  <td class="right">${money(serviceGross)}</td>
</tr>
</tbody>
</table>

<div class="totals">
  <div>
    <span>Netto</span>
    <strong>${money(net)}</strong>
  </div>
  <div>
    <span>MwSt. ${taxRate} %</span>
    <strong>${money(tax)}</strong>
  </div>
  <div class="total">
    <span>Brutto</span>
    <strong>${money(gross)}</strong>
  </div>
</div>

${
  notes
    ? `<div class="notes">
         <strong>Anmerkungen</strong><br>
         ${notes.replace(/\n/g, "<br>")}
       </div>`
    : ""
}

</div>
<script>
window.print();
</script>
</body>
</html>
`;

    const preview =
      window.open(
        "",
        "_blank",
        "width=900,height=1000"
      );

    if (!preview) {
      setError(
        "Die Vorschau konnte nicht geöffnet werden. Bitte Pop-ups erlauben."
      );
      return;
    }

    preview.document.write(html);
    preview.document.close();
  }

  async function createInvoice() {
    setError("");
    setSuccess("");

    if (!selectedBooking) {
      setError(
        "Bitte zuerst eine Buchung auswählen."
      );
      return;
    }

    if (existingInvoice) {
      setError(
        `Für diese Buchung existiert bereits ${existingInvoice.invoice_number}.`
      );
      return;
    }

    if (storno) {
      setError(
        "Eine Rechnung kann nicht gleichzeitig als Storno erstellt werden."
      );
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        "/api/invoices",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            booking_id:
              selectedBooking.id,
            template_key:
              templateKey,
            tax_rate:
              Number(taxRate),
          }),
        }
      );

      const data =
        await response
          .json()
          .catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ??
            "Rechnung konnte nicht erstellt werden."
        );
      }

      setSuccess(
        `${data.invoice_number} wurde erfolgreich erstellt.`
      );

      setExistingInvoice({
        id: Number(data.invoice_id),
        invoice_number:
          data.invoice_number,
        booking_id:
          Number(data.booking_id),
        booking_number:
          data.booking_number,
        first_name:
          selectedBooking.first_name,
        last_name:
          selectedBooking.last_name,
        invoice_date:
          invoiceDate,
        template_key:
          data.template_key,
        tax_rate:
          Number(data.tax_rate),
        net_amount:
          Number(data.net_amount),
        tax_amount:
          Number(data.tax_amount),
        gross_amount:
          Number(data.gross_amount),
        status: paid
          ? "bezahlt"
          : "offen",
        payment_status: paid
          ? "bezahlt"
          : "offen",
      });
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Rechnung konnte nicht erstellt werden."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="invoice-overlay">
      <div className="invoice-panel invoice-panel-simple">

        <div className="invoice-panel-header">
          <div>
            <div className="invoice-kicker">
              RECHNUNG
            </div>
            <h2>Rechnung erstellen</h2>
            <p>
              Alle wichtigen Angaben auf einer Seite.
            </p>
          </div>

          <button
            type="button"
            className="close-button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {error && (
          <div className="invoice-error">
            {error}
          </div>
        )}

        {success && (
          <div className="invoice-success">
            {success}
          </div>
        )}

        <section className="invoice-section">
          <div className="invoice-section-heading">
            <span>1</span>
            <h3>Kunde & Buchung</h3>
          </div>

          <div className="invoice-booking-row">
            <div className="invoice-booking-picker">
              <label>
                Buchung auswählen
              </label>

              <input
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Name oder Buchungsnummer suchen …"
              />

              <select
                value={selectedBookingId}
                onChange={(event) => {
                  setSelectedBookingId(
                    event.target.value
                      ? Number(
                          event.target.value
                        )
                      : ""
                  );

                  setError("");
                  setSuccess("");
                }}
              >
                <option value="">
                  Bitte Buchung auswählen …
                </option>

                {filteredBookings.map(
                  (booking) => (
                    <option
                      key={booking.id}
                      value={booking.id}
                    >
                      {booking.last_name},{" "}
                      {booking.first_name} ·{" "}
                      {booking.booking_number}
                    </option>
                  )
                )}
              </select>
            </div>

            {selectedBooking && (
              <div className="invoice-customer-card">
                <strong>
                  {selectedBooking.first_name}{" "}
                  {selectedBooking.last_name}
                </strong>

                <div>
                  {selectedBooking.street}
                </div>

                <div>
                  {selectedBooking.postal_code}{" "}
                  {selectedBooking.city}
                </div>

                <div className="invoice-contact">
                  {selectedBooking.email ||
                    "Keine E-Mail"}
                  {selectedBooking.phone
                    ? ` · ${selectedBooking.phone}`
                    : ""}
                </div>

                <div className="invoice-booking-meta">
                  <span>
                    {selectedBooking.booking_number}
                  </span>

                  {selectedPerformance && (
                    <span>
                      {selectedPerformance.title} ·{" "}
                      {selectedPerformance.date} ·{" "}
                      {selectedPerformance.time}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="invoice-section">
          <div className="invoice-section-heading">
            <span>2</span>
            <h3>Rechnung</h3>
          </div>

          <div className="invoice-fields-4">
            <label>
              Rechnungsnummer
              <input
                value={
                  existingInvoice
                    ? existingInvoice.invoice_number
                    : "wird automatisch vergeben"
                }
                readOnly
              />
            </label>

            <label>
              Rechnungsdatum
              <input
                type="date"
                value={invoiceDate}
                onChange={(event) =>
                  setInvoiceDate(
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Vorlage
              <select
                value={templateKey}
                onChange={(event) =>
                  setTemplateKey(
                    event.target.value
                  )
                }
              >
                {templates.map(
                  (template) => (
                    <option
                      key={
                        template.template_key
                      }
                      value={
                        template.template_key
                      }
                    >
                      {template.name}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              Steuersatz
              <select
                value={taxRate}
                onChange={(event) =>
                  setTaxRate(
                    Number(
                      event.target.value
                    )
                  )
                }
              >
                {taxRates.map(
                  (rate) => (
                    <option
                      key={rate.id}
                      value={rate.rate}
                    >
                      {rate.label}
                    </option>
                  )
                )}
              </select>
            </label>
          </div>

          {existingInvoice && (
            <div className="invoice-existing-banner">
              <strong>
                Rechnung bereits vorhanden
              </strong>
              <span>
                {existingInvoice.invoice_number} ·{" "}
                {money(
                  existingInvoice.gross_amount
                )}
              </span>
            </div>
          )}
        </section>

        <section className="invoice-section">
          <div className="invoice-section-heading">
            <span>3</span>
            <h3>Positionen</h3>
          </div>

          <div className="invoice-item-table">
            <div className="invoice-item-head">
              <span>Anzahl</span>
              <span>Beschreibung</span>
              <span>Einzelpreis</span>
              <span>Steuer</span>
              <span>Gesamt</span>
            </div>

            <div className="invoice-item-row">
              <strong>
                {selectedBooking
                  ? selectedBooking.ticket_count
                  : "–"}
              </strong>

              <span>
                Ticket{" "}
                {selectedPerformance?.title ??
                  "Veranstaltung"}
              </span>

              <span>
                {selectedBooking
                  ? money(
                      Number(
                        selectedBooking.ticket_price
                      )
                    )
                  : "–"}
              </span>

              <span>
                {taxRate} %
              </span>

              <strong>
                {selectedBooking
                  ? money(ticketGross)
                  : "–"}
              </strong>
            </div>

            <div className="invoice-item-row">
              <strong>1</strong>

              <span>
                Servicepauschale
              </span>

              <span>
                {selectedBooking
                  ? money(serviceGross)
                  : "–"}
              </span>

              <span>
                {taxRate} %
              </span>

              <strong>
                {selectedBooking
                  ? money(serviceGross)
                  : "–"}
              </strong>
            </div>
          </div>
        </section>

        <section className="invoice-bottom-grid">
          <div className="invoice-status-card">
            <div className="invoice-section-heading">
              <span>4</span>
              <h3>Status</h3>
            </div>

            <label className="invoice-check">
              <input
                type="checkbox"
                checked={paid}
                onChange={(event) =>
                  setPaid(
                    event.target.checked
                  )
                }
              />
              Bezahlt
            </label>

            <label className="invoice-check">
              <input
                type="checkbox"
                checked={sent}
                onChange={(event) =>
                  setSent(
                    event.target.checked
                  )
                }
              />
              Verschickt
            </label>

            <label className="invoice-check invoice-check-danger">
              <input
                type="checkbox"
                checked={storno}
                onChange={(event) =>
                  setStorno(
                    event.target.checked
                  )
                }
              />
              Storno / Gesperrt
            </label>
          </div>

          <div className="invoice-notes-card">
            <div className="invoice-section-heading">
              <span>5</span>
              <h3>Anmerkungen</h3>
            </div>

            <textarea
              value={notes}
              onChange={(event) =>
                setNotes(event.target.value)
              }
              placeholder="z. B. keine Mail-Adresse, falsche Mail zurückgekommen, besonderer Hinweis …"
              maxLength={250}
            />

            <div className="invoice-note-count">
              {notes.length}/250
            </div>
          </div>

          <div className="invoice-total-card">
            <div>
              <span>
                Netto
              </span>
              <strong>
                {money(net)}
              </strong>
            </div>

            <div>
              <span>
                MwSt. {taxRate} %
              </span>
              <strong>
                {money(tax)}
              </strong>
            </div>

            <div className="invoice-grand-total">
              <span>
                Brutto
              </span>
              <strong>
                {money(gross)}
              </strong>
            </div>
          </div>
        </section>

        <div className="invoice-actions">
          <button
            type="button"
            className="cancel-button"
            onClick={onClose}
          >
            Abbrechen
          </button>

          <button
            type="button"
            className="preview-button"
            onClick={openPreview}
            disabled={!selectedBooking}
          >
            Vorschau
          </button>

          <button
            type="button"
            className="save-button invoice-create-button"
            onClick={createInvoice}
            disabled={
              loading ||
              !selectedBooking ||
              Boolean(existingInvoice)
            }
          >
            {loading
              ? "Wird erstellt …"
              : existingInvoice
              ? "Bereits fakturiert"
              : "Rechnung erstellen"}
          </button>
        </div>

      </div>
    </div>
  );
}
