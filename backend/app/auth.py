from __future__ import annotations

import secrets
from threading import Lock

from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError


PASSWORD_HASH = PasswordHash.recommended()


def hash_password(plain_password: str) -> str:
    if not plain_password:
        raise ValueError("password must not be empty")
    return PASSWORD_HASH.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return PASSWORD_HASH.verify(plain_password, hashed_password)
    except UnknownHashError:
        return False


def validate_password_hash(hashed_password: str) -> None:
    if not hashed_password.startswith("$argon2id$"):
        raise ValueError("AUTH_PASSWORD_HASH must be a valid Argon2id hash")
    try:
        PASSWORD_HASH.verify("", hashed_password)
    except UnknownHashError as exc:
        raise ValueError("AUTH_PASSWORD_HASH must be a valid Argon2id hash") from exc


class AuthState:
    def __init__(self, hashed_password: str) -> None:
        validate_password_hash(hashed_password)
        self._hashed_password = hashed_password
        self._active_token: str | None = None
        self._lock = Lock()

    def login(self, password: str) -> str | None:
        if not verify_password(password, self._hashed_password):
            return None
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._active_token = token
        return token

    def authenticate(self, token: str) -> bool:
        with self._lock:
            return secrets.compare_digest(self._active_token or "", token)

    def logout(self, token: str) -> bool:
        with self._lock:
            if not secrets.compare_digest(self._active_token or "", token):
                return False
            self._active_token = None
            return True
