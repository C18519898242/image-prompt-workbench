import secrets

from fastapi.testclient import TestClient


def test_health_is_public(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_welcome_requires_token(client: TestClient) -> None:
    response = client.get("/api/welcome")

    assert response.status_code == 401


def test_login_rejects_wrong_password(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        json={"password": secrets.token_urlsafe(16)},
    )

    assert response.status_code == 401


def test_login_welcome_and_logout_flow(client: TestClient, password: str) -> None:
    login = client.post("/api/auth/login", json={"password": password})
    assert login.status_code == 200
    token = login.json()["token"]

    welcome = client.get(
        "/api/welcome",
        headers={"Authorization": f"Bearer {token}"},
    )
    logout = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    after_logout = client.get(
        "/api/welcome",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert welcome.status_code == 200
    assert welcome.json() == {"message": "欢迎使用 Image Prompt Workbench"}
    assert logout.status_code == 204
    assert after_logout.status_code == 401


def test_second_login_invalidates_first_token(client: TestClient, password: str) -> None:
    first = client.post("/api/auth/login", json={"password": password}).json()["token"]
    second = client.post("/api/auth/login", json={"password": password}).json()["token"]

    first_response = client.get(
        "/api/welcome",
        headers={"Authorization": f"Bearer {first}"},
    )
    second_response = client.get(
        "/api/welcome",
        headers={"Authorization": f"Bearer {second}"},
    )

    assert first_response.status_code == 401
    assert second_response.status_code == 200


def test_old_token_cannot_logout_new_token(client: TestClient, password: str) -> None:
    first = client.post("/api/auth/login", json={"password": password}).json()["token"]
    second = client.post("/api/auth/login", json={"password": password}).json()["token"]

    old_logout = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {first}"},
    )
    new_welcome = client.get(
        "/api/welcome",
        headers={"Authorization": f"Bearer {second}"},
    )

    assert old_logout.status_code == 401
    assert new_welcome.status_code == 200
