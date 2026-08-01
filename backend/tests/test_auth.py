import pytest
from argon2 import PasswordHasher, Type

from app.auth import AuthState, hash_password, verify_password


def test_hash_password_uses_argon2id() -> None:
    hashed = hash_password("correct horse battery staple")

    assert hashed.startswith("$argon2id$")
    assert verify_password("correct horse battery staple", hashed)
    assert not verify_password("wrong password", hashed)


def test_new_login_replaces_the_active_token() -> None:
    state = AuthState(hash_password("secret"))

    first_token = state.login("secret")
    second_token = state.login("secret")

    assert first_token is not None
    assert second_token is not None
    assert first_token != second_token
    assert not state.authenticate(first_token)
    assert state.authenticate(second_token)


def test_invalid_password_does_not_create_token() -> None:
    state = AuthState(hash_password("secret"))

    assert state.login("wrong") is None


def test_logout_only_clears_the_matching_token() -> None:
    state = AuthState(hash_password("secret"))
    token = state.login("secret")
    assert token is not None

    assert state.logout("old-token") is False
    assert state.authenticate(token)
    assert state.logout(token) is True
    assert not state.authenticate(token)


def test_invalid_config_hash_fails_fast() -> None:
    with pytest.raises(ValueError, match="AUTH_PASSWORD_HASH"):
        AuthState("not-an-argon2-hash")


def test_argon2i_config_hash_fails_fast() -> None:
    argon2i_hash = PasswordHasher(type=Type.I).hash("secret")

    with pytest.raises(ValueError, match="AUTH_PASSWORD_HASH"):
        AuthState(argon2i_hash)
