import {
  useState,
  type FormEvent,
} from "react";

import BookingSeatPlanModal from "./BookingSeatPlanModal";

type Booking = {
  id: number;
  booking_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  street: string;
  postal_code: string;
  city: string;
  notes: string;
  performance_id: number;
  ticket_count: number;
  ticket_price: number;
  service_fee: number;
  free_seating?: boolean;
};

type Performance = {
  id: number;
  title: string;
  performance_date?: string;
  start_time?: string;
  date?: string;
  time?: string;
  price_from?: number;
  service_fee_percent?: number;
  price_breakdown?: {
    ticket_total_gross?: number;
    subtotal_gross?: number;
    additional_gross?: number;
    service_fee_percent?: number;
  };
};

function performanceTicketPrice(performance?: Performance) {
  const ticketTotal = Number(performance?.price_breakdown?.ticket_total_gross);
  if (Number.isFinite(ticketTotal) && ticketTotal >= 0) return ticketTotal;
  const subtotal = Number(performance?.price_breakdown?.subtotal_gross);
  if (Number.isFinite(subtotal) && subtotal >= 0) return subtotal;
  return Math.round(Number(performance?.price_from || 0) * 100) / 100;
}

function performanceAdditionalPrice(performance?: Performance) {
  const additional = Number(performance?.price_breakdown?.additional_gross);
  return Number.isFinite(additional) && additional > 0 ? additional : 0;
}

function performanceServiceFee(
  performance: Performance | undefined,
  ticketPrice: number,
  ticketCount: number,
) {
  const percentage = Number(
    performance?.service_fee_percent
      ?? performance?.price_breakdown?.service_fee_percent
      ?? 0,
  );
  const normalizedPercentage = Number.isFinite(percentage)
    ? Math.min(100, Math.max(0, percentage))
    : 0;
  return Math.round(
    ticketPrice * Math.max(1, ticketCount) * normalizedPercentage,
  ) / 100;
}

type Props = {
  booking: Booking;
  performances: Performance[];
  onClose: () => void;
  onSaved: (
    message: string,
  ) => void;
};

export default function BookingEditPanel({
  booking,
  performances,
  onClose,
  onSaved,
}: Props) {
  const [freeSeating, setFreeSeating] =
    useState(
      Boolean(
        booking.free_seating,
      ),
    );

  const [
    selectedPerformanceId,
    setSelectedPerformanceId,
  ] = useState(
    String(
      booking.performance_id,
    ),
  );

  const [ticketCount, setTicketCount] = useState(booking.ticket_count);
  const [ticketPrice, setTicketPrice] = useState(booking.ticket_price);
  const [serviceFee, setServiceFee] = useState(booking.service_fee);

  const [
    showSeatPlan,
    setShowSeatPlan,
  ] = useState(false);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formData =
      new FormData(
        event.currentTarget,
      );

    setSaving(true);
    setError("");

    try {
      const response =
        await fetch(
          `/api/bookings/${booking.id}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              first_name:
                String(
                  formData.get(
                    "first_name",
                  ) ?? "",
                ),
              last_name:
                String(
                  formData.get(
                    "last_name",
                  ) ?? "",
                ),
              email:
                String(
                  formData.get(
                    "email",
                  ) ?? "",
                ),
              phone:
                String(
                  formData.get(
                    "phone",
                  ) ?? "",
                ),
              street:
                String(
                  formData.get(
                    "street",
                  ) ?? "",
                ),
              postal_code:
                String(
                  formData.get(
                    "postal_code",
                  ) ?? "",
                ),
              city:
                String(
                  formData.get(
                    "city",
                  ) ?? "",
                ),
              notes:
                String(
                  formData.get(
                    "notes",
                  ) ?? "",
                ),
              ticket_count:
                ticketCount,
              ticket_price:
                ticketPrice,
              service_fee:
                serviceFee,
              performance_id:
                Number(selectedPerformanceId) ||
                booking.performance_id,
              free_seating:
                freeSeating,
            }),
          },
        );

      const data =
        await response
          .json()
          .catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `HTTP ${response.status}`,
        );
      }

      let message =
        "Buchung wurde gespeichert.";

      if (
        data?.seat_assignments_cleared
      ) {
        message +=
          " Die bisherigen Sitzplätze wurden freigegeben und können für die neue Vorstellung neu vergeben werden.";
      }

      onSaved(message);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Buchung konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBooking() {
    const confirmed = window.confirm(
      `Buchung ${booking.booking_number} wirklich löschen?\n\n` +
      `Die Buchung und ihre Sitzplatzzuweisungen werden endgültig gelöscht.\n\n` +
      `Dieser Vorgang kann nicht rückgängig gemacht werden.`,
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        `/api/bookings/${booking.id}`,
        {
          method: "DELETE",
        },
      );

      const data = await response
        .json()
        .catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ??
            `Löschen fehlgeschlagen (HTTP ${response.status})`,
        );
      }

      onSaved("Buchung wurde gelöscht.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Buchung konnte nicht gelöscht werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className="booking-simple-edit-overlay"
        onClick={onClose}
      >
        <div
          className="booking-simple-edit-modal"
          onClick={(event) =>
            event.stopPropagation()
          }
        >
          <div className="booking-simple-edit-header">
            <div>
              <h2>
                Buchung bearbeiten
              </h2>

              <p>
                {booking.booking_number}
              </p>
            </div>

            <button
              type="button"
              className="bookings-secondary-button"
              onClick={onClose}
            >
              Schließen
            </button>
          </div>

          {error && (
            <div className="bookings-message">
              {error}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
          >
            <div className="booking-simple-edit-grid">

              <label>
                Vorname
                <input
                  name="first_name"
                  required
                  defaultValue={
                    booking.first_name
                  }
                />
              </label>

              <label>
                Nachname
                <input
                  name="last_name"
                  required
                  defaultValue={
                    booking.last_name
                  }
                />
              </label>

              <label className="booking-form-wide">
                Straße + Hausnummer
                <input
                  name="street"
                  defaultValue={
                    booking.street
                  }
                />
              </label>

              <label>
                PLZ
                <input
                  name="postal_code"
                  defaultValue={
                    booking.postal_code
                  }
                />
              </label>

              <label>
                Ort
                <input
                  name="city"
                  defaultValue={
                    booking.city
                  }
                />
              </label>

              <label>
                E-Mail
                <input
                  name="email"
                  type="email"
                  defaultValue={
                    booking.email
                  }
                />
              </label>

              <label>
                Telefon
                <input
                  name="phone"
                  defaultValue={
                    booking.phone
                  }
                />
              </label>

              <label className="booking-form-wide">
                Vorstellung / Event
                <select
                  value={
                    selectedPerformanceId
                  }
                  onChange={(event) => {
                    const nextPerformanceId = Number(event.target.value);
                    setSelectedPerformanceId(
                      event.target.value,
                    );

                    if (nextPerformanceId === booking.performance_id) {
                      setTicketPrice(booking.ticket_price);
                      setServiceFee(booking.service_fee);
                    } else {
                      const nextPerformance = performances.find((item) => item.id === nextPerformanceId);
                      const nextTicketPrice = performanceTicketPrice(nextPerformance);
                      setTicketPrice(nextTicketPrice);
                      setServiceFee(
                        performanceServiceFee(
                          nextPerformance,
                          nextTicketPrice + performanceAdditionalPrice(nextPerformance),
                          ticketCount,
                        ),
                      );
                    }

                    if (
                      nextPerformanceId !==
                      booking.performance_id
                    ) {
                      setShowSeatPlan(false);
                    }
                  }}
                >
                  {performances.map(
                    (performance) => (
                      <option
                        key={performance.id}
                        value={
                          performance.id
                        }
                      >
                        {performance.date ??
                          performance.performance_date ??
                          ""}
                        {" · "}
                        {performance.time ??
                          performance.start_time?.slice(
                            0,
                            5,
                          ) ??
                          ""}
                        {" · "}
                        {performance.title}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label>
                Anzahl
                <input
                  name="ticket_count"
                  type="number"
                  min="1"
                  value={ticketCount}
                  onChange={(event) => {
                    const nextCount = Math.max(1, Math.round(Number(event.target.value) || 1));
                    setTicketCount(nextCount);
                    const selectedPerformance = performances.find(
                      (item) => item.id === Number(selectedPerformanceId),
                    );
                    setServiceFee(
                      performanceServiceFee(
                        selectedPerformance,
                        ticketPrice + performanceAdditionalPrice(selectedPerformance),
                        nextCount,
                      ),
                    );
                  }}
                />
              </label>

              <label>
                Ticketpreis je Ticket (ohne Zusatzkosten)
                <input
                  name="ticket_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={ticketPrice}
                  readOnly
                />
                <small>Mit der Buchung fest gespeichert.</small>
              </label>

              <label>
                Servicepauschale
                <input
                  name="service_fee"
                  type="number"
                  step="0.01"
                  min="0"
                  value={serviceFee}
                  readOnly
                />
                <small>Versand wird getrennt in der Rechnung gewählt.</small>
              </label>

              <div className="booking-edit-options-row">
                <label className="booking-edit-checkbox">
                  <input
                    type="checkbox"
                    checked={
                      freeSeating
                    }
                    onChange={(event) => {
                      setFreeSeating(
                        event.target.checked,
                      );

                      if (
                        event.target.checked
                      ) {
                        setShowSeatPlan(
                          false,
                        );
                      }
                    }}
                  />

                  <span>
                    Freie Platzwahl
                  </span>
                </label>

                <button
                  type="button"
                  className="bookings-seat-button"
                  disabled={
                    freeSeating ||
                    saving ||
                    !selectedPerformanceId
                  }
                  onClick={() =>
                    setShowSeatPlan(true)
                  }
                >
                  Saalplan – Plätze ändern
                </button>

                {freeSeating && (
                  <span className="booking-edit-hint">
                    Keine feste Sitzplatzzuweisung
                  </span>
                )}
              </div>

              <label className="booking-form-wide">
                Anmerkungen
                <textarea
                  name="notes"
                  rows={4}
                  defaultValue={
                    booking.notes
                  }
                />
              </label>
            </div>

            <div className="booking-simple-edit-footer">
              <button
                type="button"
                className="booking-delete-button"
                onClick={() => void handleDeleteBooking()}
                disabled={saving}
              >
                Buchung löschen
              </button>

              <button
                type="button"
                className="bookings-secondary-button"
                onClick={onClose}
                disabled={saving}
              >
                Abbrechen
              </button>

              <button
                type="submit"
                className="bookings-primary-button"
                disabled={saving}
              >
                {saving
                  ? "Speichern ..."
                  : "Änderungen speichern"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showSeatPlan && (
        <BookingSeatPlanModal
          booking={{
            id: booking.id,
            booking_number:
              booking.booking_number,
            first_name:
              booking.first_name,
            last_name:
              booking.last_name,
            ticket_count:
              booking.ticket_count,
            performance_id:
              Number(
                selectedPerformanceId,
              ),
          }}
          onClose={() =>
            setShowSeatPlan(false)
          }
        />
      )}
    </>
  );
}
