from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.prompt_card_uploads import MAX_TOTAL_UPLOAD_BYTES

MULTIPART_OVERHEAD_BYTES = 1024 * 1024
MAX_PROMPT_CARD_REQUEST_BYTES = MAX_TOTAL_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES


class PromptCardRequestTooLarge(OSError):
    pass


class PromptCardRequestGuard:
    def __init__(
        self,
        app: ASGIApp,
        *,
        max_request_bytes: int = MAX_PROMPT_CARD_REQUEST_BYTES,
    ) -> None:
        self.app = app
        self.max_request_bytes = max_request_bytes

    @staticmethod
    def _guards(scope: Scope) -> bool:
        if scope["type"] != "http":
            return False
        method = scope.get("method")
        path = scope.get("path", "")
        if method == "POST":
            return path == "/api/prompt-cards"
        if method != "PUT" or not path.startswith("/api/prompt-cards/"):
            return False
        card_id = path.removeprefix("/api/prompt-cards/")
        return bool(card_id) and "/" not in card_id

    def _content_length_exceeds_limit(self, scope: Scope) -> bool:
        for name, value in scope.get("headers", []):
            if name.lower() != b"content-length":
                continue
            try:
                return int(value) > self.max_request_bytes
            except ValueError:
                return False
        return False

    async def _send_too_large(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        response = JSONResponse(
            status_code=413,
            content={"detail": "上传请求体过大"},
        )
        await response(scope, receive, send)

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if not self._guards(scope):
            await self.app(scope, receive, send)
            return
        if self._content_length_exceeds_limit(scope):
            await self._send_too_large(scope, receive, send)
            return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_request_bytes:
                    raise PromptCardRequestTooLarge
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            await send(message)
            if message["type"] == "http.response.start":
                response_started = True

        try:
            await self.app(scope, limited_receive, tracked_send)
        except PromptCardRequestTooLarge:
            if response_started:
                raise
            await self._send_too_large(scope, receive, send)
