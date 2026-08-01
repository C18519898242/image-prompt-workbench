import os

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.config import Settings

os.environ.setdefault("AUTH_PASSWORD_HASH", hash_password("secret"))

from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    settings = Settings(auth_password_hash=hash_password("secret"))
    return TestClient(create_app(settings))
