import pytest
from pydantic import ValidationError

from app.config import Settings


def test_settings_reads_auth_password_hash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_PASSWORD_HASH", "configured-hash")

    settings = Settings()

    assert settings.auth_password_hash == "configured-hash"


def test_settings_requires_auth_password_hash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AUTH_PASSWORD_HASH", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_settings_has_grok_defaults() -> None:
    settings = Settings(
        auth_password_hash="hash",
        _env_file=None,
    )

    assert settings.grok_api_key == ""
    assert settings.grok_base_url == "https://grok-api.xyz365.tech/v1"
    assert settings.grok_model == "grok-4.5"
