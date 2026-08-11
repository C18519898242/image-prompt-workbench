import asyncio
import json
from collections.abc import Awaitable, Callable
from tempfile import SpooledTemporaryFile
from typing import Any

import pytest
from starlette import formparsers
from starlette.requests import Request

from app.prompt_card_request_guard import (
    PromptCardRequestGuard,
    PromptCardRequestTooLarge,
)


def test_guard_covers_signed_integer_card_id() -> None:
    assert PromptCardRequestGuard._guards(
        {
            "type": "http",
            "method": "PUT",
            "path": "/api/prompt-cards/+1",
            "headers": [],
        }
    )


def test_guard_rejects_chunked_body_over_limit_without_content_length() -> None:
    request_messages = iter(
        [
            {"type": "http.request", "body": b"12", "more_body": True},
            {"type": "http.request", "body": b"34", "more_body": False},
        ]
    )
    response_messages: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return next(request_messages)

    async def send(message: dict[str, Any]) -> None:
        response_messages.append(message)

    async def downstream(
        scope: dict[str, Any],
        receive_body: Callable[[], Awaitable[dict[str, Any]]],
        send_response: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        while True:
            message = await receive_body()
            if not message.get("more_body", False):
                break
        await send_response(
            {"type": "http.response.start", "status": 204, "headers": []}
        )
        await send_response({"type": "http.response.body", "body": b""})

    guard = PromptCardRequestGuard(downstream, max_request_bytes=3)
    asyncio.run(
        guard(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/prompt-cards",
                "headers": [(b"content-type", b"multipart/form-data")],
            },
            receive,
            send,
        )
    )

    start = next(
        message
        for message in response_messages
        if message["type"] == "http.response.start"
    )
    body = next(
        message
        for message in response_messages
        if message["type"] == "http.response.body"
    )
    assert start["status"] == 413
    assert json.loads(body["body"])["detail"] == "上传请求体过大"


def test_guard_does_not_replace_started_response_after_body_limit() -> None:
    request_messages = iter(
        [
            {"type": "http.request", "body": b"12", "more_body": True},
            {"type": "http.request", "body": b"34", "more_body": False},
        ]
    )
    response_messages: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return next(request_messages)

    async def send(message: dict[str, Any]) -> None:
        response_messages.append(message)

    async def downstream(
        scope: dict[str, Any],
        receive_body: Callable[[], Awaitable[dict[str, Any]]],
        send_response: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        await send_response(
            {"type": "http.response.start", "status": 200, "headers": []}
        )
        while True:
            message = await receive_body()
            if not message.get("more_body", False):
                break

    caught: PromptCardRequestTooLarge | None = None
    guard = PromptCardRequestGuard(downstream, max_request_bytes=3)
    try:
        asyncio.run(
            guard(
                {
                    "type": "http",
                    "method": "POST",
                    "path": "/api/prompt-cards",
                    "headers": [],
                },
                receive,
                send,
            )
        )
    except PromptCardRequestTooLarge as error:
        caught = error

    response_starts = [
        message["status"]
        for message in response_messages
        if message["type"] == "http.response.start"
    ]
    assert response_starts == [200]
    assert isinstance(caught, PromptCardRequestTooLarge)


def test_real_multipart_over_limit_returns_413_and_closes_temporary_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    boundary = b"prompt-card-boundary"
    prefix = (
        b"--" + boundary + b"\r\n"
        b'Content-Disposition: form-data; name="new_images"; filename="one.jpg"\r\n'
        b"Content-Type: image/jpeg\r\n\r\n"
        b"12"
    )
    suffix = b"34567890\r\n--" + boundary + b"--\r\n"
    request_messages = iter(
        [
            {"type": "http.request", "body": prefix, "more_body": True},
            {"type": "http.request", "body": suffix, "more_body": False},
        ]
    )
    response_messages: list[dict[str, Any]] = []
    created_files: list[SpooledTemporaryFile[bytes]] = []

    class RecordingTemporaryFile(SpooledTemporaryFile[bytes]):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, **kwargs)
            created_files.append(self)

    monkeypatch.setattr(
        formparsers,
        "SpooledTemporaryFile",
        RecordingTemporaryFile,
    )

    async def receive() -> dict[str, Any]:
        return next(request_messages)

    async def send(message: dict[str, Any]) -> None:
        response_messages.append(message)

    async def downstream(
        scope: dict[str, Any],
        receive_body: Callable[[], Awaitable[dict[str, Any]]],
        send_response: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        request = Request(scope, receive_body)
        form = await request.form()
        await form.close()
        await send_response(
            {"type": "http.response.start", "status": 204, "headers": []}
        )
        await send_response({"type": "http.response.body", "body": b""})

    guard = PromptCardRequestGuard(downstream, max_request_bytes=len(prefix) + 1)
    asyncio.run(
        guard(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "POST",
                "scheme": "http",
                "path": "/api/prompt-cards",
                "raw_path": b"/api/prompt-cards",
                "query_string": b"",
                "headers": [
                    (
                        b"content-type",
                        b"multipart/form-data; boundary=" + boundary,
                    )
                ],
                "client": ("testclient", 50000),
                "server": ("testserver", 80),
            },
            receive,
            send,
        )
    )

    start = next(
        message
        for message in response_messages
        if message["type"] == "http.response.start"
    )
    assert start["status"] == 413
    assert len(created_files) == 1
    assert created_files[0].closed
