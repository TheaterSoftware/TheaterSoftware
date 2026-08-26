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

type Performance = {
  id: number;
  title: string;
  performance_date: string;
  start_time: string;
};

type Props = {
  performance: Performance;
  ticketCount: number;
  selectedSeatIds: number[];
  onChange: (seatIds: number[]) => void;
  onClose: () => void;
};

function createSeats(): Seat[] {
  const seats: Seat[] = [];
  let id = 1;

  for (let row = 1; row <= 7; row++) {
    for (let number = 1; number <= 12; number++) {
      seats.push({
        id,
        row_number: row,
        seat_number: number,
        side:
          number >= 7
            ? "links"
            : "rechts",
        is_active: true,
      });

      id++;
    }
  }

  for (let number = 1; number <= 10; number++) {
    seats.push({
      id,
      row_number: 8,
      seat_number: number,
      side:
        number >= 7
          ? "links"
          : "rechts",
      is_active: true,
    });

    id++;
  }

  for (let number = 1; number <= 12; number++) {
    seats.push({
      id,
      row_number: 9,
      seat_number: number,
      side: "unten",
      is_active: true,
    });

    id++;
  }

  return seats;
}

const SEATS = createSeats();

export default function BookingSeatPicker({
  performance,
  ticketCount,
  selectedSeatIds,
  onChange,
  onClose,
}: Props) {
  const [assignments, setAssignments] =
    useState<Assignment[]>([]);

  const [message, setMessage] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAssignments() {
      setLoading(true);

      try {
        const response = await fetch(
          `/api/assignments?performance_id=${performance.id}`,
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

        if (!cancelled) {
          setAssignments(
            Array.isArray(data)
              ? data
              : [],
          );
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Sitzplätze konnten nicht geladen werden.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadAssignments();

    return () => {
      cancelled = true;
    };
  }, [performance.id]);

  const assignmentBySeat =
    useMemo(() => {
      const map = new Map<
        number,
        Assignment
      >();

      assignments.forEach(
        (assignment) => {
          map.set(
            assignment.seat_id,
            assignment,
          );
        },
      );

      return map;
    }, [assignments]);

  const selectedSeats =
    useMemo(() => {
      return SEATS.filter((seat) =>
        selectedSeatIds.includes(
          seat.id,
        ),
      );
    }, [selectedSeatIds]);

  const freeCount =
    SEATS.filter(
      (seat) =>
        !assignmentBySeat.has(
          seat.id,
        ),
    ).length;

  function getSeat(
    row: number,
    number: number,
  ) {
    return SEATS.find(
      (seat) =>
        seat.row_number === row &&
        seat.seat_number === number,
    );
  }

  function selectSeat(
    seat: Seat,
  ) {
    const assignment =
      assignmentBySeat.get(
        seat.id,
      );

    if (assignment) {
      setMessage(
        `Reihe ${seat.row_number}, Platz ${seat.seat_number} ist bereits belegt.`,
      );
      return;
    }

    if (
      selectedSeatIds.includes(
        seat.id,
      )
    ) {
      onChange(
        selectedSeatIds.filter(
          (id) =>
            id !== seat.id,
        ),
      );
      setMessage("");
      return;
    }

    if (
      selectedSeatIds.length >=
      ticketCount
    ) {
      setMessage(
        `Für ${ticketCount} Ticket(s) können maximal ${ticketCount} Plätze ausgewählt werden.`,
      );
      return;
    }

    onChange([
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
          aria-hidden="true"
        />
      );
    }

    const assignment =
      assignmentBySeat.get(
        seat.id,
      );

    const selected =
      selectedSeatIds.includes(
        seat.id,
      );

    let className =
      "seat seat-free";

    if (assignment) {
      className =
        "seat seat-reserved";
    } else if (selected) {
      className =
        "seat booking-seat-selected";
    }

    return (
      <div
        key={seat.id}
        className="seat-cell"
      >
        <button
          type="button"
          className={[
          "seat",
          className.includes("mine")
            ? "seat-bezahlt"
            : className.includes("occupied")
              ? "seat-reserviert"
              : "seat-free",
          selected ? "selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
          disabled={
            loading ||
            Boolean(assignment)
          }
          onClick={() =>
            selectSeat(seat)
          }
          aria-label={
            `Reihe ${seat.row_number}, Platz ${seat.seat_number}`
          }
        >
          {seat.seat_number}
        </button>

        {assignment && (
          <span className="seat-tooltip">
            {assignment.last_name}
          </span>
        )}
      </div>
    );
  }

  function standardRow(
    row: number,
  ) {
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
                getSeat(
                  row,
                  number,
                ),
              ),
          )}
        </div>

        <div className="middle-gap" />

        <div className="seat-group">
          {[6, 5, 4, 3, 2, 1].map(
            (number) =>
              renderSeat(
                getSeat(
                  row,
                  number,
                ),
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
                getSeat(
                  8,
                  number,
                ),
              ),
          )}
        </div>

        <div className="lower-gap" />

        <div className="seat-group row-eight-right">
          {[6, 5, 4, 3, 2, 1].map(
            (number) =>
              renderSeat(
                getSeat(
                  8,
                  number,
                ),
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
            12, 11, 10, 9, 8, 7,
            6, 5, 4, 3, 2, 1,
          ].map((number) =>
            renderSeat(
              getSeat(
                9,
                number,
              ),
            ),
          )}
        </div>

        <div className="row-number">
          9
        </div>
      </div>
    );
  }

  return (
    <div className="booking-seat-overlay">
      <div className="booking-seat-modal">

        <div className="booking-seat-modal-header">
          <div>
            <h2>
              Bühnenbild – Plätze auswählen
            </h2>

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
          </div>

          <button
            type="button"
            className="bookings-secondary-button"
            onClick={onClose}
          >
            Fertig
          </button>
        </div>

        <div className="booking-seat-summary">
          <div className="booking-seat-summary-card">
            <span>
              Gesamt
            </span>
            <strong>
              {SEATS.length}
            </strong>
            <small>
              Plätze
            </small>
          </div>

          <div className="booking-seat-summary-card">
            <span>
              Frei
            </span>
            <strong>
              {freeCount}
            </strong>
            <small>
              Plätze
            </small>
          </div>

          <div className="booking-seat-summary-card booking-seat-summary-selected">
            <span>
              Ausgewählt
            </span>
            <strong>
              {selectedSeatIds.length}
              {" / "}
              {ticketCount}
            </strong>
            <small>
              Plätze
            </small>
          </div>
        </div>

        {message && (
          <div className="bookings-message">
            {message}
          </div>
        )}

        <div className="booking-seat-content">
          <main className="hall booking-seat-hall">
            <div className="stage">
              BÜHNE
            </div>

            <div className="seat-plan">
              <section className="plan-block first">
                {standardRow(1)}
              </section>

              <section className="plan-block">
                {standardRow(2)}
                {standardRow(3)}
              </section>

              <section className="plan-block">
                {standardRow(4)}
                {standardRow(5)}
              </section>

              <section className="plan-block">
                {standardRow(6)}
                {standardRow(7)}
              </section>

              <section className="plan-block lower">
                <div className="technology">
                  Technik
                </div>

                {rowEight()}
                {rowNine()}
              </section>
            </div>
          </main>

          <aside className="booking-seat-details">
            <h3>
              Platzzuweisung
            </h3>

            {selectedSeats.length ===
            0 ? (
              <p className="muted">
                Klicke auf einen freien
                Sitzplatz.
              </p>
            ) : (
              <>
                <p>
                  Ausgewählte Plätze:
                </p>

                <div className="booking-selected-seat-list">
                  {selectedSeats.map(
                    (seat) => (
                      <button
                        type="button"
                        key={seat.id}
                        className="booking-selected-seat-chip"
                        onClick={() =>
                          selectSeat(seat)
                        }
                      >
                        Reihe{" "}
                        {seat.row_number}
                        {" · Platz "}
                        {seat.seat_number}
                        {" ×"}
                      </button>
                    ),
                  )}
                </div>
              </>
            )}

            <div className="booking-seat-legend">
              <div>
                <span className="legend-box legend-free" />
                Frei
              </div>

              <div>
                <span className="legend-box legend-selected" />
                Ausgewählt
              </div>

              <div>
                <span className="legend-box legend-occupied" />
                Bereits vergeben
              </div>
            </div>
          </aside>
        </div>

        <div className="booking-seat-modal-footer">
          <strong>
            {selectedSeatIds.length ===
            ticketCount
              ? "Alle benötigten Plätze ausgewählt."
              : `Noch ${
                  ticketCount -
                  selectedSeatIds.length
                } Platz${
                  ticketCount -
                    selectedSeatIds.length ===
                  1
                    ? ""
                    : "e"
                } auswählen.`}
          </strong>

          <button
            type="button"
            className="bookings-primary-button"
            onClick={onClose}
          >
            Auswahl übernehmen
          </button>
        </div>

      </div>
    </div>
  );
}
