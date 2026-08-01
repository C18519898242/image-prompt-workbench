import secrets

import pytest
from argon2 import PasswordHasher, Type

from app.auth import AuthState, hash_password, verify_password


def test_hash_password_uses_argon2id() -> None:
    password = secrets.token_urlsafe(16)
    wrong_password = secrets.token_urlsafe(16)
    hashed = hash_password(password)

    assert hashed.startswith("$argon2id$")
    assert verify_password(password, hashed)
    assert not verify_password(wrong_password, hashed)


def test_new_login_replaces_the_active_token() -> None:
    password = secrets.token_urlsafe(16)
    state = AuthState(hash_password(password))

    first_token = state.login(password)
    second_token = state.login(password)

    assert first_token is not None
    assert second_token is not None
    assert first_token != second_token
    assert not state.authenticate(first_token)
    assert state.authenticate(second_token)


def test_invalid_password_does_not_create_token() -> None:
    password = secrets.token_urlsafe(16)
    wrong_password = secrets.token_urlsafe(16)
    state = AuthState(hash_password(password))

    assert state.login(wrong_password) is None


def test_logout_only_clears_the_matching_token() -> None:
    password = secrets.token_urlsafe(16)
    state = AuthState(hash_password(password))
    token = state.login(password)
    assert token is not None

    assert state.logout("old-token") is False
    assert state.authenticate(token)
    assert state.logout(token) is True
    assert not state.authenticate(token)


def test_invalid_config_hash_fails_fast() -> None:
    with pytest.raises(ValueError, match="AUTH_PASSWORD_HASH"):
        AuthState("not-an-argon2-hash")


def test_argon2i_config_hash_fails_fast() -> None:
    password = secrets.token_urlsafe(16)
    argon2i_hash = PasswordHasher(type=Type.I).hash(password)

    with pytest.raises(ValueError, match="AUTH_PASSWORD_HASH"):
        AuthState(argon2i_hash)
