from datetime import date, time, datetime, timedelta, timezone
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import psycopg
from psycopg.types.json import Jsonb
import bcrypt
import os
import re
import stripe
import unicodedata
from decimal import Decimal, ROUND_HALF_UP
from dotenv import load_dotenv
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo


PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

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

STRIPE_CHECKOUT_MINUTES = 30
PUBLIC_CHECKOUT_RESERVATION_MINUTES = 14
STRIPE_CURRENCY = "eur"
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "").strip()
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
TICKETSHOP_BASE_URL = os.getenv(
    "TICKETSHOP_BASE_URL",
    "http://127.0.0.1:5174",
).strip().rstrip("/")

EVENT_IMAGE_DIR = Path(__file__).resolve().parent / "uploads" / "events"
MAX_EVENT_IMAGE_BYTES = 8 * 1024 * 1024
EVENT_IMAGE_FILENAME_PATTERN = re.compile(r"^[a-f0-9]{32}\.(?:jpg|png|webp)$")


def detect_event_image_format(content: bytes):
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None

VALID_STATUSES = {
    "reserviert",
    "bezahlt",
    "hinterlegt",
    "storniert",
}


@app.post("/api/admin/users/{user_id}/unlock")
def unlock_user(user_id: int, request: Request):
    actor = require_password_reset_manager(request)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, username, display_name, role
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

            if actor["role"] != "admin" and user[3] == "admin":
                raise HTTPException(
                    status_code=403,
                    detail="Administratorkonten dürfen nur von Administratoren freigeschaltet werden.",
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

            cur.execute(
                """
                ALTER TABLE app_users
                ADD COLUMN IF NOT EXISTS
                    can_manage_password_resets BOOLEAN NOT NULL DEFAULT FALSE
                """
            )

            conn.commit()


ensure_users_table()



@app.get("/api/admin/users")
def get_admin_users(request: Request):
    require_password_reset_manager(request)

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
                    permanently_locked,
                    password_reset_until,
                    can_manage_password_resets
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
            "password_reset_until": (
                row[8].isoformat()
                if row[8]
                else None
            ),
            "can_manage_password_resets": bool(row[9]),
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

    if str(admin_id) == str(user_id):
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
    actor = require_password_reset_manager(request)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, username, display_name, role
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

            if actor["role"] != "admin" and user[3] == "admin":
                raise HTTPException(
                    status_code=403,
                    detail="Passwort-Resets für Administratorkonten dürfen nur Administratoren freigeben.",
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


@app.post("/api/admin/users/{user_id}/toggle-password-reset-permission")
def toggle_password_reset_permission(user_id: int, request: Request):
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
                    can_manage_password_resets
                FROM app_users
                WHERE id = %s
                LIMIT 1
                FOR UPDATE
                """,
                (user_id,),
            )
            user = cur.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
            if user[3] == "admin":
                raise HTTPException(
                    status_code=400,
                    detail="Administratoren besitzen diese Berechtigung bereits automatisch.",
                )

            new_permission = not bool(user[4])
            cur.execute(
                """
                UPDATE app_users
                SET can_manage_password_resets = %s
                WHERE id = %s
                """,
                (new_permission, user_id),
            )

            write_activity(
                cur,
                request,
                action=(
                    "Passwortfreigabe-Berechtigung erteilt"
                    if new_permission
                    else "Passwortfreigabe-Berechtigung entzogen"
                ),
                entity_type="user",
                entity_id=user[0],
                description=(
                    f"Berechtigung für Passwortfreigaben "
                    f"{'erteilt' if new_permission else 'entzogen'}: "
                    f"{user[2]} ({user[1]})"
                ),
            )
            conn.commit()

    return {
        "success": True,
        "user_id": int(user[0]),
        "can_manage_password_resets": new_permission,
        "message": (
            "Berechtigung für Passwortfreigaben wurde erteilt."
            if new_permission
            else "Berechtigung für Passwortfreigaben wurde entzogen."
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
                    permanently_locked,
                    can_manage_password_resets
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
                can_manage_password_resets,
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
        "can_manage_password_resets": bool(can_manage_password_resets),
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


def require_password_reset_manager(request: Request):
    actor_id, _ = get_actor(request)
    if not actor_id:
        raise HTTPException(status_code=401, detail="Anmeldung erforderlich.")

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT role, is_active, can_manage_password_resets
                FROM app_users
                WHERE id = %s
                LIMIT 1
                """,
                (actor_id,),
            )
            user = cur.fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="Benutzer nicht gefunden.")

    role, is_active, can_manage_password_resets = user
    if not is_active:
        raise HTTPException(status_code=403, detail="Benutzer ist deaktiviert.")
    if role != "admin" and not can_manage_password_resets:
        raise HTTPException(
            status_code=403,
            detail="Keine Berechtigung für Passwortfreigaben.",
        )

    return {
        "user_id": int(actor_id),
        "role": role,
        "can_manage_password_resets": bool(can_manage_password_resets),
    }


@app.post("/api/admin/uploads/event-image")
async def upload_event_image(request: Request, image: UploadFile = File(...)):
    require_admin(request)

    declared_type = (image.content_type or "").lower()
    if declared_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(
            status_code=400,
            detail="Bitte nur ein JPG-, PNG- oder WebP-Bild auswählen.",
        )

    content = await image.read(MAX_EVENT_IMAGE_BYTES + 1)
    await image.close()
    if not content:
        raise HTTPException(status_code=400, detail="Die ausgewählte Bilddatei ist leer.")
    if len(content) > MAX_EVENT_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Das Bild darf höchstens 8 MB groß sein.")

    detected = detect_event_image_format(content)
    if not detected:
        raise HTTPException(
            status_code=400,
            detail="Die Datei ist kein gültiges JPG-, PNG- oder WebP-Bild.",
        )

    extension, _media_type = detected
    EVENT_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}.{extension}"
    (EVENT_IMAGE_DIR / filename).write_bytes(content)
    return {"image_url": f"/api/public/event-images/{filename}"}


@app.get("/api/public/event-images/{filename}")
def get_public_event_image(filename: str):
    if not EVENT_IMAGE_FILENAME_PATTERN.fullmatch(filename):
        raise HTTPException(status_code=404, detail="Bild nicht gefunden.")

    image_path = EVENT_IMAGE_DIR / filename
    if not image_path.is_file():
        raise HTTPException(status_code=404, detail="Bild nicht gefunden.")

    media_type = {
        "jpg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
    }[image_path.suffix.lstrip(".")]
    return FileResponse(image_path, media_type=media_type)


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


def ensure_invoice_module_tables():
    """Ergänzt das lokale Rechnungsmodul ohne bestehende Daten zu löschen."""
    default_template_data = {
        "sender_line": "Boulevardtheater - Bahnhofstraße 11 - 67146 Deidesheim",
        "company_name": "Boulevardtheater Deidesheim e. V.",
        "tax_number": "3166802088",
        "iban": "DE60 5469 1200 0113 5388 05",
        "bank_name": "VR Bank Mittelhaardt eG",
        "payment_text": "Bitte überweisen Sie den Betrag direkt nach Erhalt der Rechnung auf unser Konto.",
        "reference_label": "Verwendungszweck / Referenz Nr.",
        "thank_you_text": "Vielen Dank und bis bald im Boulevardtheater!",
        "exchange_text": "Die Karten sind aus organisatorischen Gründen vom Umtausch ausgeschlossen!",
        "footer_lines": [
            "Boulevardtheater Deidesheim e. V. - Bahnhofstraße 11",
            "67146 Deidesheim - Ticket-Hotline: 06326-2558855 - www.boulevard-deidesheim.de",
            "Mail: info@boulevard-deidesheim.de",
        ],
        "sequence_width": 3,
        "items": [
            {
                "key": "tickets",
                "description": "Eintrittskarte",
                "source": "tickets",
                "tax_rate": 7,
                "append_event_details": True,
            },
            {
                "key": "service",
                "description": "Servicepauschale",
                "source": "service_percent",
                "percentage": 10,
                "tax_rate": 19,
            },
        ],
    }

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS invoice_templates (
                    id BIGSERIAL PRIMARY KEY,
                    template_key TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    is_active BOOLEAN NOT NULL DEFAULT TRUE
                )
                """
            )
            cur.execute(
                """
                ALTER TABLE invoice_templates
                ADD COLUMN IF NOT EXISTS performance_id BIGINT NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE invoice_templates
                ADD COLUMN IF NOT EXISTS template_data JSONB
                NOT NULL DEFAULT '{}'::jsonb
                """
            )
            cur.execute(
                """
                ALTER TABLE invoice_templates
                ADD COLUMN IF NOT EXISTS number_prefix TEXT
                NOT NULL DEFAULT 'RE'
                """
            )
            cur.execute(
                """
                ALTER TABLE invoice_templates
                ADD COLUMN IF NOT EXISTS number_suffix TEXT
                NOT NULL DEFAULT ''
                """
            )
            cur.execute(
                """
                ALTER TABLE invoice_templates
                ADD COLUMN IF NOT EXISTS number_sequence_start BIGINT
                NOT NULL DEFAULT 1
                """
            )
            cur.execute(
                """
                ALTER TABLE invoice_templates
                ADD COLUMN IF NOT EXISTS default_tax_rate NUMERIC(5, 2)
                NOT NULL DEFAULT 19
                """
            )
            cur.execute(
                """
                ALTER TABLE invoice_templates
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE
                NOT NULL DEFAULT CURRENT_TIMESTAMP
                """
            )
            cur.execute(
                """
                ALTER TABLE invoice_templates
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE
                NOT NULL DEFAULT CURRENT_TIMESTAMP
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS invoice_templates_performance_idx
                ON invoice_templates (performance_id)
                """
            )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS tax_rates (
                    id BIGSERIAL PRIMARY KEY,
                    label TEXT NOT NULL,
                    rate NUMERIC(5, 2) NOT NULL,
                    is_default BOOLEAN NOT NULL DEFAULT FALSE,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE
                )
                """
            )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS tax_rates_rate_unique_idx
                ON tax_rates (rate)
                """
            )
            for rate, label, is_default in (
                (0, "0 %", False),
                (7, "7 %", True),
                (19, "19 %", False),
            ):
                cur.execute(
                    """
                    INSERT INTO tax_rates (label, rate, is_default, is_active)
                    VALUES (%s, %s, %s, TRUE)
                    ON CONFLICT (rate) DO NOTHING
                    """,
                    (label, rate, is_default),
                )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS invoices (
                    id BIGSERIAL PRIMARY KEY,
                    booking_id BIGINT NOT NULL,
                    invoice_number TEXT NOT NULL,
                    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
                    due_date DATE NULL,
                    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'offen',
                    invoice_type TEXT NOT NULL DEFAULT 'standard',
                    template_key TEXT NOT NULL DEFAULT 'RE1',
                    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
                    net_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    gross_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    payment_status TEXT NOT NULL DEFAULT 'offen',
                    created_at TIMESTAMP WITHOUT TIME ZONE
                        NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            invoice_columns = (
                ("template_id", "BIGINT NULL"),
                ("sequence_number", "BIGINT NULL"),
                ("reference_number", "TEXT NULL"),
                ("recipient_snapshot", "JSONB NOT NULL DEFAULT '{}'::jsonb"),
                ("template_snapshot", "JSONB NOT NULL DEFAULT '{}'::jsonb"),
                ("tax_breakdown", "JSONB NOT NULL DEFAULT '[]'::jsonb"),
                ("notes", "TEXT NOT NULL DEFAULT ''"),
                ("finalized_at", "TIMESTAMP WITHOUT TIME ZONE NULL"),
                ("updated_at", "TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP"),
            )
            for column_name, definition in invoice_columns:
                cur.execute(
                    f"ALTER TABLE invoices ADD COLUMN IF NOT EXISTS {column_name} {definition}"
                )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_number_unique_idx
                ON invoices (invoice_number)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS invoices_booking_id_idx
                ON invoices (booking_id)
                """
            )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS invoice_items (
                    id BIGSERIAL PRIMARY KEY,
                    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                    position_no INTEGER NOT NULL,
                    description TEXT NOT NULL,
                    quantity NUMERIC(10, 2) NOT NULL,
                    unit_price NUMERIC(12, 2) NOT NULL,
                    tax_rate NUMERIC(5, 2) NOT NULL,
                    net_amount NUMERIC(12, 2) NOT NULL,
                    tax_amount NUMERIC(12, 2) NOT NULL,
                    gross_amount NUMERIC(12, 2) NOT NULL
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS invoice_items_invoice_id_idx
                ON invoice_items (invoice_id, position_no)
                """
            )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS invoice_number_counter (
                    counter_key TEXT PRIMARY KEY,
                    last_value BIGINT NOT NULL,
                    updated_at TIMESTAMP WITHOUT TIME ZONE
                        NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS invoice_module_migrations (
                    migration_key TEXT PRIMARY KEY,
                    applied_at TIMESTAMP WITHOUT TIME ZONE
                        NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            cur.execute(
                """
                INSERT INTO invoice_number_counter (counter_key, last_value)
                VALUES ('global', 133)
                ON CONFLICT (counter_key) DO UPDATE
                SET last_value = GREATEST(
                    invoice_number_counter.last_value,
                    EXCLUDED.last_value
                )
                """
            )

            # Bereits vorhandene Rechnungen in den neuen globalen Zähler
            # übernehmen. Das dritte Segment enthält beim gewünschten
            # Format (z. B. DWH-27-133-10) die laufende Nummer.
            cur.execute(
                """
                UPDATE invoices
                SET sequence_number = split_part(invoice_number, '-', 3)::BIGINT
                WHERE sequence_number IS NULL
                  AND split_part(invoice_number, '-', 3) ~ '^[0-9]+$'
                """
            )
            cur.execute(
                """
                UPDATE invoice_number_counter
                SET
                    last_value = GREATEST(
                        last_value,
                        COALESCE(
                            (SELECT MAX(sequence_number) FROM invoices),
                            0
                        )
                    ),
                    updated_at = NOW()
                WHERE counter_key = 'global'
                """
            )

            cur.execute(
                """
                INSERT INTO invoice_templates (
                    template_key,
                    name,
                    description,
                    template_data,
                    number_prefix,
                    number_suffix,
                    number_sequence_start,
                    default_tax_rate,
                    is_active
                )
                VALUES (
                    'DWH',
                    'Dinnershow – Excel-Vorlage',
                    'Grundlayout nach der bereitgestellten Dinnershow-Rechnung.',
                    %s,
                    'DWH',
                    '10',
                    134,
                    7,
                    TRUE
                )
                ON CONFLICT (template_key) DO NOTHING
                """,
                (Jsonb(default_template_data),),
            )

            # Einmalige Korrektur für bereits lokal angelegte DWH-Vorlagen:
            # Service = 10 % des Ticket-Bruttowerts, darauf 19 % MwSt.
            cur.execute(
                """
                SELECT 1
                FROM invoice_module_migrations
                WHERE migration_key = 'invoice_service_10_percent_v1'
                LIMIT 1
                """
            )
            if not cur.fetchone():
                cur.execute(
                    """
                    UPDATE invoice_templates
                    SET
                        template_data = jsonb_set(
                            template_data,
                            '{items}',
                            COALESCE(
                                (
                                    SELECT jsonb_agg(
                                        CASE
                                            WHEN item->>'source' = 'service'
                                            THEN item || jsonb_build_object(
                                                'description', 'Servicepauschale',
                                                'source', 'service_percent',
                                                'percentage', 10,
                                                'tax_rate', 19
                                            )
                                            ELSE item
                                        END
                                        ORDER BY position
                                    )
                                    FROM jsonb_array_elements(
                                        template_data->'items'
                                    ) WITH ORDINALITY AS template_item(item, position)
                                ),
                                '[]'::jsonb
                            ),
                            TRUE
                        ),
                        updated_at = NOW()
                    WHERE template_key = 'DWH'
                    """
                )
                cur.execute(
                    """
                    INSERT INTO invoice_module_migrations (migration_key)
                    VALUES ('invoice_service_10_percent_v1')
                    """
                )

            # Die Theater-Stammdaten gelten für alle manuellen Rechnungen.
            # Bestehende Vorlagen behalten ihre Positionen und Nummernlogik,
            # erhalten aber einmalig die verbindlichen Absender-/Bankdaten.
            cur.execute(
                """
                SELECT 1
                FROM invoice_module_migrations
                WHERE migration_key = 'invoice_master_data_20260902_v1'
                LIMIT 1
                """
            )
            if not cur.fetchone():
                cur.execute("SELECT id, template_data FROM invoice_templates")
                for template_id, stored_data in cur.fetchall():
                    corrected_data = dict(stored_data) if isinstance(stored_data, dict) else {}
                    corrected_data.update(
                        {
                            "sender_line": "Boulevardtheater - Bahnhofstraße 11 - 67146 Deidesheim",
                            "company_name": "Boulevardtheater Deidesheim e. V.",
                            "tax_number": "3166802088",
                            "iban": "DE60 5469 1200 0113 5388 05",
                            "bank_name": "VR Bank Mittelhaardt eG",
                            "payment_text": "Bitte überweisen Sie den Betrag direkt nach Erhalt der Rechnung auf unser Konto.",
                            "reference_label": "Verwendungszweck / Referenz Nr.",
                            "thank_you_text": "Vielen Dank und bis bald im Boulevardtheater!",
                            "exchange_text": "Die Karten sind aus organisatorischen Gründen vom Umtausch ausgeschlossen!",
                            "footer_lines": [
                                "Boulevardtheater Deidesheim e. V. - Bahnhofstraße 11",
                                "67146 Deidesheim - Ticket-Hotline: 06326-2558855 - www.boulevard-deidesheim.de",
                                "Mail: info@boulevard-deidesheim.de",
                            ],
                        }
                    )
                    corrected_data.pop("processor", None)
                    cur.execute(
                        """
                        UPDATE invoice_templates
                        SET template_data = %s, updated_at = NOW()
                        WHERE id = %s
                        """,
                        (Jsonb(corrected_data), template_id),
                    )
                cur.execute(
                    """
                    INSERT INTO invoice_module_migrations (migration_key)
                    VALUES ('invoice_master_data_20260902_v1')
                    """
                )

            conn.commit()


def ensure_public_checkout_tables():
    """Legt transaktionssichere Stripe-Bestellungen und Platzhalter an."""
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS public_checkout_orders (
                    id TEXT PRIMARY KEY,
                    performance_id BIGINT NOT NULL,
                    stripe_checkout_session_id TEXT UNIQUE NULL,
                    stripe_payment_intent_id TEXT UNIQUE NULL,
                    booking_id BIGINT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    quantity INTEGER NOT NULL CHECK (quantity > 0),
                    seat_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                    delivery_method TEXT NOT NULL,
                    customer_first_name TEXT NOT NULL,
                    customer_last_name TEXT NOT NULL,
                    customer_email TEXT NOT NULL,
                    customer_phone TEXT NOT NULL DEFAULT '',
                    customer_street TEXT NOT NULL DEFAULT '',
                    customer_postal_code TEXT NOT NULL DEFAULT '',
                    customer_city TEXT NOT NULL DEFAULT '',
                    items JSONB NOT NULL DEFAULT '[]'::jsonb,
                    total_gross NUMERIC(12, 2) NOT NULL,
                    currency TEXT NOT NULL DEFAULT 'eur',
                    expires_at TIMESTAMPTZ NOT NULL,
                    paid_at TIMESTAMPTZ NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS
                public_checkout_orders_performance_status_idx
                ON public_checkout_orders (
                    performance_id,
                    status,
                    expires_at
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS public_checkout_seat_holds (
                    order_id TEXT NOT NULL
                        REFERENCES public_checkout_orders(id)
                        ON DELETE CASCADE,
                    performance_id BIGINT NOT NULL,
                    seat_id BIGINT NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY (performance_id, seat_id)
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS
                public_checkout_seat_holds_expiry_idx
                ON public_checkout_seat_holds (expires_at)
                """
            )
            cur.execute(
                """
                ALTER TABLE bookings
                ADD COLUMN IF NOT EXISTS delivery_method TEXT
                NOT NULL DEFAULT 'email'
                """
            )
            cur.execute(
                """
                ALTER TABLE bookings
                ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12, 2)
                NOT NULL DEFAULT 0
                """
            )
            cur.execute(
                """
                ALTER TABLE bookings
                ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE bookings
                ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT NULL
                """
            )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS
                bookings_stripe_checkout_session_uidx
                ON bookings (stripe_checkout_session_id)
                WHERE stripe_checkout_session_id IS NOT NULL
                """
            )
        conn.commit()


@app.on_event("startup")
def startup():
    ensure_audit_log_table()
    ensure_hall_plan_type_column()
    ensure_public_performance_columns()
    ensure_tischsaal_seats()
    ensure_invoice_module_tables()
    ensure_public_checkout_tables()


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


def ensure_public_performance_columns():
    """Erweitert bestehende Vorstellungen ohne vorhandene Daten zu löschen."""
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS short_description TEXT
                NOT NULL DEFAULT ''
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS description TEXT
                NOT NULL DEFAULT ''
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS image_url TEXT
                NOT NULL DEFAULT ''
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS venue_name TEXT
                NOT NULL DEFAULT ''
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS doors_time TIME NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS sales_start_at TIMESTAMPTZ NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS sales_end_at TIMESTAMPTZ NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS publication_status TEXT
                NOT NULL DEFAULT 'draft'
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS seating_mode TEXT
                NOT NULL DEFAULT 'assigned'
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS capacity INTEGER NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS price_from NUMERIC(10, 2)
                NOT NULL DEFAULT 0
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS max_tickets_per_order INTEGER
                NOT NULL DEFAULT 10
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS public_slug TEXT NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS ticket_price_net NUMERIC(10, 2) NULL
                """
            )
            cur.execute(
                """
                UPDATE performances
                SET ticket_price_net = price_from
                WHERE ticket_price_net IS NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ALTER COLUMN ticket_price_net SET DEFAULT 0,
                ALTER COLUMN ticket_price_net SET NOT NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS ticket_vat_rate INTEGER
                NOT NULL DEFAULT 0
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS service_fee_net NUMERIC(10, 2)
                NOT NULL DEFAULT 0
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS service_vat_rate INTEGER
                NOT NULL DEFAULT 19
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS additional_fee_name TEXT
                NOT NULL DEFAULT ''
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS additional_fee_net NUMERIC(10, 2)
                NOT NULL DEFAULT 0
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS additional_fee_vat_rate INTEGER
                NOT NULL DEFAULT 19
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS price_items JSONB
                NOT NULL DEFAULT '[]'::jsonb
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS service_fee_percent NUMERIC(5, 2)
                NOT NULL DEFAULT 10
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS postal_shipping_gross NUMERIC(10, 2)
                NOT NULL DEFAULT 0
                """
            )
            cur.execute(
                """
                ALTER TABLE performances
                ADD COLUMN IF NOT EXISTS postal_shipping_vat_rate INTEGER
                NOT NULL DEFAULT 19
                """
            )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS
                performances_public_slug_idx
                ON performances (public_slug)
                WHERE public_slug IS NOT NULL
                """
            )

            cur.execute(
                """
                SELECT id, title
                FROM performances
                WHERE public_slug IS NULL OR public_slug = ''
                """
            )

            for performance_id, title in cur.fetchall():
                cur.execute(
                    """
                    UPDATE performances
                    SET public_slug = %s
                    WHERE id = %s
                    """,
                    (
                        make_public_slug(title, performance_id),
                        performance_id,
                    ),
                )
        conn.commit()


# ============================================================
# DATENMODELLE
# ============================================================

class PerformancePriceItemCreate(BaseModel):
    category: str
    name: str
    gross_amount: float
    vat_rate: int
    provider_type: str = "internal"
    provider_name: str = ""


class PerformanceCreate(BaseModel):
    title: str
    performance_date: date
    start_time: time
    hall_plan_type: str = "hall_1"
    short_description: str = ""
    description: str = ""
    image_url: str = ""
    venue_name: str = ""
    doors_time: time | None = None
    sales_start_at: datetime | None = None
    sales_end_at: datetime | None = None
    publication_status: str = "draft"
    seating_mode: str = "assigned"
    capacity: int | None = None
    price_from: float = 0
    max_tickets_per_order: int = 10
    ticket_price_net: float = 0
    ticket_vat_rate: int = 7
    service_fee_net: float = 0
    service_vat_rate: int = 19
    additional_fee_name: str = ""
    additional_fee_net: float = 0
    additional_fee_vat_rate: int = 19
    price_items: list[PerformancePriceItemCreate] = Field(default_factory=list)
    service_fee_percent: float = 10
    postal_shipping_gross: float = 0
    postal_shipping_vat_rate: int = 19


PUBLICATION_STATUSES = {
    "draft",
    "published",
    "sold_out",
    "cancelled",
}

SEATING_MODES = {
    "assigned",
    "staff_assigned",
    "free",
}

VAT_RATES = {0, 7, 19}
PRICE_ITEM_CATEGORIES = {"ticket", "food", "drink", "other"}
PROVIDER_TYPES = {"internal", "external"}
SERVICE_FEE_PERCENT = Decimal("10.00")


def calculate_price_component(net_value, vat_rate: int):
    net = Decimal(str(net_value or 0)).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    vat = (net * Decimal(vat_rate) / Decimal(100)).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    return {
        "net": float(net),
        "vat_rate": vat_rate,
        "vat": float(vat),
        "gross": float(net + vat),
    }


def calculate_price_breakdown(
    ticket_price_net,
    ticket_vat_rate: int,
    service_fee_net,
    service_vat_rate: int,
    additional_fee_name: str,
    additional_fee_net,
    additional_fee_vat_rate: int,
):
    ticket = calculate_price_component(ticket_price_net, ticket_vat_rate)
    service = calculate_price_component(service_fee_net, service_vat_rate)
    additional = calculate_price_component(
        additional_fee_net,
        additional_fee_vat_rate,
    )

    total_net = Decimal(str(ticket["net"])) + Decimal(str(service["net"])) + Decimal(str(additional["net"]))
    total_vat = Decimal(str(ticket["vat"])) + Decimal(str(service["vat"])) + Decimal(str(additional["vat"]))
    total_gross = total_net + total_vat

    return {
        "ticket": ticket,
        "service": service,
        "additional": {
            "name": additional_fee_name.strip(),
            **additional,
        },
        "total_net": float(total_net),
        "total_vat": float(total_vat),
        "total_gross": float(total_gross),
    }


def calculate_gross_price_component(item):
    gross = Decimal(str(item.get("gross_amount", 0) or 0)).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    vat_rate = int(item.get("vat_rate", 0) or 0)
    divisor = Decimal("1") + Decimal(vat_rate) / Decimal("100")
    net = (gross / divisor).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    vat = gross - net

    return {
        "category": item.get("category", "other"),
        "name": str(item.get("name", "")).strip(),
        "provider_type": item.get("provider_type", "internal"),
        "provider_name": str(item.get("provider_name", "")).strip(),
        "gross": float(gross),
        "net": float(net),
        "vat_rate": vat_rate,
        "vat": float(vat),
    }


def calculate_structured_price_breakdown(price_items, service_vat_rate: int):
    items = [calculate_gross_price_component(item) for item in price_items]
    items.sort(
        key=lambda item: Decimal(str(item["gross"])),
        reverse=True,
    )
    subtotal_gross = sum(
        (Decimal(str(item["gross"])) for item in items),
        Decimal("0"),
    )
    service_gross = (
        subtotal_gross * SERVICE_FEE_PERCENT / Decimal("100")
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    service = calculate_gross_price_component(
        {
            "category": "service",
            "name": "Servicepauschale",
            "gross_amount": service_gross,
            "vat_rate": service_vat_rate,
            "provider_type": "external",
            "provider_name": "",
        }
    )

    total_net = sum(
        (Decimal(str(item["net"])) for item in items),
        Decimal("0"),
    ) + Decimal(str(service["net"]))
    total_vat = sum(
        (Decimal(str(item["vat"])) for item in items),
        Decimal("0"),
    ) + Decimal(str(service["vat"]))
    total_gross = subtotal_gross + service_gross

    return {
        "items": items,
        "service": service,
        "service_fee_percent": float(SERVICE_FEE_PERCENT),
        "subtotal_gross": float(subtotal_gross),
        "total_net": float(total_net),
        "total_vat": float(total_vat),
        "total_gross": float(total_gross),
    }


def make_public_slug(title: str, performance_id: int) -> str:
    normalized = unicodedata.normalize("NFKD", title)
    ascii_title = normalized.encode("ascii", "ignore").decode("ascii")
    base = re.sub(r"[^a-z0-9]+", "-", ascii_title.lower()).strip("-")
    return f"{base or 'event'}-{performance_id}"


def performance_to_dict(row):
    price_items = row[26] if isinstance(row[26], list) else []

    if price_items:
        price_breakdown = calculate_structured_price_breakdown(
            price_items,
            int(row[22] or 19),
        )
    else:
        price_breakdown = calculate_price_breakdown(
            row[19],
            int(row[20] or 0),
            row[21],
            int(row[22] or 0),
            row[23] or "",
            row[24],
            int(row[25] or 0),
        )

    return {
        "id": row[0],
        "title": row[1],
        "performance_date": row[2].isoformat(),
        "start_time": row[3].isoformat(),
        "created_at": row[4].isoformat() if row[4] else None,
        "hall_plan_type": row[5] or "hall_1",
        "short_description": row[6] or "",
        "description": row[7] or "",
        "image_url": row[8] or "",
        "venue_name": row[9] or "",
        "doors_time": row[10].isoformat() if row[10] else None,
        "sales_start_at": row[11].isoformat() if row[11] else None,
        "sales_end_at": row[12].isoformat() if row[12] else None,
        "publication_status": row[13] or "draft",
        "seating_mode": row[14] or "assigned",
        "capacity": row[15],
        "price_from": float(row[16] or 0),
        "max_tickets_per_order": int(row[17] or 10),
        "public_slug": row[18] or "",
        "ticket_price_net": float(row[19] or 0),
        "ticket_vat_rate": int(row[20] or 0),
        "service_fee_net": float(row[21] or 0),
        "service_vat_rate": int(row[22] or 0),
        "additional_fee_name": row[23] or "",
        "additional_fee_net": float(row[24] or 0),
        "additional_fee_vat_rate": int(row[25] or 0),
        "price_items": price_items,
        "service_fee_percent": float(row[27] or 10),
        "postal_shipping_gross": float(row[28] or 0),
        "postal_shipping_vat_rate": int(row[29] or 19),
        "price_breakdown": price_breakdown,
    }


PERFORMANCE_SELECT_COLUMNS = """
    id,
    title,
    performance_date,
    start_time,
    created_at,
    hall_plan_type,
    short_description,
    description,
    image_url,
    venue_name,
    doors_time,
    sales_start_at,
    sales_end_at,
    publication_status,
    seating_mode,
    capacity,
    price_from,
    max_tickets_per_order,
    public_slug,
    ticket_price_net,
    ticket_vat_rate,
    service_fee_net,
    service_vat_rate,
    additional_fee_name,
    additional_fee_net,
    additional_fee_vat_rate,
    price_items,
    service_fee_percent,
    postal_shipping_gross,
    postal_shipping_vat_rate
"""


def calculate_booking_price_snapshot(performance_row, ticket_count: int):
    """Ermittelt den festen Vorverkaufspreis einer Buchung aus dem Event."""
    performance = performance_to_dict(performance_row)
    breakdown = performance["price_breakdown"]

    if performance["price_items"]:
        ticket_unit_gross = Decimal(
            str(breakdown.get("subtotal_gross", 0) or 0)
        )
    else:
        ticket_unit_gross = Decimal(
            str(breakdown.get("ticket", {}).get("gross", 0) or 0)
        ) + Decimal(
            str(breakdown.get("additional", {}).get("gross", 0) or 0)
        )

    ticket_unit_gross = ticket_unit_gross.quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    service_total_gross = (
        ticket_unit_gross
        * Decimal(ticket_count)
        * SERVICE_FEE_PERCENT
        / Decimal("100")
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    return float(ticket_unit_gross), float(service_total_gross)


def validate_performance_data(data: PerformanceCreate):
    if not data.title.strip():
        raise HTTPException(status_code=400, detail="Titel fehlt.")

    if data.publication_status not in PUBLICATION_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Ungültiger Veröffentlichungsstatus.",
        )

    if data.seating_mode not in SEATING_MODES:
        raise HTTPException(
            status_code=400,
            detail="Ungültige Platzwahl.",
        )

    if data.price_from < 0:
        raise HTTPException(
            status_code=400,
            detail="Der Preis darf nicht negativ sein.",
        )

    for amount in (
        data.ticket_price_net,
        data.service_fee_net,
        data.additional_fee_net,
        data.postal_shipping_gross,
    ):
        if amount < 0:
            raise HTTPException(
                status_code=400,
                detail="Kosten dürfen nicht negativ sein.",
            )

    for vat_rate in (
        data.ticket_vat_rate,
        data.service_vat_rate,
        data.additional_fee_vat_rate,
        data.postal_shipping_vat_rate,
    ):
        if vat_rate not in VAT_RATES:
            raise HTTPException(
                status_code=400,
                detail="Als MwSt. sind nur 0 %, 7 % oder 19 % zulässig.",
            )

    if data.additional_fee_net > 0 and not data.additional_fee_name.strip():
        raise HTTPException(
            status_code=400,
            detail="Bitte die sonstigen Kosten benennen.",
        )

    if Decimal(str(data.service_fee_percent)) != SERVICE_FEE_PERCENT:
        raise HTTPException(
            status_code=400,
            detail="Die Servicepauschale beträgt fest 10 %.",
        )

    if len(data.price_items) > 20:
        raise HTTPException(
            status_code=400,
            detail="Pro Veranstaltung sind höchstens 20 Preispositionen möglich.",
        )

    if data.price_items:
        ticket_items = [
            item for item in data.price_items if item.category == "ticket"
        ]

        if len(ticket_items) != 1:
            raise HTTPException(
                status_code=400,
                detail="Es muss genau eine interne Ticketposition geben.",
            )

        for item in data.price_items:
            if item.category not in PRICE_ITEM_CATEGORIES:
                raise HTTPException(
                    status_code=400,
                    detail="Ungültige Preisposition.",
                )

            if not item.name.strip():
                raise HTTPException(
                    status_code=400,
                    detail="Jede Preisposition benötigt eine Bezeichnung.",
                )

            if item.gross_amount < 0:
                raise HTTPException(
                    status_code=400,
                    detail="Preise dürfen nicht negativ sein.",
                )

            if item.vat_rate not in VAT_RATES:
                raise HTTPException(
                    status_code=400,
                    detail="Als MwSt. sind nur 0 %, 7 % oder 19 % zulässig.",
                )

            if item.provider_type not in PROVIDER_TYPES:
                raise HTTPException(
                    status_code=400,
                    detail="Ungültiger Leistungsempfänger.",
                )

            if item.category == "ticket" and item.provider_type != "internal":
                raise HTTPException(
                    status_code=400,
                    detail="Der Ticketpreis muss als interne Leistung geführt werden.",
                )

            if (
                data.publication_status != "draft"
                and item.provider_type == "external"
                and not item.provider_name.strip()
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Bei externen Positionen muss der Anbieter angegeben werden.",
                )

    if not 1 <= data.max_tickets_per_order <= 50:
        raise HTTPException(
            status_code=400,
            detail="Pro Bestellung sind 1 bis 50 Tickets möglich.",
        )

    if data.capacity is not None and data.capacity < 1:
        raise HTTPException(
            status_code=400,
            detail="Das Kontingent muss mindestens 1 betragen.",
        )

    if data.seating_mode == "free" and data.capacity is None:
        raise HTTPException(
            status_code=400,
            detail="Bei freier Platzwahl muss ein Kontingent angegeben werden.",
        )

    if (
        data.sales_start_at
        and data.sales_end_at
        and data.sales_end_at <= data.sales_start_at
    ):
        raise HTTPException(
            status_code=400,
            detail="Das Verkaufsende muss nach dem Verkaufsstart liegen.",
        )

    if data.publication_status != "draft" and not data.venue_name.strip():
        raise HTTPException(
            status_code=400,
            detail="Vor der Veröffentlichung muss ein Veranstaltungsort angegeben werden.",
        )


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


class PublicCheckoutCustomer(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str = ""
    street: str = ""
    postal_code: str = ""
    city: str = ""


class PublicCheckoutPreviewRequest(BaseModel):
    performance_id: int
    quantity: int
    seat_ids: list[int] = Field(default_factory=list)
    reservation_id: str = ""
    delivery_method: str = "email"
    customer: PublicCheckoutCustomer
    accepted_terms: bool = False
    accepted_privacy: bool = False


class PublicCheckoutHoldRequest(BaseModel):
    performance_id: int
    quantity: int
    seat_ids: list[int] = Field(default_factory=list)
    reservation_id: str = ""



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
                f"""
                SELECT {PERFORMANCE_SELECT_COLUMNS}
                FROM performances
                ORDER BY
                    performance_date ASC,
                    start_time ASC,
                    id ASC
                """
            )

            rows = cur.fetchall()
    return [performance_to_dict(row) for row in rows]


@app.get("/api/performances/{performance_id}")
def get_performance(
    performance_id: int
):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {PERFORMANCE_SELECT_COLUMNS}
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

    return performance_to_dict(row)


@app.get("/api/public/events")
def get_public_events():
    """Liefert nur bewusst veröffentlichte Veranstaltungen aus."""
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {PERFORMANCE_SELECT_COLUMNS}
                FROM performances
                WHERE publication_status IN (
                    'published',
                    'sold_out',
                    'cancelled'
                )
                AND (
                    sales_start_at IS NULL
                    OR sales_start_at <= CURRENT_TIMESTAMP
                )
                AND performance_date >= CURRENT_DATE
                ORDER BY
                    performance_date ASC,
                    start_time ASC,
                    id ASC
                """
            )

            rows = cur.fetchall()

    return [performance_to_dict(row) for row in rows]


@app.get("/api/public/events/{performance_id}")
def get_public_event(performance_id: int):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {PERFORMANCE_SELECT_COLUMNS}
                FROM performances
                WHERE id = %s
                AND publication_status IN (
                    'published',
                    'sold_out',
                    'cancelled'
                )
                AND (
                    sales_start_at IS NULL
                    OR sales_start_at <= CURRENT_TIMESTAMP
                )
                """,
                (performance_id,),
            )

            row = cur.fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Veranstaltung nicht gefunden oder noch nicht veröffentlicht.",
        )

    return performance_to_dict(row)


def public_seat_filter(hall_plan_type: str):
    if hall_plan_type == "hall_2":
        return "s.hall_type = 'tischsaal'"

    return (
        "COALESCE(s.hall_type, '') <> 'tischsaal' "
        "AND s.row_number BETWEEN 1 AND 9"
    )


def expire_public_checkout_holds(cur):
    """Gibt abgelaufene Reservierungen frei und schließt offene Stripe-Sessions."""
    cur.execute(
        """
        SELECT id, stripe_checkout_session_id
        FROM public_checkout_orders
        WHERE status = 'pending'
        AND expires_at <= CURRENT_TIMESTAMP
        FOR UPDATE
        """
    )
    expired_orders = cur.fetchall()

    for order_id, session_id in expired_orders:
        if session_id:
            try:
                session = stripe.checkout.Session.retrieve(
                    session_id,
                    api_key=STRIPE_SECRET_KEY,
                )
                session = stripe_payload_to_dict(session)
                if session.get("payment_status") in {
                    "paid",
                    "no_payment_required",
                }:
                    # Eine bereits bestätigte Zahlung darf nie freigegeben werden.
                    safety_expiry = datetime.now(timezone.utc) + timedelta(
                        minutes=5,
                    )
                    cur.execute(
                        """
                        UPDATE public_checkout_orders
                        SET expires_at = %s, updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s AND status = 'pending'
                        """,
                        (safety_expiry, order_id),
                    )
                    cur.execute(
                        """
                        UPDATE public_checkout_seat_holds
                        SET expires_at = %s
                        WHERE order_id = %s
                        """,
                        (safety_expiry, order_id),
                    )
                    continue
                if session.get("status") == "open":
                    stripe.checkout.Session.expire(
                        session_id,
                        api_key=STRIPE_SECRET_KEY,
                    )
            except Exception as exc:
                # Bei einer gestörten Stripe-Verbindung bleiben Plätze lieber
                # kurz länger reserviert, statt doppelt verkauft zu werden.
                print(f"Abgelaufene Stripe-Session konnte nicht beendet werden: {exc}")
                safety_expiry = datetime.now(timezone.utc) + timedelta(
                    minutes=1,
                )
                cur.execute(
                    """
                    UPDATE public_checkout_orders
                    SET expires_at = %s, updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s AND status = 'pending'
                    """,
                    (safety_expiry, order_id),
                )
                cur.execute(
                    """
                    UPDATE public_checkout_seat_holds
                    SET expires_at = %s
                    WHERE order_id = %s
                    """,
                    (safety_expiry, order_id),
                )
                continue

        cur.execute(
            """
            UPDATE public_checkout_orders
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = %s AND status = 'pending'
            """,
            (order_id,),
        )

    cur.execute(
        """
        DELETE FROM public_checkout_seat_holds
        WHERE order_id IN (
            SELECT id
            FROM public_checkout_orders
            WHERE status <> 'pending'
        )
        """
    )


def public_free_capacity(
    cur,
    performance_id: int,
    capacity: int | None,
    excluded_order_id: str | None = None,
):
    if capacity is None:
        return 0

    cur.execute(
        """
        SELECT COALESCE(SUM(ticket_count), 0)
        FROM bookings
        WHERE performance_id = %s
        AND LOWER(COALESCE(status, 'reserviert')) <> 'storniert'
        """,
        (performance_id,),
    )
    reserved = int(cur.fetchone()[0] or 0)
    cur.execute(
        """
        SELECT COALESCE(SUM(quantity), 0)
        FROM public_checkout_orders
        WHERE performance_id = %s
        AND status = 'pending'
        AND expires_at > CURRENT_TIMESTAMP
        AND (%s = FALSE OR id <> %s)
        """,
        (
            performance_id,
            excluded_order_id is not None,
            excluded_order_id or "",
        ),
    )
    held = int(cur.fetchone()[0] or 0)
    return max(0, int(capacity) - reserved - held)


def public_hall_capacity(cur, hall_plan_type: str):
    """Ermittelt das aktive Kontingent direkt aus dem gewählten Saalplan."""
    seat_filter = public_seat_filter(hall_plan_type)
    cur.execute(
        f"""
        SELECT COUNT(*)
        FROM seats s
        WHERE s.is_active = TRUE
        AND {seat_filter}
        """
    )
    return int(cur.fetchone()[0] or 0)


@app.get("/api/public/events/{performance_id}/availability")
def get_public_event_availability(
    performance_id: int,
    reservation_id: str | None = None,
):
    """Gibt nur Platzstatus aus, niemals Kunden- oder Buchungsdaten."""
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            expire_public_checkout_holds(cur)
            cur.execute(
                f"""
                SELECT {PERFORMANCE_SELECT_COLUMNS}
                FROM performances
                WHERE id = %s
                AND publication_status IN (
                    'published',
                    'sold_out',
                    'cancelled'
                )
                AND (
                    sales_start_at IS NULL
                    OR sales_start_at <= CURRENT_TIMESTAMP
                )
                """,
                (performance_id,),
            )
            performance_row = cur.fetchone()

            if not performance_row:
                raise HTTPException(
                    status_code=404,
                    detail="Veranstaltung nicht gefunden oder noch nicht veröffentlicht.",
                )

            performance = performance_to_dict(performance_row)
            own_reservation_id = None
            if reservation_id and re.fullmatch(r"[a-f0-9]{32}", reservation_id):
                cur.execute(
                    """
                    SELECT id
                    FROM public_checkout_orders
                    WHERE id = %s
                    AND performance_id = %s
                    AND status = 'pending'
                    AND stripe_checkout_session_id IS NULL
                    AND expires_at > CURRENT_TIMESTAMP
                    """,
                    (reservation_id, performance_id),
                )
                if cur.fetchone():
                    own_reservation_id = reservation_id

            if performance["seating_mode"] in {"free", "staff_assigned"}:
                capacity = performance["capacity"]
                if performance["seating_mode"] == "staff_assigned":
                    capacity = public_hall_capacity(
                        cur,
                        performance["hall_plan_type"],
                    )

                available_count = public_free_capacity(
                    cur,
                    performance_id,
                    capacity,
                    own_reservation_id,
                )
                return {
                    "performance_id": performance_id,
                    "seating_mode": performance["seating_mode"],
                    "total_capacity": int(capacity or 0),
                    "available_count": available_count,
                    "seats": [],
                }

            seat_filter = public_seat_filter(
                performance["hall_plan_type"],
            )
            cur.execute(
                f"""
                SELECT
                    s.id,
                    s.row_number,
                    s.seat_number,
                    COALESCE(s.side, ''),
                    COALESCE(s.hall_type, ''),
                    s.table_number,
                    s.table_seat_number,
                    NOT EXISTS (
                        SELECT 1
                        FROM seat_assignments sa
                        WHERE sa.performance_id = %s
                        AND sa.seat_id = s.id
                        AND LOWER(
                            COALESCE(sa.status, 'reserviert')
                        ) <> 'storniert'
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM public_checkout_seat_holds checkout_hold
                        WHERE checkout_hold.performance_id = %s
                        AND checkout_hold.seat_id = s.id
                        AND checkout_hold.expires_at > CURRENT_TIMESTAMP
                        AND (%s = FALSE OR checkout_hold.order_id <> %s)
                    ) AS available
                FROM seats s
                WHERE s.is_active = TRUE
                AND {seat_filter}
                ORDER BY
                    COALESCE(s.table_number, s.row_number),
                    COALESCE(s.table_seat_number, s.seat_number),
                    s.id
                """,
                (
                    performance_id,
                    performance_id,
                    own_reservation_id is not None,
                    own_reservation_id or "",
                ),
            )
            seat_rows = cur.fetchall()

    seats = [
        {
            "id": row[0],
            "row_number": row[1],
            "seat_number": row[2],
            "side": row[3],
            "hall_type": row[4],
            "table_number": row[5],
            "table_seat_number": row[6],
            "available": bool(row[7]),
        }
        for row in seat_rows
    ]

    return {
        "performance_id": performance_id,
        "seating_mode": "assigned",
        "total_capacity": len(seats),
        "available_count": sum(1 for seat in seats if seat["available"]),
        "seats": seats,
    }


def validate_public_sale(performance):
    if performance["publication_status"] != "published":
        raise HTTPException(
            status_code=409,
            detail="Für diese Veranstaltung ist momentan kein Verkauf möglich.",
        )

    now = datetime.now(ZoneInfo("Europe/Berlin"))
    sales_start = performance["sales_start_at"]
    sales_end = performance["sales_end_at"]

    if sales_start:
        start_value = datetime.fromisoformat(sales_start)
        if start_value.tzinfo is None:
            start_value = start_value.replace(
                tzinfo=ZoneInfo("Europe/Berlin"),
            )
        if start_value > now:
            raise HTTPException(
                status_code=409,
                detail="Der Verkauf hat noch nicht begonnen.",
            )

    if sales_end:
        end_value = datetime.fromisoformat(sales_end)
        if end_value.tzinfo is None:
            end_value = end_value.replace(
                tzinfo=ZoneInfo("Europe/Berlin"),
            )
        if end_value <= now:
            raise HTTPException(
                status_code=409,
                detail="Der Verkauf ist bereits beendet.",
            )


def checkout_price_items(performance, quantity: int, delivery_method: str):
    breakdown = performance["price_breakdown"]
    configured_items = list(breakdown.get("items") or [])

    if not configured_items:
        ticket = breakdown.get("ticket") or {}
        if Decimal(str(ticket.get("gross", 0) or 0)) > 0:
            configured_items.append(
                {
                    "name": "Eintrittskarte",
                    "gross": ticket.get("gross", 0),
                    "vat_rate": ticket.get("vat_rate", 0),
                }
            )

        additional = breakdown.get("additional") or {}
        if Decimal(str(additional.get("gross", 0) or 0)) > 0:
            configured_items.append(
                {
                    "name": additional.get("name") or "Sonstige Kosten",
                    "gross": additional.get("gross", 0),
                    "vat_rate": additional.get("vat_rate", 0),
                }
            )

    configured_items.sort(
        key=lambda item: Decimal(str(item.get("gross", 0) or 0)),
        reverse=True,
    )

    result = []
    for item in configured_items:
        gross_each = Decimal(str(item.get("gross", 0) or 0))
        result.append(
            {
                "name": item.get("name") or "Preisposition",
                "quantity": quantity,
                "gross_each": float(gross_each),
                "gross_total": float(
                    (gross_each * quantity).quantize(
                        Decimal("0.01"),
                        rounding=ROUND_HALF_UP,
                    )
                ),
                "vat_rate": int(item.get("vat_rate", 0) or 0),
                "kind": "event",
            }
        )

    service = breakdown.get("service") or {}
    service_each = Decimal(str(service.get("gross", 0) or 0))
    if service_each > 0:
        result.append(
            {
                "name": "Servicepauschale",
                "quantity": quantity,
                "gross_each": float(service_each),
                "gross_total": float(
                    (service_each * quantity).quantize(
                        Decimal("0.01"),
                        rounding=ROUND_HALF_UP,
                    )
                ),
                "vat_rate": int(service.get("vat_rate", 19) or 19),
                "kind": "service",
            }
        )

    if delivery_method == "postal":
        shipping_gross = Decimal(
            str(performance["postal_shipping_gross"] or 0)
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        result.append(
            {
                "name": "Versandpauschale",
                "quantity": 1,
                "gross_each": float(shipping_gross),
                "gross_total": float(shipping_gross),
                "vat_rate": int(
                    performance["postal_shipping_vat_rate"] or 0
                ),
                "kind": "shipping",
            }
        )

    return result


def validate_public_checkout_customer(data: PublicCheckoutPreviewRequest):
    if not data.customer.first_name.strip():
        raise HTTPException(status_code=400, detail="Vorname fehlt.")
    if not data.customer.last_name.strip():
        raise HTTPException(status_code=400, detail="Nachname fehlt.")

    email = data.customer.email.strip()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(
            status_code=400,
            detail="Bitte eine gültige E-Mail-Adresse eingeben.",
        )

    if data.delivery_method not in {"email", "postal"}:
        raise HTTPException(
            status_code=400,
            detail="Ungültige Versandart.",
        )

    if data.delivery_method == "postal":
        if not data.customer.street.strip():
            raise HTTPException(
                status_code=400,
                detail="Für den Postversand fehlt die Straße.",
            )
        if not data.customer.postal_code.strip():
            raise HTTPException(
                status_code=400,
                detail="Für den Postversand fehlt die Postleitzahl.",
            )
        if not data.customer.city.strip():
            raise HTTPException(
                status_code=400,
                detail="Für den Postversand fehlt der Ort.",
            )

    if not data.accepted_terms or not data.accepted_privacy:
        raise HTTPException(
            status_code=400,
            detail="Bitte die Bedingungen und Datenschutzhinweise bestätigen.",
        )

    return email


def validate_public_checkout_inventory(
    cur,
    data,
    excluded_order_id: str | None = None,
):
    """Prüft Verkauf, Menge und Plätze innerhalb derselben DB-Transaktion."""
    expire_public_checkout_holds(cur)
    cur.execute(
        f"""
        SELECT {PERFORMANCE_SELECT_COLUMNS}
        FROM performances
        WHERE id = %s
        """,
        (data.performance_id,),
    )
    performance_row = cur.fetchone()

    if not performance_row:
        raise HTTPException(
            status_code=404,
            detail="Veranstaltung nicht gefunden.",
        )

    performance = performance_to_dict(performance_row)
    validate_public_sale(performance)

    max_tickets = int(performance["max_tickets_per_order"] or 10)
    if data.quantity < 1 or data.quantity > max_tickets:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Pro Bestellung sind höchstens "
                f"{max_tickets} Tickets möglich."
            ),
        )

    selected_ids = list(dict.fromkeys(data.seat_ids))

    if performance["seating_mode"] == "assigned":
        if len(selected_ids) != data.quantity:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Die Anzahl der ausgewählten Plätze "
                    "passt nicht zur Ticketanzahl."
                ),
            )

        seat_filter = public_seat_filter(performance["hall_plan_type"])
        cur.execute(
            f"""
            SELECT id
            FROM seats s
            WHERE s.id = ANY(%s)
            AND s.is_active = TRUE
            AND {seat_filter}
            """,
            (selected_ids,),
        )
        valid_seat_ids = {row[0] for row in cur.fetchall()}
        if len(valid_seat_ids) != len(selected_ids):
            raise HTTPException(
                status_code=400,
                detail="Mindestens ein ausgewählter Platz ist ungültig.",
            )

        cur.execute(
            """
            SELECT seat_id
            FROM seat_assignments
            WHERE performance_id = %s
            AND seat_id = ANY(%s)
            AND LOWER(COALESCE(status, 'reserviert')) <> 'storniert'
            UNION
            SELECT seat_id
            FROM public_checkout_seat_holds
            WHERE performance_id = %s
            AND seat_id = ANY(%s)
            AND expires_at > CURRENT_TIMESTAMP
            AND (%s = FALSE OR order_id <> %s)
            """,
            (
                data.performance_id,
                selected_ids,
                data.performance_id,
                selected_ids,
                excluded_order_id is not None,
                excluded_order_id or "",
            ),
        )
        if cur.fetchall():
            raise HTTPException(
                status_code=409,
                detail=(
                    "Mindestens ein Platz wurde inzwischen vergeben oder "
                    "wird gerade bezahlt. Bitte die Platzwahl aktualisieren."
                ),
            )
    else:
        if selected_ids:
            raise HTTPException(
                status_code=400,
                detail="Bei dieser Veranstaltung werden keine Plätze ausgewählt.",
            )

        capacity = performance["capacity"]
        if performance["seating_mode"] == "staff_assigned":
            capacity = public_hall_capacity(
                cur,
                performance["hall_plan_type"],
            )

        remaining = public_free_capacity(
            cur,
            data.performance_id,
            capacity,
            excluded_order_id,
        )
        if data.quantity > remaining:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Für diese Anzahl sind nicht mehr genügend "
                    "Tickets verfügbar."
                ),
            )

    return performance_row, performance, selected_ids


def require_active_public_checkout_reservation(
    cur,
    reservation_id: str,
    performance_id: int,
):
    if not re.fullmatch(r"[a-f0-9]{32}", reservation_id):
        raise HTTPException(status_code=400, detail="Ungültige Reservierung.")

    cur.execute(
        """
        SELECT id, expires_at
        FROM public_checkout_orders
        WHERE id = %s
        AND performance_id = %s
        AND status = 'pending'
        AND stripe_checkout_session_id IS NULL
        AND expires_at > CURRENT_TIMESTAMP
        FOR UPDATE
        """,
        (reservation_id, performance_id),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(
            status_code=409,
            detail=(
                "Die Reservierungszeit ist abgelaufen. "
                "Bitte wählen Sie die Tickets erneut aus."
            ),
        )
    return {"id": row[0], "expires_at": row[1]}


@app.post("/api/public/checkout/reservation")
def reserve_public_checkout(data: PublicCheckoutHoldRequest):
    """Reserviert die gewählte Ticketmenge für insgesamt 14 Minuten."""
    now_utc = datetime.now(timezone.utc)
    reservation_id = data.reservation_id.strip() or uuid4().hex

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pg_advisory_xact_lock(%s)",
                (900000000000 + int(data.performance_id),),
            )
            expire_public_checkout_holds(cur)

            expires_at = now_utc + timedelta(
                minutes=PUBLIC_CHECKOUT_RESERVATION_MINUTES,
            )
            if data.reservation_id.strip():
                existing = require_active_public_checkout_reservation(
                    cur,
                    reservation_id,
                    data.performance_id,
                )
                expires_at = existing["expires_at"]
                # Auswahl darf innerhalb derselben Frist geändert werden.
                # Bei einem Fehler rollt die Transaktion vollständig zurück.
                cur.execute(
                    "DELETE FROM public_checkout_orders WHERE id = %s",
                    (reservation_id,),
                )

            _, performance, selected_ids = validate_public_checkout_inventory(
                cur,
                data,
            )
            items = checkout_price_items(
                performance,
                data.quantity,
                "email",
            )
            total_gross = sum(
                (Decimal(str(item["gross_total"])) for item in items),
                Decimal("0"),
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

            cur.execute(
                """
                INSERT INTO public_checkout_orders (
                    id,
                    performance_id,
                    status,
                    quantity,
                    seat_ids,
                    delivery_method,
                    customer_first_name,
                    customer_last_name,
                    customer_email,
                    customer_phone,
                    customer_street,
                    customer_postal_code,
                    customer_city,
                    items,
                    total_gross,
                    currency,
                    expires_at
                )
                VALUES (
                    %s, %s, 'pending', %s, %s, 'email',
                    '', '', '', '', '', '', '', %s, %s, %s, %s
                )
                """,
                (
                    reservation_id,
                    data.performance_id,
                    data.quantity,
                    Jsonb(selected_ids),
                    Jsonb(items),
                    total_gross,
                    STRIPE_CURRENCY,
                    expires_at,
                ),
            )

            for seat_id in selected_ids:
                cur.execute(
                    """
                    INSERT INTO public_checkout_seat_holds (
                        order_id,
                        performance_id,
                        seat_id,
                        expires_at
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        reservation_id,
                        data.performance_id,
                        seat_id,
                        expires_at,
                    ),
                )

    remaining_seconds = max(
        0,
        int((expires_at - datetime.now(timezone.utc)).total_seconds()),
    )
    return {
        "reservation_id": reservation_id,
        "expires_at": expires_at.isoformat(),
        "remaining_seconds": remaining_seconds,
        "quantity": data.quantity,
        "seat_ids": selected_ids,
    }


def public_checkout_preview_payload(
    data: PublicCheckoutPreviewRequest,
    performance,
    selected_ids,
    email,
):
    items = checkout_price_items(
        performance,
        data.quantity,
        data.delivery_method,
    )
    total_gross = sum(
        (Decimal(str(item["gross_total"])) for item in items),
        Decimal("0"),
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    return {
        "valid": True,
        "test_mode": True,
        "performance_id": data.performance_id,
        "event_title": performance["title"],
        "quantity": data.quantity,
        "seat_ids": selected_ids,
        "delivery_method": data.delivery_method,
        "customer_email": email,
        "items": items,
        "currency": "EUR",
        "total_gross": float(total_gross),
        "message": (
            "Die Testbestellung wurde geprüft. "
            "Die Tickets bleiben bis zum Ablauf der Reservierungszeit reserviert."
        ),
    }


@app.post("/api/public/checkout/preview")
def preview_public_checkout(data: PublicCheckoutPreviewRequest):
    """Prüft einen Kauf vollständig, speichert aber noch keine Buchung."""
    email = validate_public_checkout_customer(data)
    reservation_id = data.reservation_id.strip()

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            expire_public_checkout_holds(cur)
            require_active_public_checkout_reservation(
                cur,
                reservation_id,
                data.performance_id,
            )
            _, performance, selected_ids = validate_public_checkout_inventory(
                cur,
                data,
                reservation_id,
            )

    return public_checkout_preview_payload(
        data,
        performance,
        selected_ids,
        email,
    )


def require_stripe_test_configuration():
    if not STRIPE_SECRET_KEY or not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(
            status_code=503,
            detail=(
                "Stripe ist noch nicht vollständig eingerichtet. "
                "Testschlüssel und Webhook-Schlüssel fehlen."
            ),
        )
    if not STRIPE_SECRET_KEY.startswith("sk_test_"):
        raise HTTPException(
            status_code=503,
            detail=(
                "Aus Sicherheitsgründen akzeptiert dieser Entwicklungsstand "
                "ausschließlich einen Stripe-Testschlüssel."
            ),
        )
    if not STRIPE_WEBHOOK_SECRET.startswith("whsec_"):
        raise HTTPException(
            status_code=503,
            detail="Der Stripe-Webhook-Schlüssel ist ungültig.",
        )


def stripe_amount_in_cents(value) -> int:
    return int(
        (Decimal(str(value)) * Decimal("100")).quantize(
            Decimal("1"),
            rounding=ROUND_HALF_UP,
        )
    )


def stripe_checkout_line_items(items):
    line_items = []
    for item in items:
        amount = stripe_amount_in_cents(item["gross_each"])
        if amount <= 0:
            continue
        line_items.append(
            {
                "price_data": {
                    "currency": STRIPE_CURRENCY,
                    "unit_amount": amount,
                    "product_data": {
                        "name": str(item["name"])[:127],
                        "description": (
                            f"Bruttopreis inklusive "
                            f"{int(item['vat_rate'])} % MwSt."
                        ),
                    },
                },
                "quantity": int(item["quantity"]),
            }
        )
    return line_items


@app.post("/api/public/checkout/session")
def create_public_checkout_session(data: PublicCheckoutPreviewRequest):
    """Öffnet Stripe für eine bereits laufende 14-Minuten-Reservierung."""
    require_stripe_test_configuration()
    email = validate_public_checkout_customer(data)
    order_id = data.reservation_id.strip()
    now_utc = datetime.now(timezone.utc)
    stripe_expires_at = now_utc + timedelta(minutes=STRIPE_CHECKOUT_MINUTES)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pg_advisory_xact_lock(%s)",
                (900000000000 + int(data.performance_id),),
            )
            expire_public_checkout_holds(cur)
            reservation = require_active_public_checkout_reservation(
                cur,
                order_id,
                data.performance_id,
            )
            _, performance, selected_ids = validate_public_checkout_inventory(
                cur,
                data,
                order_id,
            )
            preview = public_checkout_preview_payload(
                data,
                performance,
                selected_ids,
                email,
            )
            total_gross = Decimal(str(preview["total_gross"])).quantize(
                Decimal("0.01"),
                rounding=ROUND_HALF_UP,
            )
            if total_gross <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="Der Gesamtbetrag muss größer als 0,00 Euro sein.",
                )

            cur.execute(
                """
                UPDATE public_checkout_orders
                SET quantity = %s,
                    seat_ids = %s,
                    delivery_method = %s,
                    customer_first_name = %s,
                    customer_last_name = %s,
                    customer_email = %s,
                    customer_phone = %s,
                    customer_street = %s,
                    customer_postal_code = %s,
                    customer_city = %s,
                    items = %s,
                    total_gross = %s,
                    currency = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                AND status = 'pending'
                AND stripe_checkout_session_id IS NULL
                AND expires_at > CURRENT_TIMESTAMP
                """,
                (
                    data.quantity,
                    Jsonb(selected_ids),
                    data.delivery_method,
                    data.customer.first_name.strip(),
                    data.customer.last_name.strip(),
                    email,
                    data.customer.phone.strip(),
                    data.customer.street.strip(),
                    data.customer.postal_code.strip(),
                    data.customer.city.strip(),
                    Jsonb(preview["items"]),
                    total_gross,
                    STRIPE_CURRENCY,
                    order_id,
                ),
            )
            if cur.rowcount != 1:
                raise HTTPException(
                    status_code=409,
                    detail="Die Reservierungszeit ist abgelaufen.",
                )
            reservation_expires_at = reservation["expires_at"]

    public_slug = performance["public_slug"] or make_public_slug(
        performance["title"],
        performance["id"],
    )
    event_url = f"{TICKETSHOP_BASE_URL}/events/{public_slug}"
    metadata = {
        "checkout_order_id": order_id,
        "performance_id": str(data.performance_id),
    }

    try:
        checkout_session = stripe.checkout.Session.create(
            api_key=STRIPE_SECRET_KEY,
            mode="payment",
            payment_method_types=["card"],
            locale="de",
            customer_email=email,
            line_items=stripe_checkout_line_items(preview["items"]),
            success_url=(
                f"{event_url}?checkout=success"
                "&session_id={CHECKOUT_SESSION_ID}"
            ),
            cancel_url=(
                f"{event_url}?checkout=cancelled&order_id={order_id}"
            ),
            expires_at=int(stripe_expires_at.timestamp()),
            metadata=metadata,
            payment_intent_data={
                "metadata": metadata,
                "receipt_email": email,
            },
        )
    except Exception as exc:
        print(f"Stripe Checkout konnte nicht erstellt werden: {exc}")
        with psycopg.connect(DB_CONFIG) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public_checkout_orders
                    SET status = 'failed', updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s AND status = 'pending'
                    """,
                    (order_id,),
                )
                cur.execute(
                    "DELETE FROM public_checkout_seat_holds WHERE order_id = %s",
                    (order_id,),
                )
        raise HTTPException(
            status_code=502,
            detail=(
                "Stripe Checkout konnte nicht geöffnet werden. "
                "Bitte erneut versuchen."
            ),
        ) from exc

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public_checkout_orders
                SET stripe_checkout_session_id = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                AND status = 'pending'
                AND expires_at > CURRENT_TIMESTAMP
                RETURNING id
                """,
                (checkout_session.id, order_id),
            )
            if not cur.fetchone():
                try:
                    stripe.checkout.Session.expire(
                        checkout_session.id,
                        api_key=STRIPE_SECRET_KEY,
                    )
                except Exception as exc:
                    print(f"Zu spät erstellte Stripe-Session konnte nicht beendet werden: {exc}")
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Die Reservierungszeit ist abgelaufen. "
                        "Bitte wählen Sie die Tickets erneut aus."
                    ),
                )

    return {
        "test_mode": True,
        "checkout_url": checkout_session.url,
        "session_id": checkout_session.id,
        "order_id": order_id,
        "expires_at": reservation_expires_at.isoformat(),
    }


PUBLIC_CHECKOUT_ORDER_SELECT = """
    id,
    performance_id,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    booking_id,
    status,
    quantity,
    seat_ids,
    delivery_method,
    customer_first_name,
    customer_last_name,
    customer_email,
    customer_phone,
    customer_street,
    customer_postal_code,
    customer_city,
    items,
    total_gross,
    currency,
    expires_at
"""


def public_checkout_order_to_dict(row):
    return {
        "id": row[0],
        "performance_id": row[1],
        "stripe_checkout_session_id": row[2],
        "stripe_payment_intent_id": row[3],
        "booking_id": row[4],
        "status": row[5],
        "quantity": int(row[6]),
        "seat_ids": list(row[7] or []),
        "delivery_method": row[8],
        "customer_first_name": row[9],
        "customer_last_name": row[10],
        "customer_email": row[11],
        "customer_phone": row[12],
        "customer_street": row[13],
        "customer_postal_code": row[14],
        "customer_city": row[15],
        "items": list(row[16] or []),
        "total_gross": Decimal(str(row[17])),
        "currency": row[18],
        "expires_at": row[19],
    }


def load_public_checkout_order(cur, session_id: str, order_id: str = ""):
    if order_id:
        cur.execute(
            f"""
            SELECT {PUBLIC_CHECKOUT_ORDER_SELECT}
            FROM public_checkout_orders
            WHERE id = %s
            FOR UPDATE
            """,
            (order_id,),
        )
    else:
        cur.execute(
            f"""
            SELECT {PUBLIC_CHECKOUT_ORDER_SELECT}
            FROM public_checkout_orders
            WHERE stripe_checkout_session_id = %s
            FOR UPDATE
            """,
            (session_id,),
        )
    row = cur.fetchone()
    return public_checkout_order_to_dict(row) if row else None


def upsert_public_checkout_customer(cur, order):
    cur.execute(
        """
        SELECT id
        FROM customers
        WHERE LOWER(first_name) = LOWER(%s)
        AND LOWER(last_name) = LOWER(%s)
        AND LOWER(COALESCE(email, '')) = LOWER(%s)
        LIMIT 1
        """,
        (
            order["customer_first_name"],
            order["customer_last_name"],
            order["customer_email"],
        ),
    )
    row = cur.fetchone()
    if row:
        customer_id = row[0]
        cur.execute(
            """
            UPDATE customers
            SET phone = COALESCE(NULLIF(%s, ''), phone),
                street = COALESCE(NULLIF(%s, ''), street),
                postal_code = COALESCE(NULLIF(%s, ''), postal_code),
                city = COALESCE(NULLIF(%s, ''), city)
            WHERE id = %s
            """,
            (
                order["customer_phone"],
                order["customer_street"],
                order["customer_postal_code"],
                order["customer_city"],
                customer_id,
            ),
        )
        return customer_id

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
        VALUES (%s, %s, %s, %s, %s, %s, %s, '')
        RETURNING id
        """,
        (
            order["customer_first_name"],
            order["customer_last_name"],
            order["customer_email"],
            order["customer_phone"],
            order["customer_street"],
            order["customer_postal_code"],
            order["customer_city"],
        ),
    )
    return cur.fetchone()[0]


def stripe_payload_to_dict(payload):
    """Normalisiert Stripe-Ressourcen für aktuelle und ältere SDK-Versionen."""
    if isinstance(payload, dict):
        return payload
    to_dict = getattr(payload, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    return dict(payload)


def fulfill_public_checkout_session(session, request: Request):
    """Erzeugt eine bezahlte Buchung genau einmal pro Stripe-Session."""
    session = stripe_payload_to_dict(session)
    session_id = str(session.get("id") or "")
    metadata = session.get("metadata") or {}
    order_id = str(metadata.get("checkout_order_id") or "")

    if not session_id:
        raise HTTPException(status_code=400, detail="Stripe-Session fehlt.")
    if bool(session.get("livemode")):
        raise HTTPException(
            status_code=400,
            detail="Live-Zahlungen sind in diesem Entwicklungsstand gesperrt.",
        )
    if session.get("payment_status") not in {"paid", "no_payment_required"}:
        return {"status": "pending", "booking_number": None}

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            # Zuerst nur die Veranstaltungs-ID ermitteln, anschließend sperren.
            if order_id:
                cur.execute(
                    "SELECT performance_id FROM public_checkout_orders WHERE id = %s",
                    (order_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT performance_id
                    FROM public_checkout_orders
                    WHERE stripe_checkout_session_id = %s
                    """,
                    (session_id,),
                )
            performance_lookup = cur.fetchone()
            if not performance_lookup:
                raise HTTPException(
                    status_code=404,
                    detail="Die zugehörige Testbestellung wurde nicht gefunden.",
                )

            cur.execute(
                "SELECT pg_advisory_xact_lock(%s)",
                (900000000000 + int(performance_lookup[0]),),
            )
            order = load_public_checkout_order(cur, session_id, order_id)
            if not order:
                raise HTTPException(
                    status_code=404,
                    detail="Die zugehörige Testbestellung wurde nicht gefunden.",
                )

            if order["stripe_checkout_session_id"] not in {None, session_id}:
                raise HTTPException(
                    status_code=409,
                    detail="Stripe-Session und Testbestellung passen nicht zusammen.",
                )

            if order["status"] == "paid" and order["booking_id"]:
                cur.execute(
                    "SELECT booking_number FROM bookings WHERE id = %s",
                    (order["booking_id"],),
                )
                booking_row = cur.fetchone()
                return {
                    "status": "paid",
                    "booking_number": booking_row[0] if booking_row else None,
                }

            if order["status"] != "pending":
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Die Reservierung war bei Zahlungseingang nicht mehr aktiv. "
                        "Bitte den Vorgang manuell prüfen."
                    ),
                )

            expected_cents = stripe_amount_in_cents(order["total_gross"])
            if int(session.get("amount_total") or -1) != expected_cents:
                raise HTTPException(
                    status_code=409,
                    detail="Der von Stripe gemeldete Betrag stimmt nicht überein.",
                )
            if str(session.get("currency") or "").lower() != order["currency"]:
                raise HTTPException(
                    status_code=409,
                    detail="Die von Stripe gemeldete Währung stimmt nicht überein.",
                )

            cur.execute(
                f"""
                SELECT {PERFORMANCE_SELECT_COLUMNS}
                FROM performances
                WHERE id = %s
                """,
                (order["performance_id"],),
            )
            performance_row = cur.fetchone()
            if not performance_row:
                raise HTTPException(status_code=404, detail="Veranstaltung fehlt.")
            performance = performance_to_dict(performance_row)

            if performance["seating_mode"] == "assigned":
                cur.execute(
                    """
                    SELECT seat_id
                    FROM public_checkout_seat_holds
                    WHERE order_id = %s
                    AND expires_at > CURRENT_TIMESTAMP
                    """,
                    (order["id"],),
                )
                held_seats = {row[0] for row in cur.fetchall()}
                if held_seats != set(order["seat_ids"]):
                    raise HTTPException(
                        status_code=409,
                        detail="Die reservierten Plätze sind nicht mehr vollständig verfügbar.",
                    )
                cur.execute(
                    """
                    SELECT seat_id
                    FROM seat_assignments
                    WHERE performance_id = %s
                    AND seat_id = ANY(%s)
                    AND LOWER(COALESCE(status, 'reserviert')) <> 'storniert'
                    """,
                    (order["performance_id"], order["seat_ids"]),
                )
                if cur.fetchall():
                    raise HTTPException(
                        status_code=409,
                        detail="Mindestens ein bezahlter Platz ist bereits vergeben.",
                    )

            customer_id = upsert_public_checkout_customer(cur, order)
            event_total = sum(
                (
                    Decimal(str(item.get("gross_total", 0) or 0))
                    for item in order["items"]
                    if item.get("kind") == "event"
                ),
                Decimal("0"),
            )
            ticket_price = (
                event_total / Decimal(order["quantity"])
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            service_fee = sum(
                (
                    Decimal(str(item.get("gross_total", 0) or 0))
                    for item in order["items"]
                    if item.get("kind") == "service"
                ),
                Decimal("0"),
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            shipping_fee = sum(
                (
                    Decimal(str(item.get("gross_total", 0) or 0))
                    for item in order["items"]
                    if item.get("kind") == "shipping"
                ),
                Decimal("0"),
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

            cur.execute(
                "SELECT next_document_number('booking_web', %s)",
                (datetime.now(ZoneInfo("Europe/Berlin")).year,),
            )
            booking_number = f"WEB-{int(cur.fetchone()[0]):04d}"
            payment_intent_id = str(session.get("payment_intent") or "") or None

            cur.execute(
                """
                INSERT INTO bookings (
                    booking_number,
                    customer_id,
                    performance_id,
                    ticket_count,
                    ticket_price,
                    service_fee,
                    status,
                    free_seating,
                    delivery_method,
                    shipping_fee,
                    stripe_checkout_session_id,
                    stripe_payment_intent_id
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, 'bezahlt',
                    %s, %s, %s, %s, %s
                )
                RETURNING id
                """,
                (
                    booking_number,
                    customer_id,
                    order["performance_id"],
                    order["quantity"],
                    ticket_price,
                    service_fee,
                    performance["seating_mode"] == "free",
                    order["delivery_method"],
                    shipping_fee,
                    session_id,
                    payment_intent_id,
                ),
            )
            booking_id = cur.fetchone()[0]

            for seat_id in order["seat_ids"]:
                cur.execute(
                    """
                    INSERT INTO seat_assignments (
                        performance_id,
                        seat_id,
                        booking_id,
                        status
                    )
                    VALUES (%s, %s, %s, 'bezahlt')
                    """,
                    (order["performance_id"], seat_id, booking_id),
                )

            cur.execute(
                """
                UPDATE public_checkout_orders
                SET status = 'paid',
                    stripe_checkout_session_id = %s,
                    stripe_payment_intent_id = %s,
                    booking_id = %s,
                    paid_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (session_id, payment_intent_id, booking_id, order["id"]),
            )
            cur.execute(
                "DELETE FROM public_checkout_seat_holds WHERE order_id = %s",
                (order["id"],),
            )
            write_activity(
                cur,
                request,
                action="Stripe-Testzahlung bestätigt",
                entity_type="booking",
                entity_id=booking_id,
                customer_id=customer_id,
                performance_id=order["performance_id"],
                booking_id=booking_id,
                description=(
                    f"Buchung {booking_number} nach bestätigter "
                    f"Stripe-Testzahlung angelegt."
                ),
                new_value=(
                    f"status=bezahlt; delivery_method={order['delivery_method']}; "
                    f"stripe_checkout_session_id={session_id}"
                ),
            )

    return {"status": "paid", "booking_number": booking_number}


def mark_public_checkout_finished(session, status: str):
    session = stripe_payload_to_dict(session)
    session_id = str(session.get("id") or "")
    order_id = str((session.get("metadata") or {}).get("checkout_order_id") or "")
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            if order_id:
                cur.execute(
                    """
                    UPDATE public_checkout_orders
                    SET status = %s, updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s AND status = 'pending'
                    RETURNING id
                    """,
                    (status, order_id),
                )
            else:
                cur.execute(
                    """
                    UPDATE public_checkout_orders
                    SET status = %s, updated_at = CURRENT_TIMESTAMP
                    WHERE stripe_checkout_session_id = %s
                    AND status = 'pending'
                    RETURNING id
                    """,
                    (status, session_id),
                )
            updated = cur.fetchone()
            if updated:
                cur.execute(
                    "DELETE FROM public_checkout_seat_holds WHERE order_id = %s",
                    (updated[0],),
                )


@app.post("/api/public/stripe/webhook")
async def public_stripe_webhook(request: Request):
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook ist nicht eingerichtet.")

    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(
            payload,
            signature,
            STRIPE_WEBHOOK_SECRET,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="Ungültige Stripe-Webhook-Signatur.",
        ) from exc

    event = stripe_payload_to_dict(event)
    event_type = event.get("type")
    session = stripe_payload_to_dict(event["data"]["object"])
    if event_type in {
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
    }:
        fulfill_public_checkout_session(session, request)
    elif event_type == "checkout.session.expired":
        mark_public_checkout_finished(session, "expired")
    elif event_type == "checkout.session.async_payment_failed":
        mark_public_checkout_finished(session, "failed")

    return {"received": True}


def public_checkout_status_payload(cur, session_id: str):
    cur.execute(
        """
        SELECT
            checkout_order.status,
            checkout_order.total_gross,
            checkout_order.customer_email,
            checkout_order.delivery_method,
            booking.booking_number,
            performance.title
        FROM public_checkout_orders checkout_order
        JOIN performances performance
            ON performance.id = checkout_order.performance_id
        LEFT JOIN bookings booking
            ON booking.id = checkout_order.booking_id
        WHERE checkout_order.stripe_checkout_session_id = %s
        """,
        (session_id,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Testbestellung nicht gefunden.")
    return {
        "status": row[0],
        "paid": row[0] == "paid",
        "total_gross": float(row[1]),
        "customer_email": row[2],
        "delivery_method": row[3],
        "booking_number": row[4],
        "event_title": row[5],
        "test_mode": True,
    }


@app.get("/api/public/checkout/session/{session_id}")
def get_public_checkout_session_status(session_id: str, request: Request):
    require_stripe_test_configuration()
    if not session_id.startswith("cs_test_"):
        raise HTTPException(status_code=400, detail="Ungültige Test-Session.")

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            status_payload = public_checkout_status_payload(cur, session_id)

    if status_payload["status"] == "pending":
        try:
            session = stripe.checkout.Session.retrieve(
                session_id,
                api_key=STRIPE_SECRET_KEY,
            )
        except Exception as exc:
            print(f"Stripe-Status konnte nicht geladen werden: {exc}")
            raise HTTPException(
                status_code=502,
                detail="Der Zahlungsstatus konnte noch nicht geladen werden.",
            ) from exc

        if session.payment_status in {"paid", "no_payment_required"}:
            fulfill_public_checkout_session(session, request)
        elif session.status == "expired":
            mark_public_checkout_finished(session, "expired")

        with psycopg.connect(DB_CONFIG) as conn:
            with conn.cursor() as cur:
                status_payload = public_checkout_status_payload(cur, session_id)

    return status_payload


@app.post("/api/public/checkout/orders/{order_id}/cancel")
def cancel_public_checkout_order(order_id: str):
    require_stripe_test_configuration()
    if not re.fullmatch(r"[a-f0-9]{32}", order_id):
        raise HTTPException(status_code=400, detail="Ungültige Testbestellung.")

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT stripe_checkout_session_id, status
                FROM public_checkout_orders
                WHERE id = %s
                """,
                (order_id,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Testbestellung nicht gefunden.")
    session_id, status = row
    if status == "paid":
        raise HTTPException(status_code=409, detail="Die Bestellung ist bereits bezahlt.")

    if session_id and status == "pending":
        try:
            session = stripe.checkout.Session.retrieve(
                session_id,
                api_key=STRIPE_SECRET_KEY,
            )
            if session.payment_status in {"paid", "no_payment_required"}:
                raise HTTPException(
                    status_code=409,
                    detail="Die Zahlung wurde bereits bestätigt.",
                )
            if session.status == "open":
                stripe.checkout.Session.expire(
                    session_id,
                    api_key=STRIPE_SECRET_KEY,
                )
        except HTTPException:
            raise
        except Exception as exc:
            print(f"Stripe-Session konnte nicht abgebrochen werden: {exc}")
            raise HTTPException(
                status_code=502,
                detail="Die Zahlungsseite konnte noch nicht abgebrochen werden.",
            ) from exc

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public_checkout_orders
                SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                WHERE id = %s AND status = 'pending'
                """,
                (order_id,),
            )
            cur.execute(
                "DELETE FROM public_checkout_seat_holds WHERE order_id = %s",
                (order_id,),
            )
    return {"cancelled": True, "test_mode": True}


@app.post("/api/performances")
def create_performance(
    data: PerformanceCreate,
    request: Request,
):
    validate_performance_data(data)
    serialized_price_items = [
        item.model_dump() for item in data.price_items
    ]

    if serialized_price_items:
        price_breakdown = calculate_structured_price_breakdown(
            serialized_price_items,
            data.service_vat_rate,
        )
    else:
        price_breakdown = calculate_price_breakdown(
            data.ticket_price_net,
            data.ticket_vat_rate,
            data.service_fee_net,
            data.service_vat_rate,
            data.additional_fee_name,
            data.additional_fee_net,
            data.additional_fee_vat_rate,
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO performances (
                    title,
                    performance_date,
                    start_time,
                    hall_plan_type,
                    short_description,
                    description,
                    image_url,
                    venue_name,
                    doors_time,
                    sales_start_at,
                    sales_end_at,
                    publication_status,
                    seating_mode,
                    capacity,
                    price_from,
                    max_tickets_per_order,
                    ticket_price_net,
                    ticket_vat_rate,
                    service_fee_net,
                    service_vat_rate,
                    additional_fee_name,
                    additional_fee_net,
                    additional_fee_vat_rate,
                    price_items,
                    service_fee_percent,
                    postal_shipping_gross,
                    postal_shipping_vat_rate
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s
                )
                RETURNING id
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
                    data.short_description.strip(),
                    data.description.strip(),
                    data.image_url.strip(),
                    data.venue_name.strip(),
                    data.doors_time,
                    data.sales_start_at,
                    data.sales_end_at,
                    data.publication_status,
                    data.seating_mode,
                    data.capacity,
                    price_breakdown["total_gross"],
                    data.max_tickets_per_order,
                    round(data.ticket_price_net, 2),
                    data.ticket_vat_rate,
                    round(data.service_fee_net, 2),
                    data.service_vat_rate,
                    data.additional_fee_name.strip(),
                    round(data.additional_fee_net, 2),
                    data.additional_fee_vat_rate,
                    Jsonb(serialized_price_items),
                    float(SERVICE_FEE_PERCENT),
                    round(data.postal_shipping_gross, 2),
                    data.postal_shipping_vat_rate,
                ),
            )

            performance_id = cur.fetchone()[0]
            public_slug = make_public_slug(data.title, performance_id)

            cur.execute(
                f"""
                UPDATE performances
                SET public_slug = %s
                WHERE id = %s
                RETURNING {PERFORMANCE_SELECT_COLUMNS}
                """,
                (public_slug, performance_id),
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

    return {"success": True, "performance": performance_to_dict(row)}



@app.put("/api/performances/{performance_id}")
def update_performance(
    performance_id: int,
    data: PerformanceCreate,
    request: Request,
):
    validate_performance_data(data)
    serialized_price_items = [
        item.model_dump() for item in data.price_items
    ]

    if serialized_price_items:
        price_breakdown = calculate_structured_price_breakdown(
            serialized_price_items,
            data.service_vat_rate,
        )
    else:
        price_breakdown = calculate_price_breakdown(
            data.ticket_price_net,
            data.ticket_vat_rate,
            data.service_fee_net,
            data.service_vat_rate,
            data.additional_fee_name,
            data.additional_fee_net,
            data.additional_fee_vat_rate,
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {PERFORMANCE_SELECT_COLUMNS}
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

            public_slug = performance[18] or make_public_slug(
                data.title,
                performance_id,
            )

            cur.execute(
                f"""
                UPDATE performances
                SET
                    title = %s,
                    performance_date = %s,
                    start_time = %s,
                    hall_plan_type = %s,
                    short_description = %s,
                    description = %s,
                    image_url = %s,
                    venue_name = %s,
                    doors_time = %s,
                    sales_start_at = %s,
                    sales_end_at = %s,
                    publication_status = %s,
                    seating_mode = %s,
                    capacity = %s,
                    price_from = %s,
                    max_tickets_per_order = %s,
                    ticket_price_net = %s,
                    ticket_vat_rate = %s,
                    service_fee_net = %s,
                    service_vat_rate = %s,
                    additional_fee_name = %s,
                    additional_fee_net = %s,
                    additional_fee_vat_rate = %s,
                    price_items = %s,
                    service_fee_percent = %s,
                    postal_shipping_gross = %s,
                    postal_shipping_vat_rate = %s,
                    public_slug = %s
                WHERE id = %s
                RETURNING {PERFORMANCE_SELECT_COLUMNS}
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
                    data.short_description.strip(),
                    data.description.strip(),
                    data.image_url.strip(),
                    data.venue_name.strip(),
                    data.doors_time,
                    data.sales_start_at,
                    data.sales_end_at,
                    data.publication_status,
                    data.seating_mode,
                    data.capacity,
                    price_breakdown["total_gross"],
                    data.max_tickets_per_order,
                    round(data.ticket_price_net, 2),
                    data.ticket_vat_rate,
                    round(data.service_fee_net, 2),
                    data.service_vat_rate,
                    data.additional_fee_name.strip(),
                    round(data.additional_fee_net, 2),
                    data.additional_fee_vat_rate,
                    Jsonb(serialized_price_items),
                    float(SERVICE_FEE_PERCENT),
                    round(data.postal_shipping_gross, 2),
                    data.postal_shipping_vat_rate,
                    public_slug,
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

    return performance_to_dict(row)


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
                "Die Servicepauschale darf "
                "nicht negativ sein."
            ),
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            cur.execute(
                f"""
                SELECT {PERFORMANCE_SELECT_COLUMNS}
                FROM performances
                WHERE id = %s
                """,
                (data.performance_id,),
            )

            performance = cur.fetchone()

            if not performance:
                raise HTTPException(
                    status_code=404,
                    detail="Vorstellung nicht gefunden.",
                )

            frozen_ticket_price, frozen_service_fee = (
                calculate_booking_price_snapshot(
                    performance,
                    data.ticket_count,
                )
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
                    frozen_ticket_price,
                    frozen_service_fee,
                ),
            )

            booking_id = (
                cur.fetchone()[0]
            )

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
                    f"{performance[1]} · "
                    f"{performance[2].strftime('%d.%m.%Y')} "
                    f"{performance[3].strftime('%H:%M')}"
                ),
                new_value=(
                    f"booking_number={booking_number}; "
                    f"ticket_count={data.ticket_count}; "
                    f"ticket_price={frozen_ticket_price}; "
                    f"service_fee={frozen_service_fee}; "
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
        "ticket_price": frozen_ticket_price,
        "service_fee": frozen_service_fee,
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
            detail="Die Servicepauschale darf nicht negativ sein.",
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    b.customer_id,
                    b.performance_id,
                    b.booking_number,
                    b.ticket_price,
                    b.service_fee,
                    b.ticket_count
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
            old_ticket_price = float(existing[3] or 0)
            old_service_fee = float(existing[4] or 0)
            old_ticket_count = int(existing[5] or 0)

            # Neue Vorstellung muss existieren.
            cur.execute(
                f"""
                SELECT {PERFORMANCE_SELECT_COLUMNS}
                FROM performances
                WHERE id = %s
                """,
                (data.performance_id,),
            )

            selected_performance = cur.fetchone()

            if not selected_performance:
                raise HTTPException(
                    status_code=404,
                    detail="Die ausgewählte Vorstellung wurde nicht gefunden.",
                )

            if data.performance_id != old_performance_id:
                frozen_ticket_price, frozen_service_fee = (
                    calculate_booking_price_snapshot(
                        selected_performance,
                        data.ticket_count,
                    )
                )
            else:
                frozen_ticket_price = old_ticket_price
                if data.ticket_count == old_ticket_count:
                    frozen_service_fee = old_service_fee
                else:
                    frozen_service_fee = float((
                        Decimal(str(frozen_ticket_price))
                        * Decimal(data.ticket_count)
                        * SERVICE_FEE_PERCENT
                        / Decimal("100")
                    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

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
                    frozen_ticket_price,
                    frozen_service_fee,
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
                    f"ticket_price={frozen_ticket_price}; "
                    f"service_fee={frozen_service_fee}"
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
        "ticket_price": frozen_ticket_price,
        "service_fee": frozen_service_fee,
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


@app.get("/api/legacy/invoice-templates")
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


@app.get("/api/legacy/invoices")
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


@app.post("/api/legacy/invoices")
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


# ============================================================
# RECHNUNGSVORLAGEN / FINALISIERTE RECHNUNGEN – VERSION 2
# ============================================================

class InvoiceTemplateUpsert(BaseModel):
    name: str
    description: str = ""
    performance_id: int | None = None
    number_prefix: str = "RE"
    number_suffix: str = ""
    number_sequence_start: int = 1
    default_tax_rate: float = 7
    template_data: dict = Field(default_factory=dict)


class InvoiceLineCreate(BaseModel):
    description: str
    quantity: float
    unit_gross: float
    tax_rate: float


class InvoiceCreateV2(BaseModel):
    booking_id: int
    template_id: int
    invoice_date: date | None = None
    due_date: date | None = None
    notes: str = ""
    processor: str = ""
    payment_status: str = "offen"
    items: list[InvoiceLineCreate] = Field(default_factory=list)


class InvoiceTemplateDeleteRequest(BaseModel):
    confirmation: str


def normalize_invoice_number_part(value: str, fallback: str = ""):
    normalized = re.sub(r"[^A-Za-z0-9]", "", (value or "").upper())
    return (normalized or fallback)[:16]


def make_template_key(name: str, prefix: str):
    base = normalize_invoice_number_part(prefix)
    if not base:
        base = normalize_invoice_number_part(name, "VORLAGE")
    return base[:12]


def validate_template_payload(data: InvoiceTemplateUpsert):
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="Vorlagenname ist erforderlich.")
    if data.number_sequence_start < 1:
        raise HTTPException(status_code=400, detail="Die Startnummer muss mindestens 1 sein.")
    if data.default_tax_rate < 0 or data.default_tax_rate > 100:
        raise HTTPException(status_code=400, detail="Der Steuersatz muss zwischen 0 % und 100 % liegen.")

    items = data.template_data.get("items", [])
    if not isinstance(items, list) or len(items) > 20:
        raise HTTPException(status_code=400, detail="Eine Vorlage darf höchstens 20 Rechnungszeilen enthalten.")
    for item in items:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Ungültige Rechnungszeile in der Vorlage.")
        tax_rate = float(item.get("tax_rate", data.default_tax_rate) or 0)
        if tax_rate < 0 or tax_rate > 100:
            raise HTTPException(status_code=400, detail="Ein Steuersatz liegt außerhalb von 0 % bis 100 %.")


def normalize_invoice_template_data(template_data: dict):
    normalized = dict(template_data) if isinstance(template_data, dict) else {}
    normalized_items = []
    for stored_item in normalized.get("items", []):
        if not isinstance(stored_item, dict):
            continue
        item = dict(stored_item)
        if item.get("source") == "service_percent":
            item["percentage"] = 10
            item["tax_rate"] = 19
        elif (
            item.get("source") == "tickets"
            and str(item.get("description", "")).strip()
            == "{{event_title}} am {{event_date}}"
        ):
            item["description"] = "Eintrittskarte"
            item["append_event_details"] = True
        normalized_items.append(item)
    normalized["items"] = [
        item for item in normalized_items if item.get("source") != "service_percent"
    ] + [
        item for item in normalized_items if item.get("source") == "service_percent"
    ]
    return normalized


def format_invoice_processor(display_name: str):
    parts = [part for part in re.split(r"\s+", (display_name or "").strip()) if part]
    if len(parts) >= 2:
        return f"{parts[0][0].upper()}.{parts[-1]}"[:80]
    if parts:
        return parts[0][:80]
    return "—"


def resolve_invoice_processor(cur, request: Request, requested_processor: str):
    actor_id, _ = get_actor(request)
    if not actor_id:
        raise HTTPException(status_code=401, detail="Anmeldung erforderlich.")

    cur.execute(
        """
        SELECT username, display_name, role, is_active
        FROM app_users
        WHERE id = %s
        LIMIT 1
        """,
        (actor_id,),
    )
    user = cur.fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Benutzer nicht gefunden.")
    username, display_name, role, is_active = user
    if not is_active:
        raise HTTPException(status_code=403, detail="Benutzer ist deaktiviert.")

    requested = (requested_processor or "").strip()
    if role == "admin" and requested:
        return requested[:80]
    return format_invoice_processor(display_name or username)


def template_row_to_dict(row):
    template_data = normalize_invoice_template_data(
        row[8] if isinstance(row[8], dict) else {}
    )
    return {
        "id": int(row[0]),
        "template_key": row[1],
        "name": row[2],
        "description": row[3] or "",
        "performance_id": int(row[4]) if row[4] is not None else None,
        "number_prefix": row[5] or "RE",
        "number_suffix": row[6] or "",
        "number_sequence_start": int(row[7] or 1),
        "template_data": template_data,
        "default_tax_rate": float(row[9] or 0),
        "is_active": bool(row[10]),
        "created_at": row[11].isoformat() if row[11] else None,
        "updated_at": row[12].isoformat() if row[12] else None,
    }


INVOICE_TEMPLATE_SELECT = """
    SELECT
        id,
        template_key,
        name,
        description,
        performance_id,
        number_prefix,
        number_suffix,
        number_sequence_start,
        template_data,
        default_tax_rate,
        is_active,
        created_at,
        updated_at
    FROM invoice_templates
"""


@app.get("/api/invoice-templates")
def get_invoice_templates_v2(
    performance_id: int | None = None,
    include_inactive: bool = False,
):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            conditions = []
            params = []
            if not include_inactive:
                conditions.append("is_active = TRUE")
            if performance_id is not None:
                conditions.append("(performance_id = %s OR performance_id IS NULL)")
                params.append(performance_id)

            sql = INVOICE_TEMPLATE_SELECT
            if conditions:
                sql += " WHERE " + " AND ".join(conditions)
            if performance_id is not None:
                sql += " ORDER BY CASE WHEN performance_id = %s THEN 0 ELSE 1 END, name, id"
                params.append(performance_id)
            else:
                sql += " ORDER BY is_active DESC, name, id"

            cur.execute(sql, params)
            rows = cur.fetchall()

    return [template_row_to_dict(row) for row in rows]


@app.post("/api/invoice-templates")
def create_invoice_template(data: InvoiceTemplateUpsert, request: Request):
    validate_template_payload(data)
    require_admin(request)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            base_key = make_template_key(data.name, data.number_prefix)
            template_key = base_key
            suffix_number = 2
            while True:
                cur.execute(
                    "SELECT 1 FROM invoice_templates WHERE template_key = %s LIMIT 1",
                    (template_key,),
                )
                if not cur.fetchone():
                    break
                template_key = f"{base_key[:9]}{suffix_number}"
                suffix_number += 1

            cur.execute(
                """
                INSERT INTO invoice_templates (
                    template_key,
                    name,
                    description,
                    performance_id,
                    number_prefix,
                    number_suffix,
                    number_sequence_start,
                    default_tax_rate,
                    template_data,
                    is_active,
                    created_at,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, NOW(), NOW())
                RETURNING id
                """,
                (
                    template_key,
                    data.name.strip(),
                    data.description.strip(),
                    data.performance_id,
                    normalize_invoice_number_part(data.number_prefix, "RE"),
                    normalize_invoice_number_part(data.number_suffix),
                    data.number_sequence_start,
                    data.default_tax_rate,
                    Jsonb(normalize_invoice_template_data(data.template_data)),
                ),
            )
            template_id = int(cur.fetchone()[0])
            conn.commit()

    return {"success": True, "id": template_id, "template_key": template_key}


@app.put("/api/invoice-templates/{template_id}")
def update_invoice_template(
    template_id: int,
    data: InvoiceTemplateUpsert,
    request: Request,
):
    validate_template_payload(data)
    require_admin(request)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE invoice_templates
                SET
                    name = %s,
                    description = %s,
                    performance_id = %s,
                    number_prefix = %s,
                    number_suffix = %s,
                    number_sequence_start = %s,
                    default_tax_rate = %s,
                    template_data = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING id
                """,
                (
                    data.name.strip(),
                    data.description.strip(),
                    data.performance_id,
                    normalize_invoice_number_part(data.number_prefix, "RE"),
                    normalize_invoice_number_part(data.number_suffix),
                    data.number_sequence_start,
                    data.default_tax_rate,
                    Jsonb(normalize_invoice_template_data(data.template_data)),
                    template_id,
                ),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Rechnungsvorlage nicht gefunden.")
            conn.commit()

    return {"success": True, "id": template_id}


@app.post("/api/invoice-templates/{template_id}/duplicate")
def duplicate_invoice_template(template_id: int, request: Request):
    require_admin(request)

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(INVOICE_TEMPLATE_SELECT + " WHERE id = %s LIMIT 1", (template_id,))
            source = cur.fetchone()
            if not source:
                raise HTTPException(status_code=404, detail="Rechnungsvorlage nicht gefunden.")

            base_key = f"{source[1][:8]}COPY"
            copy_key = base_key
            copy_number = 2
            while True:
                cur.execute(
                    "SELECT 1 FROM invoice_templates WHERE template_key = %s LIMIT 1",
                    (copy_key,),
                )
                if not cur.fetchone():
                    break
                copy_key = f"{base_key[:9]}{copy_number}"
                copy_number += 1

            cur.execute(
                """
                INSERT INTO invoice_templates (
                    template_key,
                    name,
                    description,
                    performance_id,
                    number_prefix,
                    number_suffix,
                    number_sequence_start,
                    default_tax_rate,
                    template_data,
                    is_active,
                    created_at,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, NOW(), NOW())
                RETURNING id
                """,
                (
                    copy_key,
                    f"{source[2]} – Kopie",
                    source[3] or "",
                    source[4],
                    source[5],
                    source[6],
                    source[7],
                    source[9],
                    Jsonb(source[8] if isinstance(source[8], dict) else {}),
                ),
            )
            new_id = int(cur.fetchone()[0])
            conn.commit()

    return {"success": True, "id": new_id, "template_key": copy_key}


@app.post("/api/invoice-templates/{template_id}/toggle-active")
def toggle_invoice_template(template_id: int, request: Request):
    require_admin(request)
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE invoice_templates
                SET is_active = NOT is_active, updated_at = NOW()
                WHERE id = %s
                RETURNING is_active
                """,
                (template_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Rechnungsvorlage nicht gefunden.")
            conn.commit()
    return {"success": True, "is_active": bool(row[0])}


@app.post("/api/invoice-templates/{template_id}/delete")
def delete_invoice_template(
    template_id: int,
    data: InvoiceTemplateDeleteRequest,
    request: Request,
):
    require_admin(request)
    if data.confirmation != "ENDGÜLTIG LÖSCHEN":
        raise HTTPException(
            status_code=400,
            detail='Zur Bestätigung muss exakt „ENDGÜLTIG LÖSCHEN“ eingegeben werden.',
        )

    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM invoice_templates WHERE id = %s RETURNING name",
                (template_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Rechnungsvorlage nicht gefunden.")
            write_activity(
                cur,
                request,
                action="Rechnungsvorlage endgültig gelöscht",
                entity_type="invoice_template",
                entity_id=template_id,
                description=f"Rechnungsvorlage endgültig gelöscht: {row[0]}",
            )
            conn.commit()

    return {"success": True, "id": template_id, "name": row[0]}


def render_invoice_description(template: str, booking):
    performance_date = booking[15]
    date_text = (
        f"{performance_date.day}.{performance_date.month}.{performance_date.year}"
        if performance_date
        else ""
    )
    replacements = {
        "{{event_title}}": booking[14] or "Veranstaltung",
        "{{event_date}}": date_text,
        "{{booking_number}}": booking[1] or "",
        "{{customer_name}}": f"{booking[7]} {booking[8]}".strip(),
    }
    result = template or "Rechnungsposition"
    for token, value in replacements.items():
        result = result.replace(token, value)
    return result.strip()[:500]


def derive_invoice_lines(template_data: dict, booking, default_tax_rate: float):
    result = []
    ticket_template_item = next(
        (
            item
            for item in template_data.get("items", [])
            if isinstance(item, dict) and item.get("source") == "tickets"
        ),
        {},
    )
    if "unit_gross" in ticket_template_item and ticket_template_item.get("unit_gross") is not None:
        ticket_unit_gross = float(ticket_template_item.get("unit_gross") or 0)
    else:
        ticket_unit_gross = float(booking[5] or 0)
    ticket_gross_for_service = float(booking[4] or 0) * ticket_unit_gross

    for item in template_data.get("items", []):
        if not isinstance(item, dict):
            continue
        source = item.get("source", "fixed")
        quantity = 1.0
        unit_gross = float(item.get("unit_gross", 0) or 0)
        if source == "tickets":
            quantity = float(booking[4] or 0)
            if "unit_gross" in item and item.get("unit_gross") is not None:
                unit_gross = float(item.get("unit_gross") or 0)
            else:
                unit_gross = float(booking[5] or 0)
        elif source == "service_percent":
            quantity = 1.0
            unit_gross = round(ticket_gross_for_service * 10 / 100, 2)
            if unit_gross <= 0:
                continue
        elif source == "service":
            quantity = 1.0
            unit_gross = float(booking[6] or 0)
            if unit_gross <= 0:
                continue
        else:
            quantity = float(item.get("quantity", 1) or 1)

        description = render_invoice_description(item.get("description", ""), booking)
        contains_legacy_event_tokens = (
            "{{event_title}}" in str(item.get("description", ""))
            or "{{event_date}}" in str(item.get("description", ""))
        )
        if (
            source == "tickets"
            and item.get("append_event_details")
            and not contains_legacy_event_tokens
        ):
            event_title = booking[14] or "Veranstaltung"
            performance_date = booking[15]
            event_date = (
                f"{performance_date.day}.{performance_date.month}.{performance_date.year}"
                if performance_date
                else "—"
            )
            description = f"{description or 'Eintrittskarte'} – {event_title} am {event_date}"

        result.append(
            (
                source,
                InvoiceLineCreate(
                    description=description[:500],
                    quantity=quantity,
                    unit_gross=unit_gross,
                    tax_rate=(
                        19.0
                        if source == "service_percent"
                        else float(item.get("tax_rate", default_tax_rate) or 0)
                    ),
                ),
            )
        )
    result.sort(
        key=lambda entry: (
            entry[0] == "service_percent",
            -(float(entry[1].quantity) * float(entry[1].unit_gross)),
        )
    )
    return [line for _, line in result]


def calculate_invoice_line(item: InvoiceLineCreate):
    if not item.description.strip():
        raise HTTPException(status_code=400, detail="Jede Rechnungszeile benötigt eine Beschreibung.")
    if item.quantity <= 0 or item.unit_gross < 0:
        raise HTTPException(status_code=400, detail="Menge und Preis einer Rechnungszeile sind ungültig.")
    if item.tax_rate < 0 or item.tax_rate > 100:
        raise HTTPException(status_code=400, detail="Ein Steuersatz liegt außerhalb von 0 % bis 100 %.")

    quantity = Decimal(str(item.quantity))
    unit_gross = Decimal(str(item.unit_gross)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    gross = (quantity * unit_gross).quantize(Decimal("0.01"), ROUND_HALF_UP)
    divisor = Decimal("1") + Decimal(str(item.tax_rate)) / Decimal("100")
    net = (gross / divisor).quantize(Decimal("0.01"), ROUND_HALF_UP)
    tax = gross - net
    return {
        "description": item.description.strip()[:500],
        "quantity": quantity,
        "unit_gross": unit_gross,
        "tax_rate": Decimal(str(item.tax_rate)).quantize(Decimal("0.01")),
        "net": net,
        "tax": tax,
        "gross": gross,
    }


def build_invoice_number(prefix, performance_date, sequence_number, suffix, width):
    year_part = f"{performance_date.year % 100:02d}"
    sequence_part = str(sequence_number).zfill(max(1, min(int(width or 3), 8)))
    parts = [
        normalize_invoice_number_part(prefix, "RE"),
        year_part,
        sequence_part,
    ]
    normalized_suffix = normalize_invoice_number_part(suffix)
    if normalized_suffix:
        parts.append(normalized_suffix)
    return "-".join(parts)


@app.get("/api/invoices")
def get_invoices_v2(booking_id: int | None = None):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            params = []
            condition = ""
            if booking_id is not None:
                condition = "WHERE i.booking_id = %s"
                params.append(booking_id)
            cur.execute(
                f"""
                SELECT
                    i.id,
                    i.invoice_number,
                    i.booking_id,
                    b.booking_number,
                    i.invoice_date,
                    i.due_date,
                    i.status,
                    i.payment_status,
                    i.net_amount,
                    i.tax_amount,
                    i.gross_amount,
                    i.reference_number,
                    i.tax_breakdown,
                    i.recipient_snapshot,
                    i.template_snapshot,
                    i.notes,
                    i.finalized_at
                FROM invoices i
                JOIN bookings b ON b.id = i.booking_id
                {condition}
                ORDER BY i.id DESC
                LIMIT 200
                """,
                params,
            )
            rows = cur.fetchall()

            invoices = []
            for row in rows:
                cur.execute(
                    """
                    SELECT
                        position_no,
                        description,
                        quantity,
                        unit_price,
                        tax_rate,
                        net_amount,
                        tax_amount,
                        gross_amount
                    FROM invoice_items
                    WHERE invoice_id = %s
                    ORDER BY position_no
                    """,
                    (row[0],),
                )
                items = [
                    {
                        "position_no": item[0],
                        "description": item[1],
                        "quantity": float(item[2]),
                        "unit_gross": float(item[3]),
                        "tax_rate": float(item[4]),
                        "net_amount": float(item[5]),
                        "tax_amount": float(item[6]),
                        "gross_amount": float(item[7]),
                    }
                    for item in cur.fetchall()
                ]
                invoices.append(
                    {
                        "id": int(row[0]),
                        "invoice_number": row[1],
                        "booking_id": int(row[2]),
                        "booking_number": row[3],
                        "invoice_date": row[4].isoformat() if row[4] else None,
                        "due_date": row[5].isoformat() if row[5] else None,
                        "status": row[6],
                        "payment_status": row[7],
                        "net_amount": float(row[8]),
                        "tax_amount": float(row[9]),
                        "gross_amount": float(row[10]),
                        "reference_number": row[11],
                        "tax_breakdown": row[12] if isinstance(row[12], list) else [],
                        "recipient_snapshot": row[13] if isinstance(row[13], dict) else {},
                        "template_snapshot": row[14] if isinstance(row[14], dict) else {},
                        "notes": row[15] or "",
                        "finalized_at": row[16].isoformat() if row[16] else None,
                        "items": items,
                    }
                )

    return invoices


@app.post("/api/invoices")
def create_invoice_v2(data: InvoiceCreateV2, request: Request):
    with psycopg.connect(DB_CONFIG) as conn:
        with conn.cursor() as cur:
            processor = resolve_invoice_processor(cur, request, data.processor)
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
                    c.phone,
                    c.street,
                    c.postal_code,
                    c.city,
                    p.title,
                    p.performance_date,
                    p.start_time
                FROM bookings b
                JOIN customers c ON c.id = b.customer_id
                JOIN performances p ON p.id = b.performance_id
                WHERE b.id = %s
                LIMIT 1
                FOR UPDATE OF b
                """,
                (data.booking_id,),
            )
            booking = cur.fetchone()
            if not booking:
                raise HTTPException(status_code=404, detail="Buchung nicht gefunden.")

            cur.execute(
                """
                SELECT invoice_number
                FROM invoices
                WHERE booking_id = %s
                  AND status NOT IN ('storniert', 'storno')
                ORDER BY id DESC
                LIMIT 1
                """,
                (data.booking_id,),
            )
            existing = cur.fetchone()
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail=f"Für diese Buchung existiert bereits die Rechnung {existing[0]}.",
                )

            cur.execute(INVOICE_TEMPLATE_SELECT + " WHERE id = %s AND is_active = TRUE LIMIT 1", (data.template_id,))
            template_row = cur.fetchone()
            if not template_row:
                raise HTTPException(status_code=404, detail="Aktive Rechnungsvorlage nicht gefunden.")
            template = template_row_to_dict(template_row)

            requested_items = data.items or derive_invoice_lines(
                template["template_data"],
                booking,
                template["default_tax_rate"],
            )
            if not requested_items:
                raise HTTPException(status_code=400, detail="Die Rechnung enthält keine Positionen.")
            if len(requested_items) > 20:
                raise HTTPException(status_code=400, detail="Eine Rechnung darf höchstens 20 Positionen enthalten.")

            calculated_items = [calculate_invoice_line(item) for item in requested_items]
            total_net = sum((item["net"] for item in calculated_items), Decimal("0"))
            total_tax = sum((item["tax"] for item in calculated_items), Decimal("0"))
            total_gross = sum((item["gross"] for item in calculated_items), Decimal("0"))

            tax_groups = {}
            for item in calculated_items:
                key = str(item["tax_rate"])
                group = tax_groups.setdefault(
                    key,
                    {"tax_rate": float(item["tax_rate"]), "net": Decimal("0"), "tax": Decimal("0"), "gross": Decimal("0")},
                )
                group["net"] += item["net"]
                group["tax"] += item["tax"]
                group["gross"] += item["gross"]
            tax_breakdown = [
                {
                    "tax_rate": group["tax_rate"],
                    "net_amount": float(group["net"]),
                    "tax_amount": float(group["tax"]),
                    "gross_amount": float(group["gross"]),
                }
                for group in sorted(tax_groups.values(), key=lambda value: value["tax_rate"])
            ]

            cur.execute("SELECT pg_advisory_xact_lock(202609021334)")
            cur.execute(
                "SELECT last_value FROM invoice_number_counter WHERE counter_key = 'global' FOR UPDATE"
            )
            counter_row = cur.fetchone()
            last_value = int(counter_row[0]) if counter_row else 133
            next_value = max(last_value + 1, int(template["number_sequence_start"]))
            sequence_width = template["template_data"].get("sequence_width", 3)

            while True:
                invoice_number = build_invoice_number(
                    template["number_prefix"],
                    booking[15],
                    next_value,
                    template["number_suffix"],
                    sequence_width,
                )
                cur.execute("SELECT 1 FROM invoices WHERE invoice_number = %s LIMIT 1", (invoice_number,))
                if not cur.fetchone():
                    break
                next_value += 1

            cur.execute(
                """
                INSERT INTO invoice_number_counter (counter_key, last_value, updated_at)
                VALUES ('global', %s, NOW())
                ON CONFLICT (counter_key) DO UPDATE
                SET last_value = EXCLUDED.last_value, updated_at = NOW()
                """,
                (next_value,),
            )

            recipient_snapshot = {
                "first_name": booking[7],
                "last_name": booking[8],
                "email": booking[9] or "",
                "phone": booking[10] or "",
                "street": booking[11] or "",
                "postal_code": booking[12] or "",
                "city": booking[13] or "",
            }
            template_snapshot = {
                **template["template_data"],
                "processor": processor,
                "template_id": template["id"],
                "template_key": template["template_key"],
                "template_name": template["name"],
                "event_title": booking[14],
                "event_date": booking[15].isoformat() if booking[15] else None,
                "event_time": booking[16].isoformat() if booking[16] else None,
            }
            invoice_date = data.invoice_date or datetime.now(ZoneInfo("Europe/Berlin")).date()
            unique_rates = {float(item["tax_rate"]) for item in calculated_items}
            summary_tax_rate = next(iter(unique_rates)) if len(unique_rates) == 1 else 0

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
                    template_id,
                    sequence_number,
                    reference_number,
                    tax_rate,
                    net_amount,
                    tax_amount,
                    gross_amount,
                    payment_status,
                    recipient_snapshot,
                    template_snapshot,
                    tax_breakdown,
                    notes,
                    finalized_at,
                    updated_at
                )
                VALUES (
                    %s, %s, %s, %s, %s, 'final', 'standard', %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                )
                RETURNING id
                """,
                (
                    booking[0],
                    invoice_number,
                    invoice_date,
                    data.due_date,
                    total_gross,
                    template["template_key"],
                    template["id"],
                    next_value,
                    invoice_number,
                    summary_tax_rate,
                    total_net,
                    total_tax,
                    total_gross,
                    data.payment_status if data.payment_status in {"offen", "bezahlt"} else "offen",
                    Jsonb(recipient_snapshot),
                    Jsonb(template_snapshot),
                    Jsonb(tax_breakdown),
                    data.notes.strip()[:1000],
                ),
            )
            invoice_id = int(cur.fetchone()[0])

            for position_no, item in enumerate(calculated_items, start=1):
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
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        invoice_id,
                        position_no,
                        item["description"],
                        item["quantity"],
                        item["unit_gross"],
                        item["tax_rate"],
                        item["net"],
                        item["tax"],
                        item["gross"],
                    ),
                )

            write_activity(
                cur,
                request,
                action="Rechnung final erstellt",
                entity_type="invoice",
                entity_id=invoice_id,
                customer_id=booking[2],
                performance_id=booking[3],
                booking_id=booking[0],
                description=f"Rechnung {invoice_number} für Buchung {booking[1]}",
                new_value=(
                    f"template={template['template_key']}; sequence={next_value}; "
                    f"net={total_net:.2f}; tax={total_tax:.2f}; gross={total_gross:.2f}"
                ),
            )
            conn.commit()

    return {
        "success": True,
        "invoice_id": invoice_id,
        "invoice_number": invoice_number,
        "reference_number": invoice_number,
        "booking_id": int(booking[0]),
        "booking_number": booking[1],
        "template_id": template["id"],
        "sequence_number": next_value,
        "invoice_date": invoice_date.isoformat(),
        "net_amount": float(total_net),
        "tax_amount": float(total_tax),
        "gross_amount": float(total_gross),
        "tax_breakdown": tax_breakdown,
        "recipient_snapshot": recipient_snapshot,
        "template_snapshot": template_snapshot,
        "items": [
            {
                "position_no": index,
                "description": item["description"],
                "quantity": float(item["quantity"]),
                "unit_gross": float(item["unit_gross"]),
                "tax_rate": float(item["tax_rate"]),
                "net_amount": float(item["net"]),
                "tax_amount": float(item["tax"]),
                "gross_amount": float(item["gross"]),
            }
            for index, item in enumerate(calculated_items, start=1)
        ],
    }
