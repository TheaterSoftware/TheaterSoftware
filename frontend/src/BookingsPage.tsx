import TischsaalPlan from "./TischsaalPlan";
import BookingEditPanel from "./BookingEditPanel";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

type Performance = {
  id: number;
  title: string;
  performance_date: string;
  start_time: string;
  hall_plan_type?: "hall_1" | "hall_2";
};

type Booking = {
  id: number;
  booking_number: string;
  customer_id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  street: string;
  postal_code: string;
  city: string;
  notes: string;
  performance_id: number;
    free_seating?: boolean;
ticket_count: number;
  ticket_price: number;
  service_fee: number;
  status: string;
};

type Props = {
  onBack: () => void;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value: string) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  return date.toLocaleDateString("de-DE");
}

function statusClass(status: string) {
  const value = status.toLowerCase();

  if (
    value.includes("storno") ||
    value.includes("gesperrt")
  ) {
    return "booking-status booking-status-red";
  }

  if (value.includes("bezahlt")) {
    return "booking-status booking-status-green";
  }

  if (
    value.includes("hinterlegt") ||
    value.includes("ak")
  ) {
    return "booking-status booking-status-blue";
  }

  if (
    value.includes("verschickt") ||
    value.includes("erinnert")
  ) {
    return "booking-status booking-status-yellow";
  }

  return "booking-status booking-status-lila";
}

export default function BookingsPage({
  onBack,
}: Props) {
  const [bookings, setBookings] = useState<Booking[]>(
    [],
  );

  const [performances, setPerformances] = useState<
    Performance[]
  >([]);

  const [search, setSearch] = useState("");
  const [performanceFilter, setPerformanceFilter] =
    useState("all");

  const [showNewPerson, setShowNewPerson] =
    useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [selectedPerformanceId, setSelectedPerformanceId] =
    useState("");

  const [ticketCount, setTicketCount] =
    useState("1");

  const [ticketPrice, setTicketPrice] =
    useState("79.90");

  const [serviceFee, setServiceFee] =
    useState("3.50");

  const [freeSeating, setFreeSeating] =
    useState(false);

  const [seatStatistics, setSeatStatistics] =
    useState({
      total: 0,
      occupied: 0,
      free: 0,
    });

  const [seatPreviewAssignments, setSeatPreviewAssignments] =
    useState<
      {
        seat_id: number;
        booking_id: number;
        status: string;
      }[]
    >([]);

  const [seatPreviewLoading, setSeatPreviewLoading] =
    useState(false);

  const [notes, setNotes] = useState("");

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editingBooking, setEditingBooking] =
    useState<Booking | null>(null);


  useEffect(() => {
    let cancelled = false;

    async function loadSeatPreview() {
      if (!selectedPerformanceId) {
        setSeatPreviewAssignments([]);
        return;
      }

      setSeatPreviewLoading(true);

      try {
        const response = await fetch(
          `/api/assignments?performance_id=${selectedPerformanceId}`,
        );

        if (!response.ok) {
          throw new Error(
            `Sitzplatzbelegung konnte nicht geladen werden: HTTP ${response.status}`,
          );
        }

        const data = await response.json();

        if (!cancelled) {
          setSeatPreviewAssignments(
            Array.isArray(data) ? data : [],
          );
        }
      } catch (error) {
        if (!cancelled) {
          setSeatPreviewAssignments([]);
          console.error(
            "Live-Saalplan konnte nicht geladen werden:",
            error,
          );
        }
      } finally {
        if (!cancelled) {
          setSeatPreviewLoading(false);
        }
      }
    }

    void loadSeatPreview();

    return () => {
      cancelled = true;
    };
  }, [selectedPerformanceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadSeatStatistics() {
      if (!selectedPerformanceId) {
        setSeatStatistics({
          total: 0,
          occupied: 0,
          free: 0,
        });
        return;
      }

      try {
        const performance =
          performances.find(
            (item) =>
              String(item.id) ===
              String(selectedPerformanceId),
          );

        const total =
          performance?.hall_plan_type === "hall_2"
            ? 160
            : 106;

        const response = await fetch(
          `/api/assignments?performance_id=${selectedPerformanceId}`,
        );

        if (!response.ok) {
          throw new Error(
            `Assignments konnten nicht geladen werden: HTTP ${response.status}`,
          );
        }

        const data = await response.json();

        const assignments =
          Array.isArray(data)
            ? data
            : [];

        // Stornierte Plätze sind wieder frei.
        const activeSeatIds = new Set(
          assignments
            .filter(
              (item) =>
                item.status !== "storniert",
            )
            .map(
              (item) =>
                Number(item.seat_id),
            ),
        );

        const occupied =
          activeSeatIds.size;

        if (!cancelled) {
          setSeatStatistics({
            total,
            occupied,
            free: Math.max(
              total - occupied,
              0,
            ),
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error(
            "Sitzplatzstatistik konnte nicht geladen werden:",
            error,
          );

          setSeatStatistics({
            total: 0,
            occupied: 0,
            free: 0,
          });
        }
      }
    }

    void loadSeatStatistics();

    return () => {
      cancelled = true;
    };
  }, [
    selectedPerformanceId,
    performances,
  ]);

  async function loadData() {
    setLoading(true);

    try {
      const [
        bookingsResponse,
        performancesResponse,
      ] = await Promise.all([
        fetch("/api/bookings"),
        fetch("/api/performances"),
      ]);

      if (!bookingsResponse.ok) {
        throw new Error(
          `Buchungen konnten nicht geladen werden: HTTP ${bookingsResponse.status}`,
        );
      }

      if (!performancesResponse.ok) {
        throw new Error(
          `Vorstellungen konnten nicht geladen werden: HTTP ${performancesResponse.status}`,
        );
      }

      const bookingsData =
        await bookingsResponse.json();

      const performancesData =
        await performancesResponse.json();

      setBookings(bookingsData);
      setPerformances(performancesData);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Daten konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const selectedPerformance =
    performances.find(
      (performance) =>
        String(performance.id) ===
        String(selectedPerformanceId),
    );

  const performanceMap = useMemo(() => {
    return new Map(
      performances.map((performance) => [
        performance.id,
        performance,
      ]),
    );
  }, [performances]);

  const filteredBookings = useMemo(() => {
    const term = search
      .trim()
      .toLowerCase();

    return bookings.filter((booking) => {
      const performance =
        performanceMap.get(
          booking.performance_id,
        );

      const matchesPerformance =
        performanceFilter === "all" ||
        String(booking.performance_id) ===
          performanceFilter;

      const searchable = [
        booking.booking_number,
        booking.first_name,
        booking.last_name,
        booking.email,
        booking.phone,
        booking.street,
        booking.postal_code,
        booking.city,
        booking.notes,
        performance?.title ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return (
        matchesPerformance &&
        (!term || searchable.includes(term))
      );
    });
  }, [
    bookings,
    performanceFilter,
    performanceMap,
    search,
  ]);

  function resetNewPersonForm() {
    setFirstName("");
    setLastName("");
    setStreet("");
    setPostalCode("");
    setCity("");
    setEmail("");
    setPhone("");
    setSelectedPerformanceId("");
    setTicketCount("1");
    setTicketPrice("79.90");
    setServiceFee("3.50");
    setFreeSeating(false);
    setNotes("");
  }

  async function handleCreateBooking(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setMessage("");

    if (!selectedPerformanceId) {
      setMessage(
        "Für eine echte Buchung muss zuerst eine Vorstellung ausgewählt werden.",
      );
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(
        "/api/bookings",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            email,
            phone,
            street,
            postal_code: postalCode,
            city,
            notes: [
              notes.trim(),
              freeSeating
                ? "Freie Platzwahl"
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
            performance_id:
              Number(
                selectedPerformanceId,
              ),
            ticket_count:
              Number(ticketCount),
            ticket_price:
              Number(ticketPrice),
            service_fee:
              Number(serviceFee),
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

      await loadData();

      resetNewPersonForm();
      setShowNewPerson(false);

      setMessage(
        "Person / Buchung wurde erfolgreich gespeichert.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Person / Buchung konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bookings-page">
      <div className="bookings-page-inner">
        <header className="bookings-page-header">
          <button
            type="button"
            className="bookings-back-button"
            onClick={onBack}
          >
            ← Zurück
          </button>

          <div className="bookings-page-title">
            <h1>Buchungen</h1>
            <p>
              Personen, Buchungen und
              Rechnungsdaten verwalten.
            </p>
          </div>

          <button
            type="button"
            className="bookings-primary-button"
            onClick={() => {
              setMessage("");
              setShowNewPerson(true);
            }}
          >
            + Neue Person
          </button>
        </header>

        <section className="bookings-toolbar">
          <input
            type="search"
            placeholder="Name, R.Nr., E-Mail, Telefon ..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />

          <select
            value={performanceFilter}
            onChange={(event) =>
              setPerformanceFilter(
                event.target.value,
              )
            }
          >
            <option value="all">
              Alle Vorstellungen
            </option>

            {performances.map(
              (performance) => (
                <option
                  key={performance.id}
                  value={performance.id}
                >
                  {formatDate(
                    performance.performance_date,
                  )}
                  {" · "}
                  {performance.title}
                </option>
              ),
            )}
          </select>
        </section>

        {message && (
          <div className="bookings-message">
            {message}
          </div>
        )}

        {showNewPerson && (
          <section className="booking-editor">
            <div className="booking-editor-header">
              <div>
                <h2>
                  Neue Person / Buchung
                </h2>

                <p>
                  Name, Adresse, Kontakt,
                  Show, Anzahl und Preise.
                </p>
              </div>

              <button
                type="button"
                className="bookings-secondary-button"
                onClick={() => {
                  setShowNewPerson(false);
                  resetNewPersonForm();
                }}
              >
                Abbrechen
              </button>
            </div>

            <form
              onSubmit={handleCreateBooking}
            >
              <div className="booking-form-grid">
                <label>
                  Vorname
                  <input
                    required
                    value={firstName}
                    onChange={(event) =>
                      setFirstName(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <label>
                  Nachname
                  <input
                    required
                    value={lastName}
                    onChange={(event) =>
                      setLastName(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <label className="booking-form-wide">
                  Straße + Hausnummer
                  <input
                    value={street}
                    onChange={(event) =>
                      setStreet(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <label>
                  PLZ
                  <input
                    value={postalCode}
                    onChange={(event) =>
                      setPostalCode(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <label>
                  Ort
                  <input
                    value={city}
                    onChange={(event) =>
                      setCity(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <label>
                  E-Mail
                  <input
                    type="email"
                    value={email}
                    onChange={(event) =>
                      setEmail(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <label>
                  Telefon
                  <input
                    value={phone}
                    onChange={(event) =>
                      setPhone(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <label>
                  Show
                  <select
                    value={selectedPerformanceId}
                    onChange={(event) =>
                      setSelectedPerformanceId(
                        event.target.value,
                      )
                    }
                  >
                    <option value="">
                      Show auswählen
                    </option>

                    {performances.map(
                      (performance) => (
                        <option
                          key={performance.id}
                          value={performance.id}
                        >
                          {formatDate(
                            performance.performance_date,
                          )}
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
                    type="number"
                    min="1"
                    value={ticketCount}
                    onChange={(event) =>
                      setTicketCount(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <label>
                  Preis / Ticket
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={ticketPrice}
                    onChange={(event) =>
                      setTicketPrice(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <label>
                  VVK + Versand / Service
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={serviceFee}
                    onChange={(event) =>
                      setServiceFee(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <div className="booking-seat-choice-row">
                  <button
                    type="button"
                    className="bookings-seat-button"
                    disabled={!selectedPerformanceId}
                    onClick={() => {
                      setMessage("");
                    }}
                  >
                    Saalplan – Plätze auswählen
                  </button>

                  {selectedPerformanceId &&
                    seatStatistics.total > 0 && (
                    <div className="booking-seat-inline-statistics">
                      <span>
                        Gesamt:{" "}
                        <strong>
                          {seatStatistics.total}
                        </strong>
                      </span>

                      <span>
                        Belegt:{" "}
                        <strong>
                          {seatStatistics.occupied}
                        </strong>
                      </span>

                      <span>
                        Frei:{" "}
                        <strong>
                          {seatStatistics.free}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>

                {selectedPerformanceId &&
                  selectedPerformance?.hall_plan_type ===
                    "hall_2" && (
                    <div className="booking-seat-preview">
                      <div className="booking-seat-preview-header">
                        <strong>
                          Aktueller Saalplan
                        </strong>

                        <span>
                          {seatPreviewLoading
                            ? "Belegung wird geladen ..."
                            : `${seatPreviewAssignments.length} belegte Plätze`}
                        </span>
                      </div>

                      {!seatPreviewLoading && (
                        <div className="booking-seat-preview-plan">
                          <TischsaalPlan
                            assignments={
                              seatPreviewAssignments
                            }
                          />
                        </div>
                      )}
                    </div>
                  )}

                <label className="booking-checkbox">
                  <input
                    type="checkbox"
                    checked={freeSeating}
                    onChange={(event) =>
                      setFreeSeating(
                        event.target.checked,
                      )
                    }
                  />
                  <span>
                    Freie Platzwahl
                  </span>
                </label>

                <label className="booking-form-wide">
                  Anmerkungen
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(event) =>
                      setNotes(
                        event.target.value,
                      )
                    }
                    placeholder="Interne Hinweise ..."
                  />
                </label>
              </div>

              <div className="booking-editor-footer">
                <button
                  type="submit"
                  className="bookings-primary-button"
                  disabled={saving}
                >
                  {saving
                    ? "Speichern ..."
                    : "Person / Buchung speichern"}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="booking-table-wrap">
          <div className="booking-table-header">
            <span>R.Nr.</span>
            <span>Name + Adresse</span>
            <span>Kontakt</span>
            <span>Anzahl</span>
            <span>
              Preis inkl. VVK + Versand
            </span>
            <span>Rechnungsdatum</span>
            <span>Anmerkungen</span>
            <span>Status</span>
            <span />
          </div>

          {loading ? (
            <div className="booking-empty">
              Buchungen werden geladen ...
            </div>
          ) : filteredBookings.length ===
            0 ? (
            <div className="booking-empty">
              Keine passenden Buchungen gefunden.
            </div>
          ) : (
            filteredBookings.map(
              (booking) => {
                const performance =
                  performanceMap.get(
                    booking.performance_id,
                  );

                const total =
                  booking.ticket_count *
                    booking.ticket_price +
                  booking.service_fee;

                return (
                  <div
                    className="booking-table-row"
                    key={booking.id}
                  >
                    <div>
                      <strong>
                        {booking.booking_number}
                      </strong>

                      <small>
                        {performance?.title ??
                          "Keine Show"}
                      </small>
                    </div>

                    <div>
                      <strong>
                        {booking.first_name}{" "}
                        {booking.last_name}
                      </strong>

                      <small>
                        {booking.street}
                        {booking.street &&
                        (booking.postal_code ||
                          booking.city)
                          ? ", "
                          : ""}
                        {booking.postal_code}
                        {" "}
                        {booking.city}
                      </small>
                    </div>

                    <div>
                      <small>
                        {booking.email ||
                          "Keine E-Mail"}
                      </small>

                      <small>
                        {booking.phone ||
                          "Keine Telefonnummer"}
                      </small>
                    </div>

                    <div>
                      <strong>
                        {booking.ticket_count}
                      </strong>
                    </div>

                    <div>
                      <strong>
                        {formatMoney(total)}
                      </strong>

                      <small>
                        {formatMoney(
                          booking.ticket_price,
                        )}
                        {" / Ticket"}
                      </small>
                    </div>

                    <div>
                      <span>—</span>
                    </div>

                    <div>
                      <span>
                        {booking.notes || "—"}
                      </span>
                    </div>

                    <div>
                      <span
                        className={statusClass(
                          booking.status,
                        )}
                      >
                        {booking.status ||
                          "offen"}
                      </span>
                    </div>

                    <div className="booking-actions">
                      <button
                        type="button"
                        className="bookings-secondary-button"
                        onClick={() =>
                          setEditingBooking(booking)
                        }
                      >
                        Bearbeiten
                      </button>

                      {editingBooking?.id === booking.id && (
                        <BookingEditPanel
                          booking={editingBooking}
                          performances={performances}
                          onClose={() =>
                            setEditingBooking(null)
                          }
                          onSaved={(message) => {
                            setEditingBooking(null);
                            setMessage(message);
                            void loadData();
                          }}
                        />
                      )}

                      <button
                        type="button"
                        className="bookings-invoice-button"
                        onClick={() =>
                          setMessage(
                            `Rechnung für ${booking.booking_number} wird als nächster Schritt verbunden.`,
                          )
                        }
                      >
                        Rechnung
                      </button>
                    </div>
                  </div>
                );
              },
            )
          )}
        </section>
      </div>
    </div>
  );
}
