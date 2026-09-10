import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./CheckinApp.css";

type CheckinPerformance = {
  id: number;
  title: string;
  performance_date: string | null;
  start_time: string | null;
  venue_name: string;
  hall_plan_type: string;
  ticket_total: number;
  generated_total: number;
  checked_in_total: number;
};

type CheckinResult = {
  status:
    | "checked_in"
    | "already_checked_in"
    | "cancelled"
    | "wrong_event";
  message: string;
  ticket_id: number;
  ticket_index: number;
  ticket_count: number;
  booking_id: number;
  booking_number: string;
  booking_status: string;
  performance_id: number;
  event_title: string;
  event_date: string | null;
  event_time: string | null;
  venue: string;
  customer_name: string;
  seat: string;
  checked_in_at: string | null;
  checked_in_by: string;
};

type HallSeat = {
  seat_id: number;
  row_number: number | null;
  seat_number: number | null;
  side: string;
  hall_type: string;
  table_number: number | null;
  table_seat_number: number | null;
  assignment_id: number | null;
  booking_id: number | null;
  assignment_status: string;
  booking_number: string;
  booking_status: string;
  customer_name: string;
  has_ticket: boolean;
  checked_in: boolean;
  checked_in_at: string | null;
  checked_in_by: string;
  cancelled: boolean;
};

type HallResponse = {
  performance: {
    id: number;
    title: string;
    performance_date: string | null;
    start_time: string | null;
    venue_name: string;
    hall_plan_type: string;
  };
  summary: {
    booked_tickets: number;
    cancelled_tickets: number;
    checked_in_tickets: number;
  };
  seats: HallSeat[];
};

type Props = {
  userName: string;
  onLogout: () => void;
  onBack?: () => void;
};

type ScannerMode = "scanner" | "hall";

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorCtor = new (options: {
  formats: string[];
}) => BarcodeDetectorLike;

function authHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem("theater.loggedInUser");
    const user = raw ? JSON.parse(raw) : null;
    return {
      "X-User-Id": String(user?.user_id ?? ""),
      "X-User-Name": String(
        user?.display_name || user?.username || "Check-in"
      ),
    };
  } catch {
    return {};
  }
}

async function responseError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null);
  if (typeof data?.detail === "string") {
    return data.detail;
  }
  return `Anfrage fehlgeschlagen (${response.status}).`;
}

function formatDate(value: string | null): string {
  if (!value) return "–";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

function formatTime(value: string | null): string {
  if (!value) return "–";
  return `${value.slice(0, 5)} Uhr`;
}

function formatCheckinTime(value: string | null): string {
  if (!value) return "–";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.replace("T", " ").slice(0, 16);
  }
  return parsed.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function seatState(seat: HallSeat): string {
  if (seat.cancelled) return "cancelled";
  if (seat.checked_in) return "checked";
  if (seat.assignment_id) return "booked";
  return "free";
}

function seatTitle(seat: HallSeat): string {
  const place = seat.table_number
    ? `Tisch ${seat.table_number}, Platz ${
        seat.table_seat_number ?? seat.seat_number ?? "–"
      }`
    : `Reihe ${seat.row_number ?? "–"}, Platz ${seat.seat_number ?? "–"}`;

  if (!seat.assignment_id) return `${place} · frei`;
  const checkin = seat.checked_in
    ? ` · eingecheckt ${formatCheckinTime(seat.checked_in_at)}`
    : "";
  return `${place} · ${seat.customer_name || seat.booking_number}${checkin}`;
}

export default function CheckinApp({ userName, onLogout, onBack }: Props) {
  const [performances, setPerformances] = useState<CheckinPerformance[]>([]);
  const [selectedPerformanceId, setSelectedPerformanceId] = useState<number | null>(
    null
  );
  const [mode, setMode] = useState<ScannerMode>("scanner");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const [hall, setHall] = useState<HallResponse | null>(null);
  const [hallLoading, setHallLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanLockRef = useRef(false);
  const lastSeenRef = useRef<{ value: string; at: number } | null>(null);

  const selectedPerformance = useMemo(
    () => performances.find((item) => item.id === selectedPerformanceId) ?? null,
    [performances, selectedPerformanceId]
  );

  const stopCamera = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraRunning(false);
  }, []);

  const refreshPerformances = useCallback(async () => {
    try {
      const response = await fetch("/api/checkin/performances", {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = (await response.json()) as CheckinPerformance[];
      setPerformances(data);
      setSelectedPerformanceId((current) => {
        if (current && data.some((item) => item.id === current)) {
          return current;
        }
        const today = new Date().toISOString().slice(0, 10);
        const next = data.find(
          (item) => (item.performance_date ?? "") >= today
        );
        const fallback = data.length > 0 ? data[data.length - 1] : undefined;
        return next?.id ?? fallback?.id ?? null;
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vorstellungen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshHall = useCallback(async () => {
    if (!selectedPerformanceId) {
      setHall(null);
      return;
    }
    setHallLoading(true);
    try {
      const response = await fetch(
        `/api/checkin/performances/${selectedPerformanceId}/hall`,
        { headers: authHeaders() }
      );
      if (!response.ok) throw new Error(await responseError(response));
      setHall((await response.json()) as HallResponse);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saalplan konnte nicht geladen werden.");
    } finally {
      setHallLoading(false);
    }
  }, [selectedPerformanceId]);

  useEffect(() => {
    void refreshPerformances();
  }, [refreshPerformances]);

  useEffect(() => {
    if (mode === "hall") {
      void refreshHall();
    }
  }, [mode, refreshHall]);

  useEffect(() => stopCamera, [stopCamera]);

  const sendScan = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code || !selectedPerformanceId || scanLockRef.current) return;

      const now = Date.now();
      if (
        lastSeenRef.current?.value === code &&
        now - lastSeenRef.current.at < 5000
      ) {
        return;
      }
      lastSeenRef.current = { value: code, at: now };
      scanLockRef.current = true;
      setScanBusy(true);
      setError("");

      try {
        const response = await fetch("/api/checkin/scan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({
            token: code,
            performance_id: selectedPerformanceId,
          }),
        });
        if (!response.ok) throw new Error(await responseError(response));
        const data = (await response.json()) as CheckinResult;
        setResult(data);
        setManualCode("");

        if ("vibrate" in navigator) {
          navigator.vibrate?.(
            data.status === "checked_in" ? [90, 60, 90] : [280]
          );
        }

        void refreshPerformances();
        if (mode === "hall") void refreshHall();
      } catch (err) {
        setResult(null);
        setError(err instanceof Error ? err.message : "Ticket konnte nicht geprüft werden.");
      } finally {
        setScanBusy(false);
        window.setTimeout(() => {
          scanLockRef.current = false;
        }, 900);
      }
    },
    [mode, refreshHall, refreshPerformances, selectedPerformanceId]
  );

  const cameraLoop = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || !streamRef.current) return;

    if (video.readyState >= 2 && !scanLockRef.current) {
      try {
        const codes = await detector.detect(video);
        const rawValue = codes.find((item) => item.rawValue)?.rawValue;
        if (rawValue) {
          void sendScan(rawValue);
        }
      } catch {
        // Einzelne Frames dürfen fehlschlagen; der Scanner läuft weiter.
      }
    }

    animationRef.current = requestAnimationFrame(() => {
      void cameraLoop();
    });
  }, [sendScan]);

  const startCamera = useCallback(async () => {
    setCameraMessage("");
    setError("");

    if (!selectedPerformanceId) {
      setCameraMessage("Bitte zuerst eine Veranstaltung auswählen.");
      return;
    }
    if (!window.isSecureContext) {
      setCameraMessage(
        "Die Kamera benötigt HTTPS. Auf diesem Gerät kannst du den Code momentan manuell eingeben."
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage("Dieser Browser stellt keinen Kamerazugriff bereit.");
      return;
    }

    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector;
    if (!Detector) {
      setCameraMessage(
        "Dieser Browser unterstützt den eingebauten QR-Scanner noch nicht. Der manuelle Code funktioniert trotzdem."
      );
      return;
    }

    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      detectorRef.current = new Detector({ formats: ["qr_code"] });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraRunning(true);
      animationRef.current = requestAnimationFrame(() => {
        void cameraLoop();
      });
    } catch (err) {
      stopCamera();
      setCameraMessage(
        err instanceof Error
          ? `Kamera konnte nicht gestartet werden: ${err.message}`
          : "Kamera konnte nicht gestartet werden."
      );
    }
  }, [cameraLoop, selectedPerformanceId, stopCamera]);

  const standardRows = useMemo(() => {
    if (!hall) return [] as Array<[number, HallSeat[]]>;
    const map = new Map<number, HallSeat[]>();
    hall.seats.forEach((seat) => {
      const row = seat.row_number ?? 0;
      if (!map.has(row)) map.set(row, []);
      map.get(row)?.push(seat);
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [hall]);

  const tables = useMemo(() => {
    if (!hall) return [] as Array<[number, HallSeat[]]>;
    const map = new Map<number, HallSeat[]>();
    hall.seats.forEach((seat) => {
      const table = seat.table_number ?? 0;
      if (!map.has(table)) map.set(table, []);
      map.get(table)?.push(seat);
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [hall]);

  if (loading) {
    return <div className="checkin-loading">Check-in wird geladen …</div>;
  }

  return (
    <div className="checkin-shell">
      <header className="checkin-header">
        <div>
          <div className="checkin-eyebrow">BOULEVARDTHEATER DEIDESHEIM</div>
          <h1>Ticket Check-in</h1>
          <p>Angemeldet als {userName}</p>
        </div>
        <div className="checkin-header-actions">
          {onBack && (
            <button type="button" className="checkin-button secondary" onClick={onBack}>
              Zurück
            </button>
          )}
          <button type="button" className="checkin-button secondary" onClick={onLogout}>
            Abmelden
          </button>
        </div>
      </header>

      <main className="checkin-main">
        <section className="checkin-event-card">
          <label htmlFor="checkin-performance">Veranstaltung</label>
          <select
            id="checkin-performance"
            value={selectedPerformanceId ?? ""}
            onChange={(event) => {
              const id = Number(event.target.value) || null;
              setSelectedPerformanceId(id);
              setResult(null);
              setHall(null);
              lastSeenRef.current = null;
            }}
          >
            {performances.length === 0 && <option value="">Keine Vorstellung vorhanden</option>}
            {performances.map((performance) => (
              <option key={performance.id} value={performance.id}>
                {formatDate(performance.performance_date)} · {formatTime(performance.start_time)} · {performance.title}
              </option>
            ))}
          </select>

          {selectedPerformance && (
            <div className="checkin-event-meta">
              <strong>{selectedPerformance.title}</strong>
              <span>{formatDate(selectedPerformance.performance_date)} · {formatTime(selectedPerformance.start_time)}</span>
              <span>{selectedPerformance.venue_name || "Veranstaltungsort nicht hinterlegt"}</span>
            </div>
          )}

          {selectedPerformance && (
            <div className="checkin-stats">
              <div><strong>{selectedPerformance.ticket_total}</strong><span>Tickets</span></div>
              <div><strong>{selectedPerformance.generated_total}</strong><span>QR-Tickets</span></div>
              <div><strong>{selectedPerformance.checked_in_total}</strong><span>Eingecheckt</span></div>
            </div>
          )}
        </section>

        <nav className="checkin-tabs" aria-label="Check-in Bereiche">
          <button
            type="button"
            className={mode === "scanner" ? "active" : ""}
            onClick={() => setMode("scanner")}
          >
            QR-Scanner
          </button>
          <button
            type="button"
            className={mode === "hall" ? "active" : ""}
            onClick={() => setMode("hall")}
          >
            Saalplan
          </button>
        </nav>

        {error && <div className="checkin-alert error">{error}</div>}

        {mode === "scanner" && (
          <section className="checkin-scanner-grid">
            <div className="checkin-camera-card">
              <div className="checkin-section-heading">
                <div>
                  <h2>Ticket scannen</h2>
                  <p>QR-Code vollständig in den Kamerabereich halten.</p>
                </div>
                <div className="checkin-camera-actions">
                  {!cameraRunning ? (
                    <button type="button" className="checkin-button primary" onClick={() => void startCamera()}>
                      Kamera starten
                    </button>
                  ) : (
                    <button type="button" className="checkin-button secondary" onClick={stopCamera}>
                      Kamera stoppen
                    </button>
                  )}
                </div>
              </div>

              <div className={`checkin-video-wrap ${cameraRunning ? "running" : ""}`}>
                <video ref={videoRef} muted playsInline />
                <div className="checkin-scan-frame" aria-hidden="true" />
                {!cameraRunning && (
                  <div className="checkin-video-placeholder">
                    <span>QR</span>
                    <strong>Kamera ist aus</strong>
                  </div>
                )}
              </div>

              {cameraMessage && <div className="checkin-camera-message">{cameraMessage}</div>}

              <form
                className="checkin-manual"
                onSubmit={(event) => {
                  event.preventDefault();
                  lastSeenRef.current = null;
                  void sendScan(manualCode);
                }}
              >
                <label htmlFor="manual-ticket-code">Code manuell prüfen</label>
                <div>
                  <input
                    id="manual-ticket-code"
                    value={manualCode}
                    onChange={(event) => setManualCode(event.target.value)}
                    placeholder="BTD|… oder Ticket-Code"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                  <button type="submit" className="checkin-button primary" disabled={scanBusy || !manualCode.trim()}>
                    {scanBusy ? "Prüfe …" : "Prüfen"}
                  </button>
                </div>
              </form>
            </div>

            <div className="checkin-result-column">
              {!result ? (
                <div className="checkin-result empty">
                  <div className="checkin-result-icon">↗</div>
                  <h2>Bereit zum Scannen</h2>
                  <p>Das Ergebnis erscheint hier sofort groß und eindeutig.</p>
                </div>
              ) : (
                <div className={`checkin-result ${result.status}`}>
                  <div className="checkin-result-icon">
                    {result.status === "checked_in"
                      ? "✓"
                      : result.status === "already_checked_in"
                        ? "!"
                        : "×"}
                  </div>
                  <div className="checkin-result-kicker">
                    {result.status === "checked_in"
                      ? "TICKET GÜLTIG"
                      : result.status === "already_checked_in"
                        ? "BEREITS VERWENDET"
                        : result.status === "wrong_event"
                          ? "FALSCHE VERANSTALTUNG"
                          : "TICKET STORNIERT"}
                  </div>
                  <h2>{result.message}</h2>
                  <dl>
                    <div><dt>Veranstaltung</dt><dd>{result.event_title}</dd></div>
                    <div><dt>Buchung</dt><dd>{result.booking_number}</dd></div>
                    <div><dt>Gast</dt><dd>{result.customer_name || "–"}</dd></div>
                    <div><dt>Platz</dt><dd>{result.seat}</dd></div>
                    <div><dt>Ticket</dt><dd>{result.ticket_index} von {result.ticket_count}</dd></div>
                    {result.checked_in_at && (
                      <div><dt>Erster Check-in</dt><dd>{formatCheckinTime(result.checked_in_at)}{result.checked_in_by ? ` · ${result.checked_in_by}` : ""}</dd></div>
                    )}
                  </dl>
                  <button
                    type="button"
                    className="checkin-button result-next"
                    onClick={() => {
                      setResult(null);
                      lastSeenRef.current = null;
                    }}
                  >
                    Nächstes Ticket
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {mode === "hall" && (
          <section className="checkin-hall-card">
            <div className="checkin-section-heading">
              <div>
                <h2>Saalplan</h2>
                <p>Nur Ansicht – Check-in-Konten können hier keine Plätze verändern.</p>
              </div>
              <button type="button" className="checkin-button secondary" onClick={() => void refreshHall()} disabled={hallLoading}>
                {hallLoading ? "Lade …" : "Aktualisieren"}
              </button>
            </div>

            {hall && (
              <>
                <div className="checkin-hall-summary">
                  <div><strong>{hall.summary.booked_tickets}</strong><span>gebucht</span></div>
                  <div><strong>{hall.summary.checked_in_tickets}</strong><span>eingecheckt</span></div>
                  <div><strong>{hall.summary.cancelled_tickets}</strong><span>storniert</span></div>
                </div>
                <div className="checkin-legend">
                  <span><i className="free" /> frei</span>
                  <span><i className="booked" /> gebucht</span>
                  <span><i className="checked" /> eingecheckt</span>
                  <span><i className="cancelled" /> storniert</span>
                </div>

                {hall.performance.hall_plan_type === "hall_2" ? (
                  <div className="checkin-table-grid">
                    {tables.map(([tableNumber, seats]) => (
                      <article className="checkin-table" key={tableNumber}>
                        <h3>Tisch {tableNumber}</h3>
                        <div className="checkin-table-seats">
                          {seats.map((seat) => (
                            <button
                              type="button"
                              key={seat.seat_id}
                              className={`checkin-seat ${seatState(seat)}`}
                              title={seatTitle(seat)}
                            >
                              {seat.table_seat_number ?? seat.seat_number ?? "–"}
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="checkin-standard-hall">
                    <div className="checkin-stage">BÜHNE</div>
                    {standardRows.map(([rowNumber, seats]) => (
                      <div className="checkin-row" key={rowNumber}>
                        <strong>R{rowNumber}</strong>
                        <div>
                          {seats.map((seat) => (
                            <button
                              type="button"
                              key={seat.seat_id}
                              className={`checkin-seat ${seatState(seat)}`}
                              title={seatTitle(seat)}
                            >
                              {seat.seat_number ?? "–"}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {!hall && hallLoading && <div className="checkin-loading-inline">Saalplan wird geladen …</div>}
          </section>
        )}
      </main>
    </div>
  );
}
