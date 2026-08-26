import type { DragEvent } from "react";

type TableDefinition = {
  number: number;
  x: number;
  y: number;
};

type SeatDefinition = {
  number: number;
  angle: number;
};

type TischsaalSeat = {
  id: number;
  row_number: number;
  seat_number: number;
  side: string;
  is_active: boolean;
};

type TischsaalPlanProps = {
  onSeatClick?: (seat: TischsaalSeat) => void;
  onSeatDrop?: (seatId: number, bookingId: number) => void;
  draggedBookingId?: number | null;

  assignments?: {
    seat_id: number;
    status: string;
  }[];
};

const tables: TableDefinition[] = [
  { number: 14, x: 11.0, y: 18.0 },
  { number: 13, x: 22.0, y: 18.5 },
  { number: 15, x: 15.0, y: 29.0 },
  { number: 12, x: 27.0, y: 29.5 },
  { number: 16, x: 9.5, y: 39.0 },
  { number: 11, x: 41.5, y: 27.0 },
  { number: 10, x: 50.5, y: 32.0 },
  { number: 9, x: 59.0, y: 36.5 },
  { number: 8, x: 69.0, y: 39.0 },
  { number: 5, x: 67.0, y: 67.0 },
  { number: 2, x: 80.5, y: 64.5 },
  { number: 4, x: 74.5, y: 77.0 },
  { number: 1, x: 90.0, y: 74.0 },
  { number: 7, x: 61.5, y: 84.0 },
  { number: 3, x: 82.0, y: 86.0 },
  { number: 6, x: 71.5, y: 91.0 },
];

const seats: SeatDefinition[] = [
  { number: 1, angle: -90 },
  { number: 2, angle: -54 },
  { number: 3, angle: -18 },
  { number: 4, angle: 18 },
  { number: 5, angle: 54 },
  { number: 6, angle: 90 },
  { number: 7, angle: 126 },
  { number: 8, angle: 162 },
  { number: 9, angle: 198 },
  { number: 10, angle: 234 },
];

const SEAT_RADIUS = 34;

/*
 * Die 160 Tischsaalplätze wurden in der Datenbank
 * mit IDs 108-267 angelegt:
 *
 * Tisch 1:
 *   Platz 1 = 108
 *   Platz 10 = 117
 *
 * Tisch 2:
 *   Platz 1 = 118
 *   ...
 *
 * Deshalb kann die echte DB-ID hier eindeutig
 * aus Tisch + Platz bestimmt werden.
 */
function getTischSeat(
  tableNumber: number,
  seatNumber: number,
): TischsaalSeat {
  return {
    id:
      108 +
      (tableNumber - 1) * 10 +
      (seatNumber - 1),

    row_number: 1000 + tableNumber,

    seat_number: seatNumber,

    side: `Tisch ${tableNumber}`,

    is_active: true,
  };
}

function getSeatPosition(angle: number) {
  const radians = (angle * Math.PI) / 180;

  return {
    left: `calc(50% + ${Math.cos(radians) * SEAT_RADIUS}px)`,
    top: `calc(50% + ${Math.sin(radians) * SEAT_RADIUS}px)`,
  };
}

export default function TischsaalPlan({
  onSeatClick,
  onSeatDrop,
  draggedBookingId = null,
  assignments = [],

}: TischsaalPlanProps) {
  function handleDragOver(
    event: DragEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(
    event: DragEvent<HTMLButtonElement>,
    seatId: number,
  ) {
    event.preventDefault();

    const rawBookingId =
      event.dataTransfer.getData("text/plain");

    const transferBookingId = Number(
      rawBookingId,
    );

    const bookingId =
      Number.isFinite(draggedBookingId) &&
      Number(draggedBookingId) > 0
        ? Number(draggedBookingId)
        : transferBookingId;

    if (
      onSeatDrop &&
      Number.isFinite(bookingId) &&
      bookingId > 0
    ) {
      onSeatDrop(
        seatId,
        bookingId,
      );
    }
  }

  return (
    <div className="tischsaal-clean-wrapper">
      <div className="tischsaal-clean-plan">

        <div className="tischsaal-clean-stage">
          Bühne
        </div>

        <div className="tischsaal-clean-entrance">
          Eingang
        </div>

        {tables.map((table) => (
          <div
            key={table.number}
            className="tischsaal-clean-table"
            style={{
              left: `${table.x}%`,
              top: `${table.y}%`,
            }}
          >

            <div className="tischsaal-clean-table-circle">
              {table.number}
            </div>

            {seats.map((seat) => {
              const dbSeat = getTischSeat(
                table.number,
                seat.number,
              );

              /*
               * Echte Buchungszuweisung dieses Platzes.
               * Wir verwenden dbSeat.id, NICHT eine
               * selbst berechnete Platznummer.
               */
              const seatAssignment =
                assignments.find(
                  (assignment) =>
                    Number(assignment.seat_id) ===
                    Number(dbSeat.id),
                );

              const seatStatus =
                String(
                  seatAssignment?.status ?? "frei",
                )
                  .toLowerCase()
                  .trim();

              const seatStatusClass =
                seatStatus === "reserviert"
                  ? "seat-reserviert"
                  : seatStatus === "bezahlt"
                    ? "seat-bezahlt"
                    : seatStatus === "hinterlegt"
                      ? "seat-hinterlegt"
                      : seatStatus === "storniert"
                        ? "seat-storniert"
                        : "seat-free";

              return (
                <button
                  key={`${table.number}-${seat.number}`}
                  type="button"
                  className={`tischsaal-clean-seat ${seatStatusClass}`}
                  style={getSeatPosition(seat.angle)}
                  onClick={() => {
                    console.log(
                      "Tischsaal Platz ausgewählt:",
                      dbSeat,
                    );

                    onSeatClick?.(dbSeat);
                  }}
                  onDragOver={handleDragOver}
                  onDrop={(event) =>
                    handleDrop(
                      event,
                      dbSeat.id,
                    )
                  }
                  title={
                    `Tisch ${table.number}, Platz ${seat.number}`
                  }
                  aria-label={
                    `Tisch ${table.number}, Platz ${seat.number}`
                  }
                >
                  {seat.number}
                </button>
              );
            })}

          </div>
        ))}

      </div>

      <div className="tischsaal-clean-info">
        <strong>Tischsaal</strong>

        <span>
          16 Tische · 10 Plätze pro Tisch · 160 Plätze
        </span>
      </div>
    </div>
  );
}
