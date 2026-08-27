from datetime import date, time, datetime, datetime, timedelta
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg
import bcrypt


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://127.0.0.1:5175",
        "http://localhost:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_CONFIG = "dbname=theater"

VALID_STATUSES = {
    "reserviert",
    "bezahlt",
    "hinterlegt",
    "storniert",
}


@app.post("/api/admin/users/{user_id}/unlock")
def unlock_user(user_id: int, request: Request):
    require_admin(request)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, username, display_name
                FROM app_users
                WHERE id = %s
                LIMIT 1
                """,
                (user_id,),
            )

            user = cur.fetchone()

            if not user:
                raise HTTPException(
                    status_code=404,
                    detail="Benutzer nicht gefunden.",
                )

            cur.execute(
                """
                UPDATE app_users
                SET
                    failed_login_attempts = 0,
                    locked_until = NULL,
                    permanently_locked = FALSE
                WHERE id = %s
                """,
                (user_id,),
            )

            write_activity(
                cur,
                request,
                action="Benutzer freigeschaltet",
                entity_type="user",
                entity_id=user[0],
                description=(
                    f"Benutzer freigeschaltet: "
                    f"{user[2]} ({user[1]})"
                ),
            )

            conn.commit()

    return {
        "success": True,
        "user_id": int(user[0]),
        "username": user[1],
        "display_name": user[2],
        "message": "Benutzer wurde freigeschaltet.",
    }


# ============================================================
# BENUTZER / AUTHENTIFIZIERUNG
# ============================================================

VALID_USER_ROLES = {
    "admin",
    "mitarbeiter",
    "lesen",
}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")


def verify_password(
    password: str,
    password_hash: str,
) -> bool:
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            password_hash.encode("utf-8"),
        )
    except ValueError:
        return False



def ensure_users_table():
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS app_users (
                    id BIGSERIAL PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMP WITHOUT TIME ZONE
                        NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT app_users_role_check
                        CHECK (
                            role IN (
                                'admin',
                                'mitarbeiter',
                                'lesen'
                            )
                        )
                )
                """
            )

            conn.commit()


ensure_users_table()



@app.get("/api/admin/users")
def get_admin_users(request: Request):
    require_admin(request)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    username,
                    display_name,
                    role,
                    is_active,
                    failed_login_attempts,
                    locked_until,
                    permanently_locked
                FROM app_users
                ORDER BY
                    role,
                    display_name,
                    username
                """
            )

            rows = cur.fetchall()

    return [
        {
            "id": int(row[0]),
            "username": row[1],
            "display_name": row[2],
            "role": row[3],
            "is_active": row[4],
            "failed_login_attempts": row[5] or 0,
            "locked_until": (
                row[6].isoformat()
                if row[6]
                else None
            ),
            "permanently_locked": row[7],
        }
        for row in rows
    ]



@app.post("/api/admin/users/{user_id}/toggle-active")
def toggle_user_active(
    user_id: int,
    request: Request,
):
    admin_id, _ = get_actor(request)
    require_admin(request)

    if admin_id == user_id:
        raise HTTPException(
            status_code=400,
            detail="Das eigene Administrator-Konto kann nicht deaktiviert werden.",
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    username,
                    display_name,
                    role,
                    is_active
                FROM app_users
                WHERE id = %s
                LIMIT 1
                """,
                (user_id,),
            )

            user = cur.fetchone()

            if not user:
                raise HTTPException(
                    status_code=404,
                    detail="Benutzer nicht gefunden.",
                )

            new_active_state = not user[4]

            cur.execute(
                """
                UPDATE app_users
                SET is_active = %s
                WHERE id = %s
                """,
                (
                    new_active_state,
                    user_id,
                ),
            )

            write_activity(
                cur,
                request,
                action=(
                    "Benutzer aktiviert"
                    if new_active_state
                    else "Benutzer deaktiviert"
                ),
                entity_type="user",
                entity_id=user[0],
                description=(
                    f"Benutzer "
                    f"{'aktiviert' if new_active_state else 'deaktiviert'}: "
                    f"{user[2]} ({user[1]})"
                ),
            )

            conn.commit()

    return {
        "success": True,
        "user_id": int(user[0]),
        "username": user[1],
        "display_name": user[2],
        "is_active": new_active_state,
        "message": (
            "Benutzer wurde aktiviert."
            if new_active_state
            else "Benutzer wurde deaktiviert."
        ),
    }



@app.post("/api/admin/users/{user_id}/authorize-password-reset")
def authorize_password_reset(
    user_id: int,
    request: Request,
):
    require_admin(request)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, username, display_name
                FROM app_users
                WHERE id = %s
                LIMIT 1
                """,
                (user_id,),
            )

            user = cur.fetchone()

            if not user:
                raise HTTPException(
                    status_code=404,
                    detail="Benutzer nicht gefunden.",
                )

            cur.execute(
                """
                UPDATE app_users
                SET password_reset_until =
                    NOW() + INTERVAL '1 hour'
                WHERE id = %s
                """,
                (user_id,),
            )

            write_activity(
                cur,
                request,
                action="Passwort-Reset freigegeben",
                entity_type="user",
                entity_id=user[0],
                description=(
                    f"Passwort-Reset für 1 Stunde freigegeben: "
                    f"{user[2]} ({user[1]})"
                ),
            )

            conn.commit()

    return {
        "success": True,
        "user_id": int(user[0]),
        "username": user[1],
        "display_name": user[2],
        "message": (
            "Passwort-Reset wurde für 1 Stunde freigegeben."
        ),
    }


class PublicPasswordResetRequest(BaseModel):
    username: str
    new_password: str


@app.post("/api/password-reset/complete")
def complete_public_password_reset(
    data: dict,
    request: Request,
):
    username = str(data.get("username", "")).strip()
    new_password = str(data.get("new_password", ""))

    if not username:
        raise HTTPException(
            status_code=400,
            detail="Benutzername ist erforderlich.",
        )

    if len(new_password) < 8:
        raise HTTPException(
            status_code=400,
            detail="Das neue Passwort muss mindestens 8 Zeichen lang sein.",
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    username,
                    display_name,
                    is_active,
                    password_reset_until
                FROM app_users
                WHERE username = %s
                LIMIT 1
                """,
                (username,),
            )

            user = cur.fetchone()

            if not user:
                raise HTTPException(
                    status_code=404,
                    detail="Für diesen Benutzer ist kein Passwort-Reset freigegeben.",
                )

            user_id = user[0]
            db_username = user[1]
            display_name = user[2]
            is_active = user[3]
            reset_until = user[4]

            if not is_active:
                raise HTTPException(
                    status_code=403,
                    detail="Dieses Benutzerkonto ist deaktiviert.",
                )

            if not reset_until or reset_until <= datetime.now():
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Für diesen Benutzer ist aktuell "
                        "kein gültiger Passwort-Reset freigegeben."
                    ),
                )

            password_hash = bcrypt.hashpw(
                new_password.encode("utf-8"),
                bcrypt.gensalt(),
            ).decode("utf-8")

            cur.execute(
                """
                UPDATE app_users
                SET
                    password_hash = %s,
                    failed_login_attempts = 0,
                    locked_until = NULL,
                    permanently_locked = FALSE,
                    password_reset_until = NULL
                WHERE id = %s
                """,
                (
                    password_hash,
                    user_id,
                ),
            )

            write_activity(
                cur,
                request,
                action="Passwort über Reset geändert",
                entity_type="user",
                entity_id=user_id,
                description=(
                    f"Passwort über freigegebenen Reset geändert: "
                    f"{display_name} ({db_username})"
                ),
            )

            conn.commit()

    return {
        "success": True,
        "user_id": int(user_id),
        "username": db_username,
        "display_name": display_name,
        "message": "Passwort wurde erfolgreich geändert.",
    }


@app.post("/api/admin/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    data: dict,
    request: Request,
):
    require_admin(request)

    new_password = str(data.get("new_password", "")).strip()

    if len(new_password) < 8:
        raise HTTPException(
            status_code=400,
            detail="Das neue Passwort muss mindestens 8 Zeichen lang sein.",
        )

    password_hash = bcrypt.hashpw(
        new_password.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    username,
                    display_name
                FROM app_users
                WHERE id = %s
                LIMIT 1
                """,
                (user_id,),
            )

            user = cur.fetchone()

            if not user:
                raise HTTPException(
                    status_code=404,
                    detail="Benutzer nicht gefunden.",
                )

            cur.execute(
                """
                UPDATE app_users
                SET
                    password_hash = %s,
                    failed_login_attempts = 0,
                    locked_until = NULL,
                    permanently_locked = FALSE
                WHERE id = %s
                """,
                (
                    password_hash,
                    user_id,
                ),
            )

            write_activity(
                cur,
                request,
                action="Benutzerpasswort zurückgesetzt",
                entity_type="user",
                entity_id=user[0],
                description=(
                    f"Passwort zurückgesetzt: "
                    f"{user[2]} ({user[1]})"
                ),
            )

            conn.commit()

    return {
        "success": True,
        "user_id": int(user[0]),
        "username": user[1],
        "display_name": user[2],
        "message": "Passwort wurde zurückgesetzt.",
    }



# ============================================================
# LOGIN
# ============================================================

class ResetPasswordRequest(BaseModel):
    new_password: str


class LoginRequest(BaseModel):
    username: str
    password: str



@app.post("/api/login")
def login(data: LoginRequest):
    username = data.username.strip()

    if not username or not data.password:
        raise HTTPException(
            status_code=400,
            detail="Benutzername und Passwort sind erforderlich.",
        )

    now = datetime.now()

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                SELECT
                    id,
                    username,
                    display_name,
                    password_hash,
                    role,
                    is_active,
                    failed_login_attempts,
                    locked_until,
                    permanently_locked
                FROM app_users
                WHERE username = %s
                LIMIT 1
                FOR UPDATE
                ''',
                (username,),
            )

            user = cur.fetchone()

            if not user:
                raise HTTPException(
                    status_code=401,
                    detail="Benutzername oder Passwort ist falsch.",
                )

            (
                user_id,
                db_username,
                display_name,
                password_hash,
                role,
                is_active,
                failed_login_attempts,
                locked_until,
                permanently_locked,
            ) = user

            if not is_active:
                raise HTTPException(
                    status_code=403,
                    detail="Dieses Benutzerkonto ist deaktiviert.",
                )

            if permanently_locked:
                raise HTTPException(
                    status_code=423,
                    detail=(
                        "Dieses Benutzerkonto ist dauerhaft gesperrt. "
                        "Ein Administrator muss es freischalten."
                    ),
                )

            if locked_until and locked_until > now:
                remaining_seconds = int(
                    (locked_until - now).total_seconds()
                )
                remaining_minutes = max(
                    1,
                    (remaining_seconds + 59) // 60,
                )

                raise HTTPException(
                    status_code=423,
                    detail=(
                        "Dieses Benutzerkonto ist vorübergehend gesperrt. "
                        f"Bitte noch etwa {remaining_minutes} Minute(n) warten."
                    ),
                )

            if password_hash == "SETUP_PENDING":
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Für dieses Benutzerkonto wurde noch kein "
                        "Passwort eingerichtet."
                    ),
                )

            password_ok = verify_password(
                data.password,
                password_hash,
            )

            if not password_ok:
                current_attempts = failed_login_attempts or 0
                next_attempts = current_attempts + 1

                # Insgesamt 6 Fehlversuche:
                # 3 im ersten Block + 3 nach der 15-Minuten-Sperre.
                if next_attempts >= 6:
                    cur.execute(
                        '''
                        UPDATE app_users
                        SET
                            failed_login_attempts = %s,
                            locked_until = NULL,
                            permanently_locked = TRUE
                        WHERE id = %s
                        ''',
                        (
                            next_attempts,
                            user_id,
                        ),
                    )

                    conn.commit()

                    raise HTTPException(
                        status_code=423,
                        detail=(
                            "Dieses Benutzerkonto wurde nach "
                            "erneuten Fehlversuchen dauerhaft gesperrt. "
                            "Ein Administrator muss es freischalten."
                        ),
                    )

                # Nach dem 3. Fehlversuch 15 Minuten sperren.
                if next_attempts == 3:
                    lock_until = now + timedelta(minutes=15)

                    cur.execute(
                        '''
                        UPDATE app_users
                        SET
                            failed_login_attempts = %s,
                            locked_until = %s
                        WHERE id = %s
                        ''',
                        (
                            next_attempts,
                            lock_until,
                            user_id,
                        ),
                    )

                    conn.commit()

                    raise HTTPException(
                        status_code=423,
                        detail=(
                            "Zu viele falsche Passwortversuche. "
                            "Das Konto wurde für 15 Minuten gesperrt."
                        ),
                    )

                cur.execute(
                    '''
                    UPDATE app_users
                    SET failed_login_attempts = %s
                    WHERE id = %s
                    ''',
                    (
                        next_attempts,
                        user_id,
                    ),
                )

                conn.commit()

                raise HTTPException(
                    status_code=401,
                    detail="Benutzername oder Passwort ist falsch.",
                )

            # Erfolgreicher Login:
            # Fehlversuche und temporäre Sperre zurücksetzen.
            cur.execute(
                '''
                UPDATE app_users
                SET
                    failed_login_attempts = 0,
                    locked_until = NULL
                WHERE id = %s
                ''',
                (user_id,),
            )

            conn.commit()

    return {
        "success": True,
        "user_id": int(user_id),
        "username": db_username,
        "display_name": display_name,
        "role": role,
    }


# ============================================================
# AUDIT-LOG / ÄNDERUNGSHISTORIE
# ============================================================

DEFAULT_ACTOR_NAME = "System / noch kein Login"


def get_actor(request: Request):
    actor_id = request.headers.get("X-User-Id")

    actor_name = request.headers.get(
        "X-User-Name",
        DEFAULT_ACTOR_NAME,
    )

    return actor_id, actor_name


def require_admin(request: Request):
    actor_id, _ = get_actor(request)

    if not actor_id:
        raise HTTPException(
            status_code=401,
            detail="Anmeldung erforderlich.",
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT role, is_active
                FROM app_users
                WHERE id = %s
                LIMIT 1
                """,
                (actor_id,),
            )
            user = cur.fetchone()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Benutzer nicht gefunden.",
        )

    role, is_active = user

    if not is_active:
        raise HTTPException(
            status_code=403,
            detail="Benutzer ist deaktiviert.",
        )

    if role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Nur Administratoren dürfen Vorstellungen endgültig löschen.",
        )


def ensure_audit_log_table():
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS activity_log (
                    id BIGSERIAL PRIMARY KEY,

                    created_at TIMESTAMP WITHOUT TIME ZONE
                        NOT NULL DEFAULT CURRENT_TIMESTAMP,

                    actor_user_id TEXT NULL,

                    actor_name TEXT NOT NULL,

                    action VARCHAR(100) NOT NULL,

                    entity_type VARCHAR(100) NOT NULL,

                    entity_id BIGINT NULL,

                    customer_id BIGINT NULL,

                    performance_id BIGINT NULL,

                    booking_id BIGINT NULL,

                    description TEXT NOT NULL,

                    old_value TEXT NULL,

                    new_value TEXT NULL
                )
                """
            )

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS
                activity_log_created_at_idx
                ON activity_log (created_at DESC)
                """
            )

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS
                activity_log_customer_id_idx
                ON activity_log (customer_id)
                """
            )

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS
                activity_log_performance_id_idx
                ON activity_log (performance_id)
                """
            )

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS
                activity_log_booking_id_idx
                ON activity_log (booking_id)
                """
            )

            conn.commit()


@app.on_event("startup")

@app.on_event("startup")
def startup_tischsaal():
    ensure_tischsaal_seats()


def startup():
    ensure_audit_log_table()
    ensure_hall_plan_type_column()


def write_activity(
    cur,
    request: Request,
    *,
    action: str,
    entity_type: str,
    description: str,
    entity_id=None,
    customer_id=None,
    performance_id=None,
    booking_id=None,
    old_value=None,
    new_value=None,
):
    actor_id, actor_name = get_actor(request)

    cur.execute(
        """
        INSERT INTO activity_log (
            actor_user_id,
            actor_name,
            action,
            entity_type,
            entity_id,
            customer_id,
            performance_id,
            booking_id,
            description,
            old_value,
            new_value
        )
        VALUES (
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s
        )
        """,
        (
            actor_id,
            actor_name,
            action,
            entity_type,
            entity_id,
            customer_id,
            performance_id,
            booking_id,
            description,
            old_value,
            new_value,
        ),
    )



def ensure_hall_plan_type_column():
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS hall_plan_type TEXT
                NOT NULL DEFAULT 'standard'
                """
            )
        conn.commit()


# ============================================================
# DATENMODELLE
# ============================================================

class PerformanceCreate(BaseModel):
    title: str
    performance_date: date
    start_time: time
    hall_plan_type: str = "hall_1"


class BookingCreate(BaseModel):
    first_name: str
    last_name: str
    email: str = ""
    phone: str = ""
    street: str = ""
    postal_code: str = ""
    city: str = ""
    notes: str = ""
    ticket_count: int
    ticket_price: float
    service_fee: float = 0.0
    performance_id: int = 1


class BookingUpdate(BaseModel):
    first_name: str
    last_name: str
    email: str = ""
    phone: str = ""
    street: str = ""
    postal_code: str = ""
    city: str = ""
    notes: str = ""
    ticket_count: int
    ticket_price: float
    service_fee: float
    performance_id: int
    free_seating: bool = False


class SeatAssignmentCreate(BaseModel):
    performance_id: int
    seat_id: int
    booking_id: int


class AssignmentStatusUpdate(BaseModel):
    status: str



# ============================================================
# TISCHSAAL SEATS – 16 TABLES x 10 SEATS
# ============================================================
#
# Diese Struktur beschreibt die 160 Plätze des Tischsaals.
# Die vorhandenen Bühnenplätze werden NICHT verändert.
#
# Tisch 1-16
# Platz 1-10
#
# ============================================================

TISCHSAAL_TABLES = list(range(1, 17))
TISCHSAAL_SEATS_PER_TABLE = 10


def ensure_tischsaal_seats():
    """
    Legt die 160 Tischsaalplätze einmalig an.

    Die vorhandenen Bühnenplätze bleiben unverändert.
    Bereits vorhandene Tischsaalplätze werden nicht doppelt
    angelegt.
    """

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            # Prüfen, ob die Tabelle die Tischsaal-Metadaten
            # bereits besitzt.
            cur.execute("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'seats'
                  AND column_name = 'hall_type'
            """)

            has_hall_type = cur.fetchone() is not None

            if not has_hall_type:
                cur.execute("""
                    ALTER TABLE seats
                    ADD COLUMN hall_type TEXT
                """)

            cur.execute("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'seats'
                  AND column_name = 'table_number'
            """)

            has_table_number = cur.fetchone() is not None

            if not has_table_number:
                cur.execute("""
                    ALTER TABLE seats
                    ADD COLUMN table_number INTEGER
                """)

            cur.execute("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'seats'
                  AND column_name = 'table_seat_number'
            """)

            has_table_seat_number = cur.fetchone() is not None

            if not has_table_seat_number:
                cur.execute("""
                    ALTER TABLE seats
                    ADD COLUMN table_seat_number INTEGER
                """)

            # Vorhandene Tischsaalplätze zählen.
            cur.execute("""
                SELECT COUNT(*)
                FROM seats
                WHERE hall_type = 'tischsaal'
            """)

            existing = cur.fetchone()[0]

            print(
                f"Vorhandene Tischsaalplätze: {existing}"
            )

            # 16 x 10 = 160.
            for table_number in TISCHSAAL_TABLES:

                for seat_number in range(
                    1,
                    TISCHSAAL_SEATS_PER_TABLE + 1
                ):

                    cur.execute("""
                        SELECT id
                        FROM seats
                        WHERE hall_type = 'tischsaal'
                          AND table_number = %s
                          AND table_seat_number = %s
                    """, (
                        table_number,
                        seat_number,
                    ))

                    if cur.fetchone():
                        continue

                    # row_number / seat_number bekommen für
                    # den bestehenden Code ebenfalls eindeutige
                    # Werte.
                    #
                    # Die eigentliche Tisch-Zuordnung läuft über
                    # hall_type/table_number/table_seat_number.
                    row_number = table_number

                    cur.execute("""
                        SELECT COALESCE(
                            MAX(seat_number),
                            0
                        )
                        FROM seats
                        WHERE row_number = %s
                    """, (
                        row_number,
                    ))

                    max_seat = cur.fetchone()[0]

                    new_seat_number = max_seat + 1

                    cur.execute("""
                        INSERT INTO seats (
                            row_number,
                            seat_number,
                            side,
                            is_active,
                            hall_type,
                            table_number,
                            table_seat_number
                        )
                        VALUES (
                            %s,
                            %s,
                            %s,
                            TRUE,
                            'tischsaal',
                            %s,
                            %s
                        )
                    """, (
                        row_number,
                        new_seat_number,
                        f"Tisch {table_number}",
                        table_number,
                        seat_number,
                    ))

            conn.commit()

            cur.execute("""
                SELECT COUNT(*)
                FROM seats
                WHERE hall_type = 'tischsaal'
                  AND is_active = TRUE
            """)

            total = cur.fetchone()[0]

            print(
                f"Aktive Tischsaalplätze: {total}"
            )

            if total != 160:
                raise RuntimeError(
                    f"FEHLER: Erwartet 160 Tischsaalplätze, "
                    f"gefunden: {total}"
                )

            print(
                "OK: 16 Tische × 10 Plätze = 160 Plätze."
            )



# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():
    return {
        "status": "ok",
    }


# ============================================================
# AUDIT-LOG ABRUFEN
# ============================================================

@app.get("/api/activity-log")
def get_activity_log(
    limit: int = 250,
    customer_id: int | None = None,
    performance_id: int | None = None,
    booking_id: int | None = None,
    action: str | None = None,
):
    limit = max(
        1,
        min(limit, 1000),
    )

    conditions = []

    params = []

    if customer_id is not None:
        conditions.append(
            "customer_id = %s"
        )

        params.append(
            customer_id
        )

    if performance_id is not None:
        conditions.append(
            "performance_id = %s"
        )

        params.append(
            performance_id
        )

    if booking_id is not None:
        conditions.append(
            "booking_id = %s"
        )

        params.append(
            booking_id
        )

    if action:
        conditions.append(
            "action = %s"
        )

        params.append(
            action
        )

    where_sql = ""

    if conditions:
        where_sql = (
            "WHERE "
            + " AND ".join(conditions)
        )

    params.append(limit)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    id,
                    created_at,
                    actor_user_id,
                    actor_name,
                    action,
                    entity_type,
                    entity_id,
                    customer_id,
                    performance_id,
                    booking_id,
                    description,
                    old_value,
                    new_value
                FROM activity_log
                {where_sql}
                ORDER BY
                    created_at DESC,
                    id DESC
                LIMIT %s
                """,
                tuple(params),
            )

            rows = cur.fetchall()

    return [
        {
            "id": row[0],
            "created_at": row[1].isoformat(),
            "actor_user_id": row[2],
            "actor_name": row[3],
            "action": row[4],
            "entity_type": row[5],
            "entity_id": row[6],
            "customer_id": row[7],
            "performance_id": row[8],
            "booking_id": row[9],
            "description": row[10],
            "old_value": row[11],
            "new_value": row[12],
        }
        for row in rows
    ]


# ============================================================
# KUNDEN-HISTORIE
# ============================================================

@app.get("/api/customers/{customer_id}/activity-log")
def get_customer_activity_log(
    customer_id: int,
    limit: int = 250,
):
    return get_activity_log(
        limit=limit,
        customer_id=customer_id,
    )


# ============================================================
# VORSTELLUNGEN
# ============================================================

@app.get("/api/performances")
def get_performances():
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    title,
                    performance_date,
                    start_time,
                    created_at,
                    hall_plan_type
                FROM performances
                ORDER BY
                    performance_date ASC,
                    start_time ASC,
                    id ASC
                """
            )

            rows = cur.fetchall()

    return [
        {
            "id": row[0],
            "title": row[1],
            "performance_date": row[2].isoformat(),
            "start_time": row[3].isoformat(),
            "created_at": (
                row[4].isoformat()
                if row[4]
                else None
            ),
            "hall_plan_type": (
                row[5]
                if len(row) > 5 and row[5]
                else "hall_1"
            ),
        }
        for row in rows
    ]


@app.get("/api/performances/{performance_id}")
def get_performance(
    performance_id: int
):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    title,
                    performance_date,
                    start_time,
                    hall_plan_type,
                    created_at
                FROM performances
                WHERE id = %s
                """,
                (
                    performance_id,
                ),
            )

            row = cur.fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Vorstellung nicht gefunden.",
        )

    return {
        "id": row[0],
        "title": row[1],
        "performance_date": (
            row[2].isoformat()
        ),
        "start_time": (
            row[3].isoformat()
        ),
        "hall_plan_type": row[4] or "hall_1",
        "created_at": (
            row[5].isoformat()
            if row[4]
            else None
        ),
    }


@app.post("/api/performances")
def create_performance(
    data: PerformanceCreate,
    request: Request,
):
    if not data.title.strip():
        raise HTTPException(
            status_code=400,
            detail="Titel fehlt.",
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO performances (
                    title,
                    performance_date,
                    start_time,
                    hall_plan_type
                )
                VALUES (
                    %s,
                    %s,
                    %s,
                    %s
                )
                RETURNING
                    id,
                    title,
                    performance_date,
                    start_time,
                    created_at,
                    hall_plan_type
                """,
                (
                    data.title.strip(),
                    data.performance_date,
                    data.start_time,
                    (
                        data.hall_plan_type
                        if data.hall_plan_type in ("hall_1", "hall_2")
                        else "hall_1"
                    ),
                ),
            )

            row = cur.fetchone()

            write_activity(
                cur,
                request,
                action="Vorstellung angelegt",
                entity_type="performance",
                entity_id=row[0],
                performance_id=row[0],
                description=(
                    f"Vorstellung angelegt: "
                    f"{row[1]} · "
                    f"{row[2].strftime('%d.%m.%Y')} · "
                    f"{row[3].strftime('%H:%M')}"
                ),
                new_value=(
                    f"title={row[1]}; "
                    f"date={row[2].isoformat()}; "
                    f"time={row[3].isoformat()}"
                ),
            )

            conn.commit()

    return {
        "success": True,
        "performance": {
            "id": row[0],
            "title": row[1],
            "performance_date": (
                row[2].isoformat()
            ),
            "start_time": (
                row[3].isoformat()
            ),
            "created_at": (
                row[4].isoformat()
                if row[4]
                else None
            ),
            "hall_plan_type": (
                row[5]
                if len(row) > 5 and row[5]
                else "hall_1"
            ),
        },
    }



@app.put("/api/performances/{performance_id}")
def update_performance(
    performance_id: int,
    data: PerformanceCreate,
    request: Request,
):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    title,
                    performance_date,
                    start_time,
                    hall_plan_type
                FROM performances
                WHERE id = %s
                """,
                (performance_id,),
            )

            performance = cur.fetchone()

            if not performance:
                raise HTTPException(
                    status_code=404,
                    detail="Vorstellung nicht gefunden.",
                )

            if not data.title.strip():
                raise HTTPException(
                    status_code=400,
                    detail="Titel fehlt.",
                )

            cur.execute(
                """
                UPDATE performances
                SET
                    title = %s,
                    performance_date = %s,
                    start_time = %s,
                    hall_plan_type = %s
                WHERE id = %s
                RETURNING
                    id,
                    title,
                    performance_date,
                    start_time,
                    created_at
                """,
                (
                    data.title.strip(),
                    data.performance_date,
                    data.start_time,
                    performance_id,
                ),
            )

            row = cur.fetchone()

            write_activity(
                cur,
                request,
                action="Vorstellung geändert",
                entity_type="performance",
                entity_id=row[0],
                performance_id=row[0],
                description=(
                    f"Vorstellung geändert: "
                    f"{row[1]} · "
                    f"{row[2].strftime('%d.%m.%Y')} · "
                    f"{row[3].strftime('%H:%M')}"
                ),
                old_value=(
                    f"title={performance[1]}; "
                    f"date={performance[2].isoformat()}; "
                    f"time={performance[3].isoformat()}"
                ),
                new_value=(
                    f"title={row[1]}; "
                    f"date={row[2].isoformat()}; "
                    f"time={row[3].isoformat()}"
                ),
            )

            conn.commit()

    return {
        "id": row[0],
        "title": row[1],
        "performance_date": row[2].isoformat(),
        "start_time": row[3].isoformat(),
        "hall_plan_type": row[6] if len(row) > 6 else "hall_1",
            "created_at": (
            row[4].isoformat()
            if row[4]
            else None
        ),
    }


@app.delete(
    "/api/performances/{performance_id}"
)
def delete_performance(
    performance_id: int,
    request: Request,
):
    require_admin(request)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    id,
                    title,
                    performance_date,
                    start_time
                FROM performances
                WHERE id = %s
                """,
                (performance_id,),
            )

            performance = cur.fetchone()

            if not performance:
                raise HTTPException(
                    status_code=404,
                    detail="Vorstellung nicht gefunden.",
                )

            # Alle Buchungen vorher laden.
            cur.execute(
                """
                SELECT
                    b.id,
                    b.booking_number,
                    b.customer_id
                FROM bookings b
                WHERE b.performance_id = %s
                """,
                (performance_id,),
            )

            bookings = cur.fetchall()

            # Aktivitätslog schreiben, solange Vorstellung
            # und Buchungen noch existieren.
            write_activity(
                cur,
                request,
                action="Vorstellung gelöscht",
                entity_type="performance",
                entity_id=performance_id,
                performance_id=performance_id,
                description=(
                    f"Vorstellung gelöscht: "
                    f"{performance[1]} · "
                    f"{performance[2].strftime('%d.%m.%Y')} · "
                    f"{performance[3].strftime('%H:%M')}"
                ),
                old_value=(
                    f"title={performance[1]}; "
                    f"date={performance[2].isoformat()}; "
                    f"time={performance[3].isoformat()}; "
                    f"bookings={len(bookings)}"
                ),
            )

            # Sitzplatzzuweisungen zuerst entfernen.
            cur.execute(
                """
                DELETE FROM seat_assignments
                WHERE performance_id = %s
                """,
                (performance_id,),
            )

            # Danach Buchungen entfernen.
            cur.execute(
                """
                DELETE FROM bookings
                WHERE performance_id = %s
                """,
                (performance_id,),
            )

            # Kunden nur dann entfernen, wenn sie
            # anschließend wirklich keine Buchung mehr haben.
            for booking_id, booking_number, customer_id in bookings:
                cur.execute(
                    """
                    SELECT COUNT(*)
                    FROM bookings
                    WHERE customer_id = %s
                    """,
                    (customer_id,),
                )

                remaining = cur.fetchone()[0]

                if remaining == 0:
                    cur.execute(
                        """
                        DELETE FROM customers
                        WHERE id = %s
                        """,
                        (customer_id,),
                    )

            # Zum Schluss die Vorstellung selbst löschen.
            cur.execute(
                """
                DELETE FROM performances
                WHERE id = %s
                """,
                (performance_id,),
            )

            conn.commit()

    return {
        "success": True,
        "performance_id": performance_id,
    }


@app.get("/api/bookings")
def get_bookings(
    performance_id: int | None = None
):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            if performance_id is None:
                cur.execute(
                    """
                    SELECT
                        b.id,
                        b.booking_number,
                        b.customer_id,
                        c.first_name,
                        c.last_name,
                        c.email,
                        c.phone,
                        c.street,
                        c.postal_code,
                        c.city,
                        c.notes,
                        b.performance_id,
                        b.ticket_count,
                        b.ticket_price,
                        b.service_fee,
                        b.status
                    FROM bookings b
                    JOIN customers c
                        ON c.id = b.customer_id
                    ORDER BY
                        b.id DESC
                    """
                )
            else:
                cur.execute(
                    """
                    SELECT
                        b.id,
                        b.booking_number,
                        b.customer_id,
                        c.first_name,
                        c.last_name,
                        c.email,
                        c.phone,
                        c.street,
                        c.postal_code,
                        c.city,
                        c.notes,
                        b.performance_id,
                        b.ticket_count,
                        b.ticket_price,
                        b.service_fee,
                        b.status
                    FROM bookings b
                    JOIN customers c
                        ON c.id = b.customer_id
                    WHERE
                        b.performance_id = %s
                    ORDER BY
                        b.id DESC
                    """,
                    (
                        performance_id,
                    ),
                )

            rows = cur.fetchall()

    return [
        {
            "id": row[0],
            "booking_number": row[1],
            "customer_id": row[2],
            "first_name": row[3],
            "last_name": row[4],
            "email": row[5] or "",
            "phone": row[6] or "",
            "street": row[7] or "",
            "postal_code": row[8] or "",
            "city": row[9] or "",
            "notes": row[10] or "",
            "performance_id": row[11],
            "ticket_count": row[12],
            "ticket_price": float(row[13]),
            "service_fee": float(row[14]),
            "status": row[15],
        }
        for row in rows
    ]


@app.post("/api/bookings")
def create_booking(
    data: BookingCreate,
    request: Request,
):
    if not data.first_name.strip():
        raise HTTPException(
            status_code=400,
            detail="Vorname fehlt.",
        )

    if not data.last_name.strip():
        raise HTTPException(
            status_code=400,
            detail="Nachname fehlt.",
        )

    if data.ticket_count < 1:
        raise HTTPException(
            status_code=400,
            detail=(
                "Mindestens ein Platz muss "
                "angegeben werden."
            ),
        )

    if data.ticket_price < 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Der Ticketpreis darf "
                "nicht negativ sein."
            ),
        )

    if data.service_fee < 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Die Servicegebühr darf "
                "nicht negativ sein."
            ),
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT id
                FROM performances
                WHERE id = %s
                """,
                (
                    data.performance_id,
                ),
            )

            if not cur.fetchone():
                raise HTTPException(
                    status_code=404,
                    detail="Vorstellung nicht gefunden.",
                )

            cur.execute(
                """
                SELECT id
                FROM customers
                WHERE
                    LOWER(first_name) =
                        LOWER(%s)
                    AND LOWER(last_name) =
                        LOWER(%s)
                    AND COALESCE(email, '') =
                        %s
                LIMIT 1
                """,
                (
                    data.first_name.strip(),
                    data.last_name.strip(),
                    data.email.strip(),
                ),
            )

            customer = cur.fetchone()

            if customer:
                customer_id = customer[0]

                cur.execute(
                    """
                    UPDATE customers
                    SET
                        phone = %s,
                        email = %s,
                        street = %s,
                        postal_code = %s,
                        city = %s,
                        notes = %s
                    WHERE id = %s
                    """,
                    (
                        data.phone.strip(),
                        data.email.strip(),
                        data.street.strip(),
                        data.postal_code.strip(),
                        data.city.strip(),
                        data.notes.strip(),
                        customer_id,
                    ),
                )

            else:
                cur.execute(
                    """
                    INSERT INTO customers (
                        first_name,
                        last_name,
                        email,
                        phone,
                        street,
                        postal_code,
                        city,
                        notes
                    )
                    VALUES (
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s
                    )
                    RETURNING id
                    """,
                    (
                        data.first_name.strip(),
                        data.last_name.strip(),
                        data.email.strip(),
                        data.phone.strip(),
                        data.street.strip(),
                        data.postal_code.strip(),
                        data.city.strip(),
                        data.notes.strip(),
                    ),
                )

                customer_id = (
                    cur.fetchone()[0]
                )

            cur.execute(
                """
                SELECT next_document_number(
                    'booking_web',
                    %s
                )
                """,
                (
                    datetime.now().year,
                ),
            )

            next_number = cur.fetchone()[0]
            booking_number = (
                f"WEB-{int(next_number):04d}"
            )

            cur.execute(
                """
                INSERT INTO bookings (
                    booking_number,
                    customer_id,
                    performance_id,
                    ticket_count,
                    ticket_price,
                    service_fee,
                    status
                )
                VALUES (
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    'reserviert'
                )
                RETURNING id
                """,
                (
                    booking_number,
                    customer_id,
                    data.performance_id,
                    data.ticket_count,
                    data.ticket_price,
                    data.service_fee,
                ),
            )

            booking_id = (
                cur.fetchone()[0]
            )

            cur.execute(
                """
                SELECT
                    title,
                    performance_date,
                    start_time
                FROM performances
                WHERE id = %s
                """,
                (
                    data.performance_id,
                ),
            )

            performance = cur.fetchone()

            write_activity(
                cur,
                request,
                action="Kunde/Buchung angelegt",
                entity_type="booking",
                entity_id=booking_id,
                customer_id=customer_id,
                performance_id=data.performance_id,
                booking_id=booking_id,
                description=(
                    f"Buchung {booking_number} "
                    f"angelegt für "
                    f"{data.first_name.strip()} "
                    f"{data.last_name.strip()} · "
                    f"{data.ticket_count} Platz/Plätze · "
                    f"{performance[0]} · "
                    f"{performance[1].strftime('%d.%m.%Y')} "
                    f"{performance[2].strftime('%H:%M')}"
                ),
                new_value=(
                    f"booking_number={booking_number}; "
                    f"ticket_count={data.ticket_count}; "
                    f"ticket_price={data.ticket_price}; "
                    f"service_fee={data.service_fee}; "
                    f"status=reserviert"
                ),
            )

            conn.commit()

    return {
        "success": True,
        "booking_id": booking_id,
        "booking_number": booking_number,
        "performance_id": (
            data.performance_id
        ),
    }


# ============================================================
# PERSON / BUCHUNG BEARBEITEN
# ============================================================


# ============================================================
# PERSON / BUCHUNG BEARBEITEN – EINZIGE PATCH-ROUTE
# ============================================================

@app.patch("/api/bookings/{booking_id}")
def update_booking(
    booking_id: int,
    data: BookingUpdate,
    request: Request,
):
    if not data.first_name.strip():
        raise HTTPException(
            status_code=400,
            detail="Vorname fehlt.",
        )

    if not data.last_name.strip():
        raise HTTPException(
            status_code=400,
            detail="Nachname fehlt.",
        )

    if data.ticket_count < 1:
        raise HTTPException(
            status_code=400,
            detail="Mindestens ein Platz muss angegeben werden.",
        )

    if data.ticket_price < 0:
        raise HTTPException(
            status_code=400,
            detail="Der Ticketpreis darf nicht negativ sein.",
        )

    if data.service_fee < 0:
        raise HTTPException(
            status_code=400,
            detail="Die Servicegebühr darf nicht negativ sein.",
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    b.customer_id,
                    b.performance_id,
                    b.booking_number
                FROM bookings b
                WHERE b.id = %s
                """,
                (booking_id,),
            )

            existing = cur.fetchone()

            if not existing:
                raise HTTPException(
                    status_code=404,
                    detail="Buchung nicht gefunden.",
                )

            customer_id = existing[0]
            old_performance_id = existing[1]
            booking_number = existing[2]

            # Neue Vorstellung muss existieren.
            cur.execute(
                """
                SELECT id
                FROM performances
                WHERE id = %s
                """,
                (data.performance_id,),
            )

            if not cur.fetchone():
                raise HTTPException(
                    status_code=404,
                    detail="Die ausgewählte Vorstellung wurde nicht gefunden.",
                )

            # Bei Umbuchung gehören die alten Sitzplätze nicht mehr
            # zur neuen Vorstellung.
            if data.performance_id != old_performance_id:
                cur.execute(
                    """
                    DELETE FROM seat_assignments
                    WHERE booking_id = %s
                    """,
                    (booking_id,),
                )

            # Kundendaten aktualisieren.
            cur.execute(
                """
                UPDATE customers
                SET
                    first_name = %s,
                    last_name = %s,
                    email = %s,
                    phone = %s,
                    street = %s,
                    postal_code = %s,
                    city = %s,
                    notes = %s
                WHERE id = %s
                """,
                (
                    data.first_name.strip(),
                    data.last_name.strip(),
                    data.email.strip(),
                    data.phone.strip(),
                    data.street.strip(),
                    data.postal_code.strip(),
                    data.city.strip(),
                    data.notes.strip(),
                    customer_id,
                ),
            )

            # DIE entscheidende Änderung:
            # performance_id wird direkt in bookings geschrieben.
            cur.execute(
                """
                UPDATE bookings
                SET
                    performance_id = %s,
                    ticket_count = %s,
                    ticket_price = %s,
                    service_fee = %s,
                    notes = %s,
                    free_seating = %s
                WHERE id = %s
                """,
                (
                    data.performance_id,
                    data.ticket_count,
                    data.ticket_price,
                    data.service_fee,
                    data.notes.strip(),
                    data.free_seating,
                    booking_id,
                ),
            )

            if cur.rowcount != 1:
                raise HTTPException(
                    status_code=500,
                    detail="Die Buchung konnte nicht aktualisiert werden.",
                )

            write_activity(
                cur,
                request,
                action="Kunde/Buchung geändert",
                entity_type="booking",
                entity_id=booking_id,
                customer_id=customer_id,
                performance_id=data.performance_id,
                booking_id=booking_id,
                description=(
                    f"Buchung {booking_number} bearbeitet"
                ),
                new_value=(
                    f"performance_id={data.performance_id}; "
                    f"ticket_count={data.ticket_count}; "
                    f"ticket_price={data.ticket_price}; "
                    f"service_fee={data.service_fee}"
                ),
            )

            conn.commit()

            # Kontrolle direkt aus der Datenbank.
            cur.execute(
                """
                SELECT performance_id
                FROM bookings
                WHERE id = %s
                """,
                (booking_id,),
            )

            saved_performance_id = cur.fetchone()[0]

    return {
        "success": True,
        "booking_id": booking_id,
        "performance_id": saved_performance_id,
    }



# ============================================================
# PERSON / BUCHUNG LÖSCHEN
# ============================================================

@app.delete(
    "/api/bookings/{booking_id}"
)
def delete_booking(
    booking_id: int,
    request: Request,
):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    b.customer_id,
                    b.booking_number,
                    b.performance_id,
                    b.ticket_count,
                    b.ticket_price,
                    b.service_fee,
                    b.status,
                    c.first_name,
                    c.last_name
                FROM bookings b
                JOIN customers c
                    ON c.id = b.customer_id
                WHERE b.id = %s
                """,
                (booking_id,),
            )

            booking = cur.fetchone()

            if not booking:
                raise HTTPException(
                    status_code=404,
                    detail="Buchung nicht gefunden.",
                )

            (
                customer_id,
                booking_number,
                performance_id,
                ticket_count,
                ticket_price,
                service_fee,
                status,
                first_name,
                last_name,
            ) = booking

            cur.execute(
                """
                SELECT
                    title,
                    performance_date,
                    start_time
                FROM performances
                WHERE id = %s
                """,
                (performance_id,),
            )

            performance = cur.fetchone()

            # Aktivitätslog VOR dem Löschen.
            write_activity(
                cur,
                request,
                action="Buchung gelöscht",
                entity_type="booking",
                entity_id=booking_id,
                customer_id=customer_id,
                performance_id=performance_id,
                booking_id=booking_id,
                description=(
                    f"Buchung {booking_number} gelöscht: "
                    f"{first_name} {last_name} · "
                    f"{performance[0] if performance else 'Unbekannte Vorstellung'}"
                ),
                old_value=(
                    f"ticket_count={ticket_count}; "
                    f"ticket_price={ticket_price}; "
                    f"service_fee={service_fee}; "
                    f"status={status}"
                ),
            )

            # Sitzplätze entfernen.
            cur.execute(
                """
                DELETE FROM seat_assignments
                WHERE booking_id = %s
                """,
                (booking_id,),
            )

            # Rechnungspositionen entfernen,
            # falls diese Tabelle vorhanden ist.
            cur.execute(
                """
                SELECT to_regclass(
                    'public.invoice_items'
                )
                """
            )

            invoice_items_table = (
                cur.fetchone()[0]
            )

            if invoice_items_table is not None:
                cur.execute(
                    """
                    DELETE FROM invoice_items
                    WHERE invoice_id IN (
                        SELECT id
                        FROM invoices
                        WHERE booking_id = %s
                    )
                    """,
                    (booking_id,),
                )

            # Danach die Rechnungen entfernen.
            cur.execute(
                """
                DELETE FROM invoices
                WHERE booking_id = %s
                """,
                (booking_id,),
            )

            # Erst jetzt die Buchung entfernen.
            cur.execute(
                """
                DELETE FROM bookings
                WHERE id = %s
                """,
                (booking_id,),
            )

            # Kunde nur löschen, wenn keine andere Buchung existiert.
            cur.execute(
                """
                SELECT COUNT(*)
                FROM bookings
                WHERE customer_id = %s
                """,
                (customer_id,),
            )

            remaining_bookings = cur.fetchone()[0]

            if remaining_bookings == 0:
                cur.execute(
                    """
                    DELETE FROM customers
                    WHERE id = %s
                    """,
                    (customer_id,),
                )

            conn.commit()

    return {
        "success": True,
        "booking_id": booking_id,
    }



@app.get("/api/assignments")
def get_assignments(
    performance_id: int = 1,
):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    sa.id,
                    sa.performance_id,
                    sa.seat_id,
                    sa.booking_id,
                    sa.status,
                    s.row_number,
                    s.seat_number,
                    b.booking_number,
                    c.first_name,
                    c.last_name
                FROM seat_assignments sa
                JOIN seats s
                    ON s.id = sa.seat_id
                JOIN bookings b
                    ON b.id = sa.booking_id
                JOIN customers c
                    ON c.id = b.customer_id
                WHERE sa.performance_id = %s
                ORDER BY
                    s.row_number,
                    s.seat_number
                """,
                (performance_id,),
            )

            rows = cur.fetchall()

    return [
        {
            "id": row[0],
            "performance_id": row[1],
            "seat_id": row[2],
            "booking_id": row[3],
            "status": row[4],
            "row_number": row[5],
            "seat_number": row[6],
            "booking_number": row[7],
            "first_name": row[8],
            "last_name": row[9],
        }
        for row in rows
    ]


@app.post("/api/assignments")
def create_assignment(
    data: SeatAssignmentCreate,
    request: Request,
):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT id
                FROM performances
                WHERE id = %s
                """,
                (data.performance_id,),
            )

            if not cur.fetchone():
                raise HTTPException(
                    status_code=404,
                    detail="Vorstellung nicht gefunden.",
                )

            cur.execute(
                """
                SELECT
                    id,
                    row_number,
                    seat_number
                FROM seats
                WHERE
                    id = %s
                    AND is_active = TRUE
                """,
                (data.seat_id,),
            )

            seat = cur.fetchone()

            if not seat:
                raise HTTPException(
                    status_code=404,
                    detail="Sitzplatz nicht gefunden.",
                )

            cur.execute(
                """
                SELECT id
                FROM seat_assignments
                WHERE
                    performance_id = %s
                    AND seat_id = %s
                """,
                (
                    data.performance_id,
                    data.seat_id,
                ),
            )

            if cur.fetchone():
                raise HTTPException(
                    status_code=409,
                    detail="Dieser Sitzplatz ist bereits vergeben.",
                )

            cur.execute(
                """
                SELECT
                    ticket_count,
                    performance_id
                FROM bookings
                WHERE id = %s
                """,
                (data.booking_id,),
            )

            booking = cur.fetchone()

            if not booking:
                raise HTTPException(
                    status_code=404,
                    detail="Buchung nicht gefunden.",
                )

            ticket_count = booking[0]
            booking_performance_id = booking[1]

            if booking_performance_id != data.performance_id:
                raise HTTPException(
                    status_code=400,
                    detail="Die Buchung gehört zu einer anderen Vorstellung.",
                )

            cur.execute(
                """
                SELECT COUNT(*)
                FROM seat_assignments
                WHERE
                    performance_id = %s
                    AND booking_id = %s
                """,
                (
                    data.performance_id,
                    data.booking_id,
                ),
            )

            assigned_count = cur.fetchone()[0]

            if assigned_count >= ticket_count:
                raise HTTPException(
                    status_code=400,
                    detail="Für diese Buchung wurden bereits alle Plätze vergeben.",
                )

            cur.execute(
                """
                INSERT INTO seat_assignments (
                    performance_id,
                    seat_id,
                    booking_id,
                    status
                )
                VALUES (
                    %s,
                    %s,
                    %s,
                    'reserviert'
                )
                RETURNING id
                """,
                (
                    data.performance_id,
                    data.seat_id,
                    data.booking_id,
                ),
            )

            assignment_id = cur.fetchone()[0]

            cur.execute(
                """
                SELECT
                    b.customer_id,
                    b.booking_number,
                    c.first_name,
                    c.last_name
                FROM bookings b
                JOIN customers c
                    ON c.id = b.customer_id
                WHERE b.id = %s
                """,
                (data.booking_id,),
            )

            booking_info = cur.fetchone()

            write_activity(
                cur,
                request,
                action="Sitzplatz zugewiesen",
                entity_type="assignment",
                entity_id=assignment_id,
                customer_id=booking_info[0],
                performance_id=data.performance_id,
                booking_id=data.booking_id,
                description=(
                    f"{booking_info[2]} "
                    f"{booking_info[3]} · "
                    f"Reihe {seat[1]} · "
                    f"Platz {seat[2]} · "
                    f"Buchung {booking_info[1]}"
                ),
                new_value="status=reserviert",
            )

            conn.commit()

    return {
        "success": True,
        "assignment_id": assignment_id,
    }


@app.patch(
    "/api/assignments/{assignment_id}/status"
)
def update_assignment_status(
    assignment_id: int,
    data: AssignmentStatusUpdate,
    request: Request,
):
    if data.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Ungültiger Status.",
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    sa.status,
                    sa.performance_id,
                    sa.booking_id,
                    s.row_number,
                    s.seat_number,
                    b.booking_number,
                    b.customer_id,
                    c.first_name,
                    c.last_name
                FROM seat_assignments sa
                JOIN seats s
                    ON s.id = sa.seat_id
                JOIN bookings b
                    ON b.id = sa.booking_id
                JOIN customers c
                    ON c.id = b.customer_id
                WHERE sa.id = %s
                """,
                (assignment_id,),
            )

            assignment = cur.fetchone()

            if not assignment:
                raise HTTPException(
                    status_code=404,
                    detail="Zuweisung nicht gefunden.",
                )

            old_status = assignment[0]

            if old_status == data.status:
                return {
                    "success": True,
                    "status": data.status,
                }

            cur.execute(
                """
                UPDATE seat_assignments
                SET status = %s
                WHERE id = %s
                """,
                (
                    data.status,
                    assignment_id,
                ),
            )

            write_activity(
                cur,
                request,
                action="Status geändert",
                entity_type="assignment",
                entity_id=assignment_id,
                customer_id=assignment[6],
                performance_id=assignment[1],
                booking_id=assignment[2],
                description=(
                    f"{assignment[7]} "
                    f"{assignment[8]} · "
                    f"Reihe {assignment[3]} · "
                    f"Platz {assignment[4]} · "
                    f"Buchung {assignment[5]}"
                ),
                old_value=old_status,
                new_value=data.status,
            )

            conn.commit()

    return {
        "success": True,
        "status": data.status,
    }


@app.delete(
    "/api/assignments/{assignment_id}"
)
def delete_assignment(
    assignment_id: int,
    request: Request,
):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    sa.performance_id,
                    sa.booking_id,
                    sa.status,
                    s.row_number,
                    s.seat_number,
                    b.booking_number,
                    b.customer_id,
                    c.first_name,
                    c.last_name
                FROM seat_assignments sa
                JOIN seats s
                    ON s.id = sa.seat_id
                JOIN bookings b
                    ON b.id = sa.booking_id
                JOIN customers c
                    ON c.id = b.customer_id
                WHERE sa.id = %s
                """,
                (
                    assignment_id,
                ),
            )

            assignment = cur.fetchone()

            if not assignment:
                raise HTTPException(
                    status_code=404,
                    detail="Zuweisung nicht gefunden.",
                )

            cur.execute(
                """
                DELETE FROM seat_assignments
                WHERE id = %s
                """,
                (
                    assignment_id,
                ),
            )

            write_activity(
                cur,
                request,
                action="Sitzplatz freigegeben",
                entity_type="assignment",
                entity_id=assignment_id,
                customer_id=assignment[6],
                performance_id=assignment[0],
                booking_id=assignment[1],
                description=(
                    f"{assignment[7]} "
                    f"{assignment[8]} · "
                    f"Reihe {assignment[3]} · "
                    f"Platz {assignment[4]} · "
                    f"Buchung {assignment[5]}"
                ),
                old_value=(
                    f"status={assignment[2]}"
                ),
            )

            conn.commit()

    return {
        "success": True,
    }
# ============================================================
# RECHNUNGEN
# ============================================================

class InvoiceCreate(BaseModel):
    booking_id: int
    template_key: str = "RE1"
    tax_rate: float = 19.0
    due_date: date | None = None


@app.get("/api/invoice-templates")
def get_invoice_templates():
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    template_key,
                    name,
                    description
                FROM invoice_templates
                WHERE is_active = TRUE
                ORDER BY id
                """
            )
            rows = cur.fetchall()

    return [
        {
            "template_key": row[0],
            "name": row[1],
            "description": row[2],
        }
        for row in rows
    ]


@app.get("/api/tax-rates")
def get_tax_rates():
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    label,
                    rate,
                    is_default
                FROM tax_rates
                WHERE is_active = TRUE
                ORDER BY rate
                """
            )
            rows = cur.fetchall()

    return [
        {
            "id": row[0],
            "label": row[1],
            "rate": float(row[2]),
            "is_default": row[3],
        }
        for row in rows
    ]


@app.get("/api/invoices")
def get_invoices(booking_id: int | None = None):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            if booking_id is None:
                cur.execute(
                    """
                    SELECT
                        i.id,
                        i.invoice_number,
                        i.booking_id,
                        b.booking_number,
                        c.first_name,
                        c.last_name,
                        i.invoice_date,
                        i.template_key,
                        i.tax_rate,
                        i.net_amount,
                        i.tax_amount,
                        i.gross_amount,
                        i.status,
                        i.payment_status
                    FROM invoices i
                    JOIN bookings b
                        ON b.id = i.booking_id
                    JOIN customers c
                        ON c.id = b.customer_id
                    ORDER BY i.id DESC
                    LIMIT 200
                    """
                )
            else:
                cur.execute(
                    """
                    SELECT
                        i.id,
                        i.invoice_number,
                        i.booking_id,
                        b.booking_number,
                        c.first_name,
                        c.last_name,
                        i.invoice_date,
                        i.template_key,
                        i.tax_rate,
                        i.net_amount,
                        i.tax_amount,
                        i.gross_amount,
                        i.status,
                        i.payment_status
                    FROM invoices i
                    JOIN bookings b
                        ON b.id = i.booking_id
                    JOIN customers c
                        ON c.id = b.customer_id
                    WHERE i.booking_id = %s
                    ORDER BY i.id DESC
                    """
                    ,
                    (booking_id,),
                )

            rows = cur.fetchall()

    return [
        {
            "id": int(row[0]),
            "invoice_number": row[1],
            "booking_id": int(row[2]),
            "booking_number": row[3],
            "first_name": row[4],
            "last_name": row[5],
            "invoice_date": (
                row[6].isoformat()
                if row[6]
                else None
            ),
            "template_key": row[7],
            "tax_rate": float(row[8]),
            "net_amount": float(row[9]),
            "tax_amount": float(row[10]),
            "gross_amount": float(row[11]),
            "status": row[12],
            "payment_status": row[13],
        }
        for row in rows
    ]


@app.post("/api/invoices")
def create_invoice(
    data: InvoiceCreate,
    request: Request,
):
    if data.tax_rate < 0 or data.tax_rate > 100:
        raise HTTPException(
            status_code=400,
            detail="Steuersatz muss zwischen 0 % und 100 % liegen.",
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            # Buchung laden
            cur.execute(
                """
                SELECT
                    b.id,
                    b.booking_number,
                    b.customer_id,
                    b.performance_id,
                    b.ticket_count,
                    b.ticket_price,
                    b.service_fee,
                    c.first_name,
                    c.last_name,
                    c.email,
                    c.street,
                    c.postal_code,
                    c.city,
                    p.title,
                    p.performance_date
                FROM bookings b
                JOIN customers c
                    ON c.id = b.customer_id
                JOIN performances p
                    ON p.id = b.performance_id
                WHERE b.id = %s
                LIMIT 1
                """,
                (data.booking_id,),
            )

            booking = cur.fetchone()

            if not booking:
                raise HTTPException(
                    status_code=404,
                    detail="Buchung nicht gefunden.",
                )

            # Aktive Rechnung für diese Buchung prüfen,
            # bevor eine neue Rechnungsnummer reserviert wird.
            cur.execute(
                """
                SELECT
                    id,
                    invoice_number,
                    status
                FROM invoices
                WHERE booking_id = %s
                  AND status NOT IN ('storniert', 'storno')
                ORDER BY id DESC
                LIMIT 1
                """,
                (data.booking_id,),
            )

            existing_invoice = cur.fetchone()

            if existing_invoice:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Für diese Buchung existiert bereits "
                        f"die Rechnung {existing_invoice[1]}."
                    ),
                )

            # Vorlage prüfen
            cur.execute(
                """
                SELECT template_key
                FROM invoice_templates
                WHERE template_key = %s
                  AND is_active = TRUE
                LIMIT 1
                """,
                (data.template_key,),
            )

            if not cur.fetchone():
                raise HTTPException(
                    status_code=400,
                    detail="Rechnungsvorlage nicht gefunden.",
                )

            # Nur als Sicherheitsprüfung:
            # Ein beliebiger neuer Satz darf verwendet werden,
            # aber innerhalb der Tabelle bekannte Sätze sind bevorzugt.
            ticket_total = (
                float(booking[4]) * float(booking[5])
            )
            service_fee = float(booking[6] or 0)
            gross_total = ticket_total + service_fee

            divisor = 1 + (data.tax_rate / 100)

            net_total = round(gross_total / divisor, 2)
            tax_total = round(gross_total - net_total, 2)

            # Rechnungsnummer atomar vergeben
            cur.execute(
                """
                SELECT next_document_number(
                    'invoice',
                    %s
                )
                """,
                (datetime.now().year,),
            )

            invoice_number_value = cur.fetchone()[0]

            invoice_number = (
                f"RE-{datetime.now().year}-{int(invoice_number_value):05d}"
            )

            invoice_date = datetime.now().date()

            cur.execute(
                """
                INSERT INTO invoices (
                    booking_id,
                    invoice_number,
                    invoice_date,
                    due_date,
                    total_amount,
                    status,
                    invoice_type,
                    template_key,
                    tax_rate,
                    net_amount,
                    tax_amount,
                    gross_amount,
                    payment_status
                )
                VALUES (
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    'offen',
                    'standard',
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    'offen'
                )
                RETURNING id
                """,
                (
                    booking[0],
                    invoice_number,
                    invoice_date,
                    data.due_date,
                    gross_total,
                    data.template_key,
                    data.tax_rate,
                    net_total,
                    tax_total,
                    gross_total,
                ),
            )

            invoice_id = cur.fetchone()[0]

            # Ticketposition
            cur.execute(
                """
                INSERT INTO invoice_items (
                    invoice_id,
                    position_no,
                    description,
                    quantity,
                    unit_price,
                    tax_rate,
                    net_amount,
                    tax_amount,
                    gross_amount
                )
                VALUES (
                    %s,
                    1,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s
                )
                """,
                (
                    invoice_id,
                    booking[13],
                    booking[4],
                    booking[5],
                    data.tax_rate,
                    round(
                        ticket_total / divisor,
                        2,
                    ),
                    round(
                        ticket_total
                        - (ticket_total / divisor),
                        2,
                    ),
                    ticket_total,
                ),
            )

            # Serviceposition
            if service_fee > 0:
                service_net = round(
                    service_fee / divisor,
                    2,
                )
                service_tax = round(
                    service_fee - service_net,
                    2,
                )

                cur.execute(
                    """
                    INSERT INTO invoice_items (
                        invoice_id,
                        position_no,
                        description,
                        quantity,
                        unit_price,
                        tax_rate,
                        net_amount,
                        tax_amount,
                        gross_amount
                    )
                    VALUES (
                        %s,
                        2,
                        'Servicepauschale',
                        1,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s
                    )
                    """,
                    (
                        invoice_id,
                        service_fee,
                        data.tax_rate,
                        service_net,
                        service_tax,
                        service_fee,
                    ),
                )

            write_activity(
                cur,
                request,
                action="Rechnung angelegt",
                entity_type="invoice",
                entity_id=invoice_id,
                customer_id=booking[2],
                performance_id=booking[3],
                booking_id=booking[0],
                description=(
                    f"Rechnung {invoice_number} "
                    f"für Buchung {booking[1]}"
                ),
                new_value=(
                    f"template={data.template_key}; "
                    f"tax_rate={data.tax_rate}; "
                    f"gross={gross_total:.2f}"
                ),
            )

            conn.commit()

    return {
        "success": True,
        "invoice_id": invoice_id,
        "invoice_number": invoice_number,
        "booking_id": booking[0],
        "booking_number": booking[1],
        "template_key": data.template_key,
        "tax_rate": data.tax_rate,
        "net_amount": net_total,
        "tax_amount": tax_total,
        "gross_amount": gross_total,
    }

