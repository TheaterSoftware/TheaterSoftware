import TischsaalPlan from "./TischsaalPlan";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

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

type Props = {
  booking: Booking;
  onClose: () => void;
};

export default function BookingSeatPlanModal({
  booking,
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

  const [hallPlanType, setHallPlanType] =
    useState<"hall_1" | "hall_2">("hall_1");

  async function loadPlan() {
    try {
      setLoading(true);
      setMessage("");

      const [
        seatsResponse,
        assignmentsResponse,
        performancesResponse,
      ] = await Promise.all([
        fetch("/api/seats"),
        fetch(
          `/api/assignments?performance_id=${booking.performance_id}`,
        ),
        fetch("/api/performances"),
      ]);

      const seatsData =
        await seatsResponse.json().catch(() => null);

      const assignmentsData =
        await assignmentsResponse.json().catch(() => null);

      const performancesData =
        await performancesResponse.json().catch(() => null);

      const performanceList =
        Array.isArray(performancesData)
          ? performancesData
          : Array.isArray(performancesData?.performances)
            ? performancesData.performances
            : [];

      const currentPerformance =
        performanceList.find(
          (item: {
            id?: number | string;
            hall_plan_type?: string;
          }) =>
            Number(item.id) ===
            Number(booking.performance_id),
        );

      setHallPlanType(
        currentPerformance?.hall_plan_type === "hall_2"
          ? "hall_2"
          : "hall_1",
      );

      if (!seatsResponse.ok) {
        throw new Error(
          seatsData?.detail ??
            `Sitze konnten nicht geladen werden: HTTP ${seatsResponse.status}`,
        );
      }

      if (!assignmentsResponse.ok) {
        throw new Error(
          assignmentsData?.detail ??
            `Belegungen konnten nicht geladen werden: HTTP ${assignmentsResponse.status}`,
        );
      }

      const nextSeats = Array.isArray(seatsData)
        ? seatsData
        : [];

      const nextAssignments =
        Array.isArray(assignmentsData)
          ? assignmentsData
          : [];

      setSeats(nextSeats);
      setAssignments(nextAssignments);

      setSelectedSeatIds(
        nextAssignments
          .filter(
            (assignment: Assignment) =>
              assignment.booking_id === booking.id,
          )
          .map(
            (assignment: Assignment) =>
              assignment.seat_id,
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
    void loadPlan();
  }, [booking.id, booking.performance_id]);

  const assignmentBySeat = useMemo(() => {
    const map = new Map<number, Assignment>();

    assignments.forEach((assignment) => {
      map.set(assignment.seat_id, assignment);
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

    const mine =
      assignment?.booking_id === booking.id;

    if (assignment && !mine) {
      setMessage(
        `Reihe ${seat.row_number}, Platz ${seat.seat_number} ist bereits vergeben.`,
      );
      return;
    }

    if (selectedSeatIds.includes(seat.id)) {
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
        `Für diese Buchung sind maximal ${booking.ticket_count} Plätze erlaubt.`,
      );
      return;
    }

    setSelectedSeatIds([
      ...selectedSeatIds,
      seat.id,
    ]);

    setMessage("");
  }

  function renderSeat(
    seat: Seat | undefined,
  ) {
    if (!seat) {
      return (
        <div
          className="seat-placeholder"
          key={`empty-${Math.random()}`}
        />
      );
    }

    const assignment =
      assignmentBySeat.get(seat.id);

    const mine =
      assignment?.booking_id === booking.id;

    const selected =
      selectedSeatIds.includes(seat.id);

    let className = "seat seat-free";

    if (assignment) {
      className =
        `seat seat-${assignment.status || "reserved"}`;
    }

    if (mine || selected) {
      className = "seat seat-free seat-booking-selected";
    }

    return (
      <button
        key={seat.id}
        type="button"
        className={className}
        disabled={
          saving ||
          Boolean(assignment && !mine)
        }
        onClick={() => toggleSeat(seat)}
        title={
          mine
            ? "Dieser Platz gehört dieser Buchung."
            : assignment
              ? `Belegt: ${assignment.first_name} ${assignment.last_name}`
              : `Reihe ${seat.row_number}, Platz ${seat.seat_number}`
        }
      >
        {seat.seat_number}
      </button>
    );
  }

  function standardRow(row: number) {
    return (
      <div
        className="seat-grid-row"
        key={row}
      >
        <div className="row-number">
          {row}
        </div>

        <div className="seat-group">
          {[12, 11, 10, 9, 8, 7].map(
            (number) =>
              renderSeat(
                getSeat(row, number),
              ),
          )}
        </div>

        <div className="middle-gap" />

        <div className="seat-group">
          {[6, 5, 4, 3, 2, 1].map(
            (number) =>
              renderSeat(
                getSeat(row, number),
              ),
          )}
        </div>

        <div className="row-number">
          {row}
        </div>
      </div>
    );
  }

  function rowEight() {
    return (
      <div className="lower-row row-eight">
        <div className="row-number">
          8
        </div>

        <div />

        <div className="seat-group row-eight-left">
          {[10, 9, 8, 7].map(
            (number) =>
              renderSeat(
                getSeat(8, number),
              ),
          )}
        </div>

        <div className="lower-gap" />

        <div className="seat-group row-eight-right">
          {[6, 5, 4, 3, 2, 1].map(
            (number) =>
              renderSeat(
                getSeat(8, number),
              ),
          )}
        </div>

        <div className="row-number">
          8
        </div>
      </div>
    );
  }

  function rowNine() {
    return (
      <div className="lower-row row-nine">

        <div className="row-number">
          9
        </div>

        <div />

        <div className="seat-group row-nine-group">
          {[
            12,
            11,
            10,
            9,
            8,
            7,
            6,
            5,
            4,
            3,
            2,
            1,
          ].map(
            (number) =>
              renderSeat(
                getSeat(
                  9,
                  number
                )
              )
          )}
        </div>

        <div className="row-number">
          9
        </div>

      </div>
    );
  }

  async function saveSeats() {
    setSaving(true);
    setMessage("");

    try {
      const currentIds =
        assignments
          .filter(
            (assignment) =>
              assignment.booking_id ===
              booking.id,
          )
          .map(
            (assignment) =>
              assignment.seat_id,
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
          await response.json().catch(() => null);

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
              item.booking_id === booking.id &&
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

        const data =
          await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            data?.detail ??
              `Platz konnte nicht freigegeben werden: HTTP ${response.status}`,
          );
        }
      }

      await loadPlan();

      setMessage(
        "Sitzplätze wurden gespeichert.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Sitzplätze konnten nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="booking-plan-overlay"
      onClick={onClose}
    >
      <div
        className="booking-plan-modal"
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <div className="booking-plan-header">
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
          </div>

          <button
            type="button"
            className="bookings-secondary-button"
            onClick={onClose}
          >
            Schließen
          </button>
        </div>

        <div className="booking-plan-summary">
          <strong>
            {selectedSeatIds.length}
          </strong>
          {" / "}
          {booking.ticket_count}
          {" Plätze ausgewählt"}
        </div>

        {message && (
          <div className="bookings-message">
            {message}
          </div>
        )}

        {loading ? (
          <div className="booking-plan-loading">
            Saalplan wird geladen ...
          </div>
        ) : (
          hallPlanType === "hall_2" ? (
            <div className="booking-plan-content">
              <main className="booking-plan-main">
                <TischsaalPlan
                  assignments={assignments}
                  onSeatClick={(seat) => {
                    toggleSeat(seat);
                  }}
                />
              </main>

              <aside className="booking-plan-sidebar">
                <h3>
                  Platzstatus
                </h3>

                <div className="booking-plan-legend">
                  <div>
                    <span className="booking-plan-legend-free" />
                    Frei
                  </div>

                  <div>
                    <span className="booking-plan-legend-mine" />
                    Diese Buchung
                  </div>

                  <div>
                    <span className="booking-plan-legend-occupied" />
                    Andere Buchung
                  </div>
                </div>

                <p>
                  Der Tischsaal verwendet die
                  Belegungen dieser Vorstellung.
                </p>
              </aside>
            </div>
          ) : (
            <div className="booking-plan-content">
              <main className="booking-plan-main">
                <div className="booking-plan-stage">
                  BÜHNE
                </div>

                {standardRow(1)}
                {standardRow(2)}
                {standardRow(3)}
                {standardRow(4)}
                {standardRow(5)}
                {standardRow(6)}
                {standardRow(7)}

                <div className="booking-lower-wrapper">
                  <div className="booking-plan-technik">
                    Technik
                  </div>

                  {rowEight()}
                  {rowNine()}
                </div>
              </main>

              <aside className="booking-plan-sidebar">
                <h3>
                  Platzstatus
                </h3>

                <div className="booking-plan-legend">
                  <div>
                    <span className="booking-plan-legend-free" />
                    Frei
                  </div>

                  <div>
                    <span className="booking-plan-legend-mine" />
                    Diese Buchung
                  </div>

                  <div>
                    <span className="booking-plan-legend-occupied" />
                    Andere Buchung
                  </div>
                </div>

                <p>
                  Der Plan wird anhand der
                  Belegungen dieser Vorstellung
                  geladen.
                </p>
              </aside>
            </div>
          )
        )}

        <div className="booking-plan-footer">
          <button
            type="button"
            className="bookings-secondary-button"
            onClick={onClose}
          >
            Abbrechen
          </button>

          <button
            type="button"
            className="bookings-primary-button"
            disabled={
              saving ||
              loading ||
              selectedSeatIds.length >
                booking.ticket_count
            }
            onClick={() =>
              void saveSeats()
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
