import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any

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
