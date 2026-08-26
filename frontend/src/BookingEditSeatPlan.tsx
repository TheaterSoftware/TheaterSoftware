import { useEffect, useMemo, useState } from "react";

type Seat = {
  id: number;
  row_number: number;
  seat_number: number;
  side: string;
  is_active: boolean;
};

type Assignment = {
  id: number;
  performance_id: number;
  seat_id: number;
  booking_id: number;
  status: string;
  row_number: number;
  seat_number: number;
  booking_number: string;
  first_name: string;
  last_name: string;
};

type Booking = {
  id: number;
  booking_number: string;
  first_name: string;
  last_name: string;
  ticket_count: number;
  performance_id: number;
};

type Performance = {
  id: number;
  title: string;
  performance_date: string;
  start_time: string;
};

type Props = {
  booking: Booking;
  performance?: Performance;
  onClose: () => void;
};

export default function BookingEditSeatPlan({
  booking,
  performance,
  onClose,
}: Props) {
  const [seats, setSeats] = useState<Seat[]>([]);
  const [assignments, setAssignments] =
    useState<Assignment[]>([]);
  const [selectedSeatIds, setSelectedSeatIds] =
    useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [seatResponse, assignmentResponse] =
        await Promise.all([
          fetch("/api/seats"),
          fetch(
            `/api/assignments?performance_id=${booking.performance_id}`,
          ),
        ]);

      const seatData =
        await seatResponse.json().catch(() => null);

      const assignmentData =
        await assignmentResponse
          .json()
          .catch(() => null);

      if (!seatResponse.ok) {
        throw new Error(
          seatData?.detail ??
            `Sitzplätze konnten nicht geladen werden: HTTP ${seatResponse.status}`,
        );
      }

      if (!assignmentResponse.ok) {
        throw new Error(
          assignmentData?.detail ??
            `Belegungen konnten nicht geladen werden: HTTP ${assignmentResponse.status}`,
        );
      }

      const nextSeats: Seat[] =
        Array.isArray(seatData)
          ? seatData
          : [];

      const nextAssignments: Assignment[] =
        Array.isArray(assignmentData)
          ? assignmentData
          : [];

      setSeats(nextSeats);
      setAssignments(nextAssignments);

      setSelectedSeatIds(
        nextAssignments
          .filter(
            (item) =>
              item.booking_id ===
              booking.id,
          )
          .map(
            (item) => item.seat_id,
          ),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Saalplan konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [booking.id, booking.performance_id]);

  const assignmentBySeat = useMemo(() => {
    const map = new Map<number, Assignment>();

    assignments.forEach((assignment) => {
      map.set(
        assignment.seat_id,
        assignment,
      );
    });

    return map;
  }, [assignments]);

  function getSeat(
    row: number,
    number: number,
  ) {
    return seats.find(
      (seat) =>
        seat.row_number === row &&
        seat.seat_number === number &&
        seat.is_active,
    );
  }

  function toggleSeat(seat: Seat) {
    const assignment =
      assignmentBySeat.get(seat.id);

    if (
      assignment &&
      assignment.booking_id !== booking.id
    ) {
      setMessage(
        `Reihe ${seat.row_number}, Platz ${seat.seat_number} ist bereits vergeben.`,
      );
      return;
    }

    if (
      selectedSeatIds.includes(
        seat.id,
      )
    ) {
      setSelectedSeatIds(
        selectedSeatIds.filter(
          (id) => id !== seat.id,
        ),
      );
      setMessage("");
      return;
    }

    if (
      selectedSeatIds.length >=
      booking.ticket_count
    ) {
      setMessage(
        `Für diese Buchung sind maximal ${booking.ticket_count} Plätze möglich.`,
      );
      return;
    }

    setSelectedSeatIds([
      ...selectedSeatIds,
      seat.id,
    ]);

    setMessage("");
  }

  async function save() {
    setSaving(true);
    setMessage("");

    try {
      const currentIds =
        assignments
          .filter(
            (item) =>
              item.booking_id ===
              booking.id,
          )
          .map(
            (item) => item.seat_id,
          );

      const addIds =
        selectedSeatIds.filter(
          (id) => !currentIds.includes(id),
        );

      const removeIds =
        currentIds.filter(
          (id) =>
            !selectedSeatIds.includes(id),
        );

      if (
        selectedSeatIds.length >
        booking.ticket_count
      ) {
        throw new Error(
          `Maximal ${booking.ticket_count} Plätze erlaubt.`,
        );
      }

      for (const seatId of addIds) {
        const response = await fetch(
          "/api/assignments",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              performance_id:
                booking.performance_id,
              seat_id: seatId,
              booking_id: booking.id,
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
              `Platz konnte nicht zugewiesen werden: HTTP ${response.status}`,
          );
        }
      }

      for (const seatId of removeIds) {
        const assignment =
          assignments.find(
            (item) =>
              item.booking_id ===
                booking.id &&
              item.seat_id === seatId,
          );

        if (!assignment) {
          continue;
        }

        const response = await fetch(
          `/api/assignments/${assignment.id}`,
          {
            method: "DELETE",
          },
        );

        if (!response.ok) {
          const data =
            await response
              .json()
              .catch(() => null);

          throw new Error(
            data?.detail ??
              `Platz konnte nicht freigegeben werden: HTTP ${response.status}`,
          );
        }
      }

      await load();

      setMessage(
        "Sitzplätze wurden gespeichert.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Sitzplätze konnten nicht gespeichert werden.",
      );

      await load();
    } finally {
      setSaving(false);
    }
  }

  function seatButton(
    seat: Seat | undefined,
  ) {
    if (!seat) {
      return (
        <div
          className="booking-seat-empty"
          aria-hidden="true"
        />
      );
    }

    const assignment =
      assignmentBySeat.get(
        seat.id,
      );

    const mine =
      assignment?.booking_id ===
      booking.id;

    const selected =
      selectedSeatIds.includes(
        seat.id,
      );

    let className =
      "booking-seat free";

    if (mine) {
      className =
        "booking-seat mine";
    } else if (assignment) {
      className =
        "booking-seat occupied";
    } else if (selected) {
      className =
        "booking-seat selected";
    }

    return (
      <button
        type="button"
        key={seat.id}
        className={className}
        disabled={
          saving ||
          Boolean(
            assignment &&
              !mine,
          )
        }
        onClick={() =>
          toggleSeat(seat)
        }
        title={
          mine
            ? "Dieser Platz gehört bereits dieser Buchung."
            : assignment
              ? `Belegt: ${assignment.first_name} ${assignment.last_name}`
              : `Reihe ${seat.row_number}, Platz ${seat.seat_number}`
        }
      >
        {seat.seat_number}
      </button>
    );
  }

  function renderRow(row: number) {
    return (
      <div
        className="booking-seat-row"
        key={row}
      >
        <div className="booking-seat-row-number">
          {row}
        </div>

        <div className="booking-seat-group">
          {[12, 11, 10, 9, 8, 7].map(
            (number) =>
              seatButton(
                getSeat(row, number),
              ),
          )}
        </div>

        <div />

        <div className="booking-seat-group">
          {[6, 5, 4, 3, 2, 1].map(
            (number) =>
              seatButton(
                getSeat(row, number),
              ),
          )}
        </div>

        <div className="booking-seat-row-number">
          {row}
        </div>
      </div>
    );
  }

  return (
    <div className="booking-seat-overlay">
      <div className="booking-seat-modal">

        <div className="booking-seat-header">
          <div>
            <h2>
              Saalplan – Plätze ändern
            </h2>

            <p>
              {booking.first_name}{" "}
              {booking.last_name}
              {" · "}
              {booking.booking_number}
            </p>

            {performance && (
              <p>
                {performance.title}
                {" · "}
                {new Date(
                  `${performance.performance_date}T00:00:00`,
                ).toLocaleDateString(
                  "de-DE",
                )}
                {" · "}
                {performance.start_time.slice(
                  0,
                  5,
                )}
              </p>
            )}
          </div>

          <button
            type="button"
            className="bookings-secondary-button"
            onClick={onClose}
          >
            Zurück
          </button>
        </div>

        <div className="booking-seat-info">
          <span>
            Tickets:{" "}
            <strong>
              {booking.ticket_count}
            </strong>
          </span>

          <span>
            Ausgewählt:{" "}
            <strong>
              {selectedSeatIds.length}
            </strong>
          </span>

          <span>
            Frei:{" "}
            <strong>
              {
                seats.filter(
                  (seat) =>
                    seat.is_active &&
                    !assignmentBySeat.has(
                      seat.id,
                    ),
                ).length
              }
            </strong>
          </span>
        </div>

        {message && (
          <div className="bookings-message">
            {message}
          </div>
        )}

        {loading ? (
          <div className="booking-seat-loading">
            Saalplan wird geladen ...
          </div>
        ) : (
          <div className="booking-seat-main">

            <div className="booking-seat-plan">
              <div className="booking-seat-stage">
                BÜHNE
              </div>

              {Array.from(
                { length: 7 },
                (_, index) =>
                  renderRow(
                    index + 1,
                  ),
              )}
            </div>

            <aside className="booking-seat-sidebar">
              <h3>
                Platzzuweisung
              </h3>

              <p>
                Freie Plätze sind anklickbar.
                Plätze anderer Buchungen sind
                gesperrt.
              </p>

              <div className="booking-seat-legend">
                <div>
                  <span className="legend-free" />
                  Frei
                </div>

                <div>
                  <span className="legend-mine" />
                  Diese Buchung
                </div>

                <div>
                  <span className="legend-occupied" />
                  Belegt
                </div>
              </div>
            </aside>

          </div>
        )}

        <div className="booking-seat-footer">
          <strong>
            {selectedSeatIds.length} von{" "}
            {booking.ticket_count} Plätzen
            ausgewählt
          </strong>

          <button
            type="button"
            className="bookings-primary-button"
            disabled={saving}
            onClick={() =>
              void save()
            }
          >
            {saving
              ? "Speichern ..."
              : "Sitzplätze speichern"}
          </button>
        </div>

      </div>
    </div>
  );
}
