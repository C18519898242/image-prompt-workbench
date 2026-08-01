import os
import secrets

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.config import Settings

TEST_PASSWORD = secrets.token_urlsafe(16)
os.environ.setdefault("AUTH_PASSWORD_HASH", hash_password(TEST_PASSWORD))

from app.main import create_app


@pytest.fixture
def password() -> str:
    return TEST_PASSWORD


@pytest.fixture
def client(password: str) -> TestClient:
    settings = Settings(auth_password_hash=hash_password(password))
    return TestClient(create_app(settings))
