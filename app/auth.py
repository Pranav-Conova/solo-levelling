"""Username/password accounts with server-side sessions in an HttpOnly cookie."""
import base64
import hashlib
import hmac
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from . import models
from .database import get_db

SESSION_COOKIE = "sl_session"
SESSION_DAYS = 30

# scrypt keeps brute force expensive without hogging a small CPU (Render's free tier);
# the parameters are stored with each hash so they can be raised later
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**15, 8, 1


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, maxmem=128 * n * r * 2, dklen=32)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = _scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        candidate = _scrypt(password, base64.b64decode(salt), int(n), int(r), int(p))
        return hmac.compare_digest(candidate, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


# compared against when the username doesn't exist, so response time doesn't reveal which names are taken
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def check_credentials(db: Session, username: str, password: str) -> models.User | None:
    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None:
        verify_password(password, _DUMMY_HASH)
        return None
    return user if verify_password(password, user.password_hash) else None


# ---------- sessions ----------
def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(db: Session, user: models.User, request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    now = _now()
    db.query(models.AuthSession).filter(models.AuthSession.expires_at < now).delete()
    db.add(models.AuthSession(token_hash=_token_hash(token), user_id=user.id, created_at=now,
                              expires_at=now + timedelta(days=SESSION_DAYS)))
    db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=_is_https(request),
        path="/",
    )


def end_session(db: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.query(models.AuthSession).filter(models.AuthSession.token_hash == _token_hash(token)).delete()
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


def end_other_sessions(db: Session, user: models.User, request: Request) -> None:
    keep = _token_hash(request.cookies.get(SESSION_COOKIE, ""))
    db.query(models.AuthSession).filter(
        models.AuthSession.user_id == user.id, models.AuthSession.token_hash != keep
    ).delete()
    db.commit()


def _is_https(request: Request) -> bool:
    # Render terminates TLS at its proxy and forwards the original scheme
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").startswith("https")


def optional_user(request: Request, db: Session = Depends(get_db)) -> models.User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = (
        db.query(models.AuthSession)
        .filter(models.AuthSession.token_hash == _token_hash(token), models.AuthSession.expires_at > _now())
        .first()
    )
    return db.get(models.User, session.user_id) if session else None


def current_user(user: models.User | None = Depends(optional_user)) -> models.User:
    if user is None:
        raise HTTPException(status_code=401, detail="Not logged in")
    return user


# ---------- brute-force protection ----------
class Throttle:
    """Counts failures per key in memory; enough for a single-instance deploy."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> list[float]:
        hits = [t for t in self._hits.get(key, []) if now - t < self.window]
        self._hits[key] = hits
        return hits

    def retry_after(self, key: str) -> int:
        """Seconds until `key` may try again, or 0 if it isn't blocked."""
        with self._lock:
            now = time.monotonic()
            hits = self._recent(key, now)
            if len(hits) < self.limit:
                return 0
            return max(1, int(self.window - (now - hits[0])))

    def hit(self, key: str) -> None:
        with self._lock:
            self._recent(key, time.monotonic()).append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


login_throttle = Throttle(limit=5, window_seconds=15 * 60)          # per username + IP
account_throttle = Throttle(limit=20, window_seconds=15 * 60)       # per username, across IPs
signup_throttle = Throttle(limit=10, window_seconds=60 * 60)


def client_ip(request: Request) -> str:
    # the last hop is the one added by our proxy (Render); earlier entries are client-controlled
    forwarded = request.headers.get("x-forwarded-for")
    return forwarded.split(",")[-1].strip() if forwarded else (request.client.host if request.client else "unknown")
