import secrets

import pytest

from app import cli


def test_hash_password_command_prints_argon2_hash(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    password = secrets.token_urlsafe(16)
    answers = iter([password, password])
    monkeypatch.setattr(cli, "getpass", lambda _prompt: next(answers))

    exit_code = cli.main(["hash-password"])

    captured = capsys.readouterr()
    assert exit_code == 0
    assert captured.err == ""
    assert captured.out.strip().startswith("$argon2id$")


def test_hash_password_command_rejects_mismatch(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    password = secrets.token_urlsafe(16)
    confirmation = secrets.token_urlsafe(16)
    while confirmation == password:
        confirmation = secrets.token_urlsafe(16)
    answers = iter([password, confirmation])
    monkeypatch.setattr(cli, "getpass", lambda _prompt: next(answers))

    exit_code = cli.main(["hash-password"])

    captured = capsys.readouterr()
    assert exit_code == 1
    assert captured.out == ""
    assert "do not match" in captured.err


def test_hash_password_command_rejects_empty_password(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    answers = iter(["", ""])
    monkeypatch.setattr(cli, "getpass", lambda _prompt: next(answers))

    assert cli.main(["hash-password"]) == 1
