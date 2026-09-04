import { useEffect, useMemo, useState, type FormEvent } from "react";

type PublicSeat = {
  id: number;
  row_number: number;
  seat_number: number;
  side: string;
  hall_type: string;
  table_number: number | null;
  table_seat_number: number | null;
  available: boolean;
};

type Availability = {
  performance_id: number;
  seating_mode: "assigned" | "staff_assigned" | "free";
  total_capacity: number;
  available_count: number;
  seats: PublicSeat[];
};

type CheckoutEvent = {
  id: number;
  title: string;
  hall_plan_type: "hall_1" | "hall_2";
  seating_mode: "assigned" | "staff_assigned" | "free";
  max_tickets_per_order: number;
  price_from: number;
  postal_shipping_gross: number;
  postal_shipping_vat_rate: number;
};

type Customer = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  street: string;
  postal_code: string;
  city: string;
};

type PreviewItem = {
  name: string;
  quantity: number;
  gross_each: number;
  gross_total: number;
  vat_rate: number;
  kind: "event" | "service" | "shipping";
};

type CheckoutPreview = {
  valid: boolean;
  test_mode: boolean;
  event_title: string;
  quantity: number;
  seat_ids: number[];
  delivery_method: "email" | "postal";
  customer_email: string;
  items: PreviewItem[];
  total_gross: number;
  message: string;
};

type CheckoutSessionResult = {
  status: "pending" | "paid" | "expired" | "cancelled" | "failed";
  paid: boolean;
  total_gross: number;
  customer_email: string;
  delivery_method: DeliveryMethod;
  booking_number: string | null;
  event_title: string;
  test_mode: boolean;
};

type CheckoutReservation = {
  reservation_id: string;
  expires_at: string;
  remaining_seconds: number;
  quantity: number;
  seat_ids: number[];
};

type Props = {
  event: CheckoutEvent;
  apiBase: string;
};

type CheckoutStep = "tickets" | "customer" | "review" | "complete";
type DeliveryMethod = "email" | "postal";

const EMPTY_CUSTOMER: Customer = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  street: "",
  postal_code: "",
  city: "",
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatCountdown(value: number) {
  const safeValue = Math.max(0, value);
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function seatLabel(seat: PublicSeat) {
  if (seat.table_number && seat.table_seat_number) {
    return `Tisch ${seat.table_number}, Platz ${seat.table_seat_number}`;
  }
  return `Reihe ${seat.row_number}, Platz ${seat.seat_number}`;
}

export default function CheckoutFlow({ event, apiBase }: Props) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [selectedSeatIds, setSelectedSeatIds] = useState<number[]>([]);
  const [freeQuantity, setFreeQuantity] = useState(1);
  const [step, setStep] = useState<CheckoutStep>("tickets");
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("email");
  const [customer, setCustomer] = useState<Customer>(EMPTY_CUSTOMER);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [reservationId, setReservationId] = useState("");
  const [reservationExpiresAt, setReservationExpiresAt] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(14 * 60);
  const [reserving, setReserving] = useState(false);
  const [sessionResult, setSessionResult] =
    useState<CheckoutSessionResult | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState("");
  const [checkingSession, setCheckingSession] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const maxTickets = Math.max(
    1,
    Math.min(event.max_tickets_per_order || 10, 50),
  );

  async function loadAvailability() {
    setLoadingAvailability(true);
    setAvailabilityError("");

    try {
      const reservationQuery = reservationId
        ? `?reservation_id=${encodeURIComponent(reservationId)}`
        : "";
      const response = await fetch(
        `${apiBase}/api/public/events/${event.id}/availability${reservationQuery}`,
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.detail || "Die verfügbaren Plätze konnten nicht geladen werden.",
        );
      }

      const nextAvailability = data as Availability;
      setAvailability(nextAvailability);
      setSelectedSeatIds((current) =>
        current.filter((seatId) =>
          nextAvailability.seats.some(
            (seat) => seat.id === seatId && seat.available,
          ),
        ),
      );
      setFreeQuantity((current) =>
        Math.max(
          1,
          Math.min(
            current,
            maxTickets,
            Math.max(1, nextAvailability.available_count),
          ),
        ),
      );
    } catch (error) {
      setAvailabilityError(
        error instanceof Error
          ? error.message
          : "Die verfügbaren Plätze konnten nicht geladen werden.",
      );
    } finally {
      setLoadingAvailability(false);
    }
  }

  useEffect(() => {
    void loadAvailability();
  }, [event.id]);

  useEffect(() => {
    if (!reservationId || !reservationExpiresAt || step === "complete") return;

    let releaseStarted = false;
    const updateCountdown = () => {
      const expiresAt = new Date(reservationExpiresAt).getTime();
      const nextRemaining = Math.max(
        0,
        Math.ceil((expiresAt - Date.now()) / 1000),
      );
      setRemainingSeconds(nextRemaining);

      if (nextRemaining === 0 && !releaseStarted) {
        releaseStarted = true;
        const expiredReservationId = reservationId;
        setReservationId("");
        setReservationExpiresAt("");
        setSelectedSeatIds([]);
        setPreview(null);
        setStep("tickets");
        setMessage(
          "Ihre Reservierungszeit ist abgelaufen. Die Tickets wurden wieder freigegeben.",
        );
        void fetch(
          `${apiBase}/api/public/checkout/orders/${expiredReservationId}/cancel`,
          { method: "POST" },
        ).finally(() => loadAvailability());
      }
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [reservationId, reservationExpiresAt, step, apiBase]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const checkoutReturn = query.get("checkout");

    if (checkoutReturn === "success") {
      const sessionId = query.get("session_id") || "";
      setStep("complete");
      setSessionResult(null);
      setSessionError("");
      setCheckoutSessionId(sessionId);
      if (sessionId) {
        void loadCheckoutResult(sessionId);
      } else {
        setSessionError("Die Stripe-Testsession fehlt in der Rückkehradresse.");
      }
      return;
    }

    if (checkoutReturn === "cancelled") {
      const orderId = query.get("order_id") || "";
      setMessage("Die Testzahlung wurde abgebrochen. Es wurde nichts berechnet.");
      window.history.replaceState({}, "", window.location.pathname);
      if (orderId) {
        void fetch(`${apiBase}/api/public/checkout/orders/${orderId}/cancel`, {
          method: "POST",
        }).finally(() => loadAvailability());
      }
    }
  }, [event.id, apiBase]);

  const selectedSeats = useMemo(
    () =>
      (availability?.seats || []).filter((seat) =>
        selectedSeatIds.includes(seat.id),
      ),
    [availability, selectedSeatIds],
  );

  const quantity =
    event.seating_mode === "assigned"
      ? selectedSeatIds.length
      : freeQuantity;

  const shippingGross =
    deliveryMethod === "postal"
      ? Number(event.postal_shipping_gross || 0)
      : 0;

  const estimatedTotal =
    Math.round((event.price_from * quantity + shippingGross) * 100) / 100;

  function toggleSeat(seat: PublicSeat) {
    setMessage("");
    if (!seat.available) return;

    setSelectedSeatIds((current) => {
      if (current.includes(seat.id)) {
        return current.filter((seatId) => seatId !== seat.id);
      }
      if (current.length >= maxTickets) {
        setMessage(
          `Pro Bestellung können höchstens ${maxTickets} Plätze ausgewählt werden.`,
        );
        return current;
      }
      return [...current, seat.id];
    });
  }

  async function continueToCustomer() {
    setMessage("");
    if (!availability || availability.available_count < 1) {
      setMessage("Für diese Veranstaltung sind keine Plätze mehr verfügbar.");
      return;
    }
    if (quantity < 1) {
      setMessage(
        event.seating_mode === "assigned"
          ? "Bitte mindestens einen freien Sitzplatz auswählen."
          : "Bitte mindestens ein Ticket auswählen.",
      );
      return;
    }

    setReserving(true);
    try {
      const response = await fetch(`${apiBase}/api/public/checkout/reservation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          performance_id: event.id,
          quantity,
          seat_ids: selectedSeatIds,
          reservation_id: reservationId,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.reservation_id || !data?.expires_at) {
        throw new Error(
          data?.detail || "Die Tickets konnten nicht reserviert werden.",
        );
      }

      const reservation = data as CheckoutReservation;
      setReservationId(reservation.reservation_id);
      setReservationExpiresAt(reservation.expires_at);
      setRemainingSeconds(reservation.remaining_seconds);
      setStep("customer");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Die Tickets konnten nicht reserviert werden.",
      );
      await loadAvailability();
    } finally {
      setReserving(false);
    }
  }

  function updateCustomer(field: keyof Customer, value: string) {
    setCustomer((current) => ({ ...current, [field]: value }));
  }

  async function requestPreview(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSubmitting(true);
    setMessage("");
    setPreview(null);

    try {
      const response = await fetch(`${apiBase}/api/public/checkout/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          performance_id: event.id,
          quantity,
          seat_ids: selectedSeatIds,
          reservation_id: reservationId,
          delivery_method: deliveryMethod,
          customer,
          accepted_terms: acceptedTerms,
          accepted_privacy: acceptedPrivacy,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.detail || "Die Testbestellung konnte nicht geprüft werden.",
        );
      }
      setPreview(data as CheckoutPreview);
      setStep("review");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Die Testbestellung konnte nicht geprüft werden.",
      );
      await loadAvailability();
    } finally {
      setSubmitting(false);
    }
  }

  async function startStripeCheckout() {
    setSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(`${apiBase}/api/public/checkout/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          performance_id: event.id,
          quantity,
          seat_ids: selectedSeatIds,
          reservation_id: reservationId,
          delivery_method: deliveryMethod,
          customer,
          accepted_terms: acceptedTerms,
          accepted_privacy: acceptedPrivacy,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.checkout_url) {
        throw new Error(
          data?.detail || "Stripe Checkout konnte nicht geöffnet werden.",
        );
      }
      window.location.assign(data.checkout_url);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Stripe Checkout konnte nicht geöffnet werden.",
      );
      setSubmitting(false);
      await loadAvailability();
    }
  }

  async function loadCheckoutResult(sessionId: string) {
    setCheckingSession(true);
    setSessionError("");

    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          const response = await fetch(
            `${apiBase}/api/public/checkout/session/${encodeURIComponent(sessionId)}`,
          );
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(
              data?.detail || "Der Zahlungsstatus konnte nicht geladen werden.",
            );
          }

          const result = data as CheckoutSessionResult;
          setSessionResult(result);
          if (result.status !== "pending") {
            window.history.replaceState({}, "", window.location.pathname);
            return;
          }
        } catch (error) {
          if (attempt === 7) {
            setSessionError(
              error instanceof Error
                ? error.message
                : "Der Zahlungsstatus konnte nicht geladen werden.",
            );
            return;
          }
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }

      setSessionError(
        "Stripe verarbeitet die Zahlung noch. Bitte den Status erneut prüfen.",
      );
    } finally {
      setCheckingSession(false);
    }
  }

  function restart() {
    setStep("tickets");
    setSelectedSeatIds([]);
    setFreeQuantity(1);
    setDeliveryMethod("email");
    setCustomer(EMPTY_CUSTOMER);
    setAcceptedTerms(false);
    setAcceptedPrivacy(false);
    setPreview(null);
    setReservationId("");
    setReservationExpiresAt("");
    setRemainingSeconds(14 * 60);
    setReserving(false);
    setSessionResult(null);
    setCheckoutSessionId("");
    setCheckingSession(false);
    setSessionError("");
    setMessage("");
    window.history.replaceState({}, "", window.location.pathname);
    void loadAvailability();
  }

  function renderReservationTimer() {
    if (!reservationId || !reservationExpiresAt || step === "complete") {
      return null;
    }

    return (
      <div
        className={`reservation-timer ${remainingSeconds <= 120 ? "urgent" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span>Ihre Tickets sind reserviert</span>
        <strong>{formatCountdown(remainingSeconds)}</strong>
        <small>Danach werden die Tickets automatisch wieder freigegeben.</small>
      </div>
    );
  }

  function renderHallPlan() {
    if (!availability) return null;

    if (event.hall_plan_type === "hall_2") {
      const tables = Array.from(
        new Set(
          availability.seats
            .map((seat) => seat.table_number)
            .filter((value): value is number => Boolean(value)),
        ),
      ).sort((a, b) => a - b);

      return (
        <div className="public-table-plan">
          <div className="public-stage">Bühne</div>
          <div className="public-tables-grid">
            {tables.map((tableNumber) => (
              <section className="public-table" key={tableNumber}>
                <strong>Tisch {tableNumber}</strong>
                <div>
                  {availability.seats
                    .filter((seat) => seat.table_number === tableNumber)
                    .sort(
                      (a, b) =>
                        Number(a.table_seat_number) -
                        Number(b.table_seat_number),
                    )
                    .map((seat) => (
                      <SeatButton
                        key={seat.id}
                        seat={seat}
                        selected={selectedSeatIds.includes(seat.id)}
                        onSelect={toggleSeat}
                      />
                    ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      );
    }

    const seatsByPosition = new Map(
      availability.seats.map((seat) => [
        `${seat.row_number}-${seat.seat_number}`,
        seat,
      ] as const),
    );

    function renderSeatAt(rowNumber: number, seatNumber: number) {
      const seat = seatsByPosition.get(`${rowNumber}-${seatNumber}`);

      if (!seat) {
        return (
          <span
            className="public-seat-placeholder"
            key={`${rowNumber}-${seatNumber}`}
            aria-hidden="true"
          />
        );
      }

      return (
        <SeatButton
          key={seat.id}
          seat={seat}
          selected={selectedSeatIds.includes(seat.id)}
          onSelect={toggleSeat}
        />
      );
    }

    function renderStandardRow(rowNumber: number) {
      return (
        <div className="public-seat-row" key={rowNumber}>
          <span className="public-row-number">{rowNumber}</span>
          <div className="public-seat-group public-seat-group-left">
            {[12, 11, 10, 9, 8, 7].map((seatNumber) =>
              renderSeatAt(rowNumber, seatNumber),
            )}
          </div>
          <div className="public-middle-aisle" aria-label="Mittelgang" />
          <div className="public-seat-group public-seat-group-right">
            {[6, 5, 4, 3, 2, 1].map((seatNumber) =>
              renderSeatAt(rowNumber, seatNumber),
            )}
          </div>
          <span className="public-row-number">{rowNumber}</span>
        </div>
      );
    }

    return (
      <div className="public-hall-plan">
        <div className="public-stage">Bühne</div>
        <div className="public-seat-map-viewport">
          <div className="public-seat-map">
            {[[1], [2, 3], [4, 5], [6, 7]].map((rowGroup) => (
              <section
                className="public-seat-block"
                key={rowGroup.join("-")}
              >
                {rowGroup.map(renderStandardRow)}
              </section>
            ))}

            <section className="public-lower-seat-block">
              <div className="public-technology" aria-label="Technikbereich">
                Technik
              </div>

              <div className="public-seat-row public-seat-row-eight">
                <span className="public-row-number">8</span>
                <div className="public-seat-group public-seat-group-left">
                  {[12, 11, 10, 9, 8, 7].map((seatNumber) =>
                    renderSeatAt(8, seatNumber),
                  )}
                </div>
                <div className="public-middle-aisle" aria-label="Mittelgang" />
                <div className="public-seat-group public-seat-group-right">
                  {[6, 5, 4, 3, 2, 1].map((seatNumber) =>
                    renderSeatAt(8, seatNumber),
                  )}
                </div>
                <span className="public-row-number">8</span>
              </div>

              <div className="public-seat-row public-seat-row-nine">
                <span className="public-row-number">9</span>
                <div className="public-seat-group public-seat-group-nine">
                  {[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(
                    (seatNumber) => renderSeatAt(9, seatNumber),
                  )}
                </div>
                <span className="public-row-number">9</span>
              </div>
            </section>
          </div>
        </div>
        <p className="public-seat-scroll-hint">
          Seitlich wischen, um alle Plätze zu sehen.
        </p>
      </div>
    );
  }

  if (loadingAvailability && step !== "complete") {
    return (
      <div className="checkout-flow checkout-loading">
        Verfügbarkeit wird geprüft …
      </div>
    );
  }

  if (step !== "complete" && (availabilityError || !availability)) {
    return (
      <div className="checkout-flow">
        <div className="checkout-message error">
          {availabilityError || "Die Verfügbarkeit konnte nicht geladen werden."}
        </div>
        <button type="button" className="secondary-action" onClick={loadAvailability}>
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (step === "complete") {
    const paymentConfirmed = sessionResult?.status === "paid";
    const paymentFailed = ["expired", "cancelled", "failed"].includes(
      sessionResult?.status || "",
    );
    const paymentPending = !paymentConfirmed && !paymentFailed;
    const statusTone = paymentConfirmed
      ? "success"
      : paymentFailed
        ? "failed"
        : "processing";

    return (
      <div className="checkout-flow checkout-complete" aria-live="polite">
        <span className={`complete-mark ${statusTone}`}>
          {paymentConfirmed ? "✓" : paymentFailed ? "!" : "…"}
        </span>
        <span className="checkout-kicker">
          {paymentConfirmed
            ? "Zahlung bestätigt"
            : paymentFailed
              ? "Zahlung nicht abgeschlossen"
              : "Zahlung wird geprüft"}
        </span>
        <h3>
          {paymentConfirmed
            ? "Bestellung abgeschlossen"
            : paymentFailed
              ? "Bestellung fehlgeschlagen"
              : "Einen Moment bitte …"}
        </h3>
        {paymentConfirmed ? (
          <>
            <p>
              Vielen Dank! Ihre Zahlung wurde bestätigt. Ihre Buchungsnummer lautet
              {" "}<strong>{sessionResult?.booking_number}</strong>.
            </p>
            <p>
              {sessionResult?.delivery_method === "email"
                ? "Ihre Tickets werden an die angegebene E-Mail-Adresse gesendet."
                : "Ihre Tickets werden für den Postversand vorbereitet."}
            </p>
            <strong>{formatMoney(sessionResult?.total_gross || 0)}</strong>
          </>
        ) : paymentFailed ? (
          <p>
            Die Zahlung wurde nicht abgeschlossen. Es wurde keine bezahlte
            Bestellung angelegt. Sie können zur Veranstaltung zurückkehren und den
            Vorgang erneut beginnen.
          </p>
        ) : (
          <p>
            Wir gleichen die Zahlungsbestätigung sicher mit Stripe ab. Bitte laden
            Sie die Seite nicht neu und starten Sie keine zweite Zahlung.
          </p>
        )}
        {sessionError && paymentPending && (
          <div className="checkout-message warning">
            Der Status ist momentan nicht erreichbar. Ihre Zahlung kann trotzdem
            erfolgreich sein. Bitte prüfen Sie den Status erneut und bezahlen Sie
            nicht noch einmal.
          </div>
        )}
        <div className="checkout-complete-actions">
          {paymentPending && checkoutSessionId && (
            <button
              type="button"
              className="primary-action wide"
              disabled={checkingSession}
              onClick={() => void loadCheckoutResult(checkoutSessionId)}
            >
              {checkingSession ? "Zahlung wird geprüft …" : "Zahlungsstatus erneut prüfen"}
            </button>
          )}
          {!paymentPending && (
            <button type="button" className="primary-action wide" onClick={restart}>
              {paymentConfirmed ? "Zurück zur Veranstaltung" : "Erneut versuchen"}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!availability) return null;

  if (step === "review" && preview) {
    return (
      <div className="checkout-flow">
        <StepHeader current={3} />
        {renderReservationTimer()}
        <div className="checkout-section-heading">
          <div>
            <span className="checkout-kicker">Bestellung prüfen</span>
            <h3>Alles richtig?</h3>
          </div>
          <button type="button" className="text-action" onClick={() => setStep("customer")}>
            Bearbeiten
          </button>
        </div>

        <div className="checkout-review-card">
          <strong>{preview.quantity} Ticket{preview.quantity === 1 ? "" : "s"}</strong>
          {selectedSeats.length > 0 && (
            <p>{selectedSeats.map(seatLabel).join(" · ")}</p>
          )}
          <span>
            {preview.delivery_method === "postal"
              ? "Versand per Post"
              : `E-Tickets an ${preview.customer_email}`}
          </span>
        </div>

        <div className="checkout-total-list">
          {preview.items.map((item, index) => (
            <div key={`${item.kind}-${item.name}-${index}`}>
              <span>
                {item.name}
                {item.kind !== "service" && (
                  <small>
                    {item.quantity} × {formatMoney(item.gross_each)} · {item.vat_rate} % MwSt.
                  </small>
                )}
              </span>
              <strong>{formatMoney(item.gross_total)}</strong>
            </div>
          ))}
          <div className="checkout-grand-total">
            <span>Gesamtbetrag</span>
            <strong>{formatMoney(preview.total_gross)}</strong>
          </div>
        </div>

        <div className="checkout-test-note">
          <strong>Sicherer Stripe-Testmodus</strong>
          <span>Stripe verwendet Testdaten. Es wird kein echtes Geld abgebucht.</span>
        </div>
        {message && <div className="checkout-message error">{message}</div>}
        <button
          type="button"
          className="primary-action wide"
          onClick={startStripeCheckout}
          disabled={submitting}
        >
          {submitting ? "Stripe wird geöffnet …" : "Im Stripe-Testmodus bezahlen"}
        </button>
      </div>
    );
  }

  if (step === "customer") {
    return (
      <form className="checkout-flow" onSubmit={requestPreview}>
        <StepHeader current={2} />
        {renderReservationTimer()}
        <div className="checkout-section-heading">
          <div>
            <span className="checkout-kicker">Kontaktdaten</span>
            <h3>Wohin dürfen die Tickets?</h3>
          </div>
          <button type="button" className="text-action" onClick={() => setStep("tickets")}>
            Zurück
          </button>
        </div>

        <div className="delivery-options">
          <label className={deliveryMethod === "email" ? "selected" : ""}>
            <input
              type="radio"
              name="delivery"
              value="email"
              checked={deliveryMethod === "email"}
              onChange={() => setDeliveryMethod("email")}
            />
            <span><strong>E-Ticket per E-Mail</strong><small>Kostenfrei und direkt verfügbar</small></span>
            <b>0,00 €</b>
          </label>
          <label className={deliveryMethod === "postal" ? "selected" : ""}>
            <input
              type="radio"
              name="delivery"
              value="postal"
              checked={deliveryMethod === "postal"}
              onChange={() => setDeliveryMethod("postal")}
            />
            <span><strong>Versand per Post</strong><small>Versandpauschale einmal je Bestellung</small></span>
            <b>{formatMoney(event.postal_shipping_gross || 0)}</b>
          </label>
        </div>

        <div className="checkout-fields two-columns">
          <label>
            <span>Vorname</span>
            <input
              required
              autoComplete="given-name"
              value={customer.first_name}
              onChange={(input) => updateCustomer("first_name", input.target.value)}
            />
          </label>
          <label>
            <span>Nachname</span>
            <input
              required
              autoComplete="family-name"
              value={customer.last_name}
              onChange={(input) => updateCustomer("last_name", input.target.value)}
            />
          </label>
          <label>
            <span>E-Mail-Adresse</span>
            <input
              required
              type="email"
              autoComplete="email"
              value={customer.email}
              onChange={(input) => updateCustomer("email", input.target.value)}
            />
          </label>
          <label>
            <span>Telefon <small>optional</small></span>
            <input
              type="tel"
              autoComplete="tel"
              value={customer.phone}
              onChange={(input) => updateCustomer("phone", input.target.value)}
            />
          </label>
        </div>

        {deliveryMethod === "postal" && (
          <div className="checkout-fields address-fields">
            <label>
              <span>Straße und Hausnummer</span>
              <input
                required
                autoComplete="street-address"
                value={customer.street}
                onChange={(input) => updateCustomer("street", input.target.value)}
              />
            </label>
            <label>
              <span>PLZ</span>
              <input
                required
                autoComplete="postal-code"
                value={customer.postal_code}
                onChange={(input) => updateCustomer("postal_code", input.target.value)}
              />
            </label>
            <label>
              <span>Ort</span>
              <input
                required
                autoComplete="address-level2"
                value={customer.city}
                onChange={(input) => updateCustomer("city", input.target.value)}
              />
            </label>
          </div>
        )}

        <div className="checkout-consents">
          <label>
            <input
              type="checkbox"
              required
              checked={acceptedTerms}
              onChange={(input) => setAcceptedTerms(input.target.checked)}
            />
            <span>
              Ich bestätige die Bestellbedingungen. Die Karten sind aus
              organisatorischen Gründen vom Umtausch ausgeschlossen.
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              required
              checked={acceptedPrivacy}
              onChange={(input) => setAcceptedPrivacy(input.target.checked)}
            />
            <span>Ich habe die Datenschutzhinweise gelesen.</span>
          </label>
        </div>

        <OrderEstimate
          quantity={quantity}
          ticketsGross={event.price_from * quantity}
          shippingGross={shippingGross}
          totalGross={estimatedTotal}
        />
        {message && <div className="checkout-message error">{message}</div>}
        <button type="submit" className="primary-action wide" disabled={submitting}>
          {submitting ? "Bestellung wird geprüft …" : "Weiter zur Bestellübersicht"}
        </button>
      </form>
    );
  }

  return (
    <div className="checkout-flow">
      <StepHeader current={1} />
      {renderReservationTimer()}
      <div className="checkout-section-heading">
        <div>
          <span className="checkout-kicker">
            {event.seating_mode === "assigned" ? "Sitzplatzwahl" : "Ticketanzahl"}
          </span>
          <h3>
            {event.seating_mode === "assigned"
              ? "Ihre Plätze auswählen"
              : "Wie viele Tickets?"}
          </h3>
        </div>
        <button type="button" className="text-action" onClick={loadAvailability}>
          Aktualisieren
        </button>
      </div>

      <div className="availability-line">
        <span className="availability-dot" />
        <strong>{availability.available_count}</strong>
        <span>von {availability.total_capacity} Plätzen verfügbar</span>
      </div>

      {event.seating_mode === "assigned" ? (
        <>
          <div className="seat-legend">
            <span><i className="free" />Frei</span>
            <span><i className="selected" />Ausgewählt</span>
            <span><i className="occupied" />Belegt</span>
          </div>
          {renderHallPlan()}
          <div className="selected-seat-summary">
            <strong>
              {selectedSeats.length
                ? `${selectedSeats.length} Platz${selectedSeats.length === 1 ? "" : "e"} ausgewählt`
                : "Noch keinen Platz ausgewählt"}
            </strong>
            {selectedSeats.length > 0 && (
              <span>{selectedSeats.map(seatLabel).join(" · ")}</span>
            )}
          </div>
        </>
      ) : (
        <>
          {event.seating_mode === "staff_assigned" && (
            <div className="staff-assignment-note">
              <strong>Wir übernehmen die Platzzuweisung</strong>
              <span>
                Wählen Sie nur die gewünschte Ticketanzahl. Ihre konkreten Plätze
                werden anschließend vom Theater vergeben und mit der Bestätigung
                mitgeteilt.
              </span>
            </div>
          )}
          <label className="quantity-field checkout-quantity">
            <span>Anzahl Tickets</span>
            <select
              value={freeQuantity}
              onChange={(input) => setFreeQuantity(Number(input.target.value))}
              disabled={availability.available_count < 1}
            >
              {Array.from(
                {
                  length: Math.min(
                    maxTickets,
                    availability.available_count,
                  ),
                },
                (_, index) => index + 1,
              ).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        </>
      )}

      <OrderEstimate
        quantity={quantity}
        ticketsGross={event.price_from * quantity}
        shippingGross={0}
        totalGross={event.price_from * quantity}
      />
      {message && <div className="checkout-message error">{message}</div>}
      <button
        type="button"
        className="primary-action wide"
        onClick={continueToCustomer}
        disabled={availability.available_count < 1 || quantity < 1 || reserving}
      >
        {reserving ? "Tickets werden reserviert …" : "Weiter zu den Kundendaten"}
      </button>
    </div>
  );
}

function SeatButton({
  seat,
  selected,
  onSelect,
}: {
  seat: PublicSeat;
  selected: boolean;
  onSelect: (seat: PublicSeat) => void;
}) {
  const number = seat.table_seat_number || seat.seat_number;
  return (
    <button
      type="button"
      className={[
        "public-seat",
        selected ? "selected" : "",
        seat.available ? "free" : "occupied",
      ].filter(Boolean).join(" ")}
      disabled={!seat.available}
      title={`${seatLabel(seat)} – ${seat.available ? "frei" : "belegt"}`}
      aria-label={`${seatLabel(seat)}, ${seat.available ? "frei" : "belegt"}`}
      aria-pressed={selected}
      onClick={() => onSelect(seat)}
    >
      {number}
    </button>
  );
}

function StepHeader({ current }: { current: number }) {
  return (
    <ol className="checkout-steps" aria-label="Bestellschritte">
      {["Tickets", "Kontaktdaten", "Prüfen"].map((label, index) => {
        const step = index + 1;
        return (
          <li
            key={label}
            className={step === current ? "active" : step < current ? "done" : ""}
          >
            <span>{step < current ? "✓" : step}</span>
            <small>{label}</small>
          </li>
        );
      })}
    </ol>
  );
}

function OrderEstimate({
  quantity,
  ticketsGross,
  shippingGross,
  totalGross,
}: {
  quantity: number;
  ticketsGross: number;
  shippingGross: number;
  totalGross: number;
}) {
  return (
    <div className="order-estimate">
      <div>
        <span>{quantity || 0} Ticket{quantity === 1 ? "" : "s"}</span>
        <strong>{formatMoney(ticketsGross)}</strong>
      </div>
      {shippingGross > 0 && (
        <div>
          <span>Versandpauschale</span>
          <strong>{formatMoney(shippingGross)}</strong>
        </div>
      )}
      <div className="estimate-total">
        <span>Gesamtbetrag</span>
        <strong>{formatMoney(totalGross)}</strong>
      </div>
    </div>
  );
}
