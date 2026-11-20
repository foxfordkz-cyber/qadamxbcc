"""Mobile boundary over the EXISTING core app, exposed on a separate test-only port.

The core is an internal ASGI target, not mounted on the gateway's public routes.
Only exact role/method/path combinations are forwarded. Bank keys never leave this process.
"""

import hashlib
import json
import re
import secrets
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal, cast

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from redis.exceptions import RedisError
from sqlalchemy import select

from app.api.deps import SessionDep
from app.core.config import Settings
from app.core.resources import Resources
from app.integrations.capabilities import Principal, issue_token
from app.integrations.config import IntegrationSettings
from app.main import create_app
from app.mobile_gateway.config import MobileSettings
from app.models import Account, Transaction

UUID_PATTERN = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
CLIENT_PATHS = [
    ("POST", r"transfers/evaluate"),
    ("POST", rf"transfers/requests/{UUID_PATTERN}/abandon"),
    ("GET", rf"transfers/{UUID_PATTERN}"),
    ("POST", rf"transfers/{UUID_PATTERN}/(?:resolve-cooling|cancel)"),
    ("POST", r"call-check"),
    ("GET", r"trusted-contacts"),
    ("POST", r"trusted-contacts"),
    ("DELETE", rf"trusted-contacts/{UUID_PATTERN}"),
    ("PATCH", rf"trusted-contacts/{UUID_PATTERN}/preferences"),
    ("GET", rf"trusted-contacts/transactions/{UUID_PATTERN}/notifications"),
    ("GET", r"integrations/guardian/reports"),
    ("POST", r"integrations/guardian/reports"),
    ("GET", rf"integrations/guardian/reports/{UUID_PATTERN}(?:/history)?"),
    ("GET", rf"integrations/guardian/reports/{UUID_PATTERN}/information-requests"),
    ("POST", rf"integrations/guardian/reports/{UUID_PATTERN}/information-requests/{UUID_PATTERN}"),
    ("POST", r"integrations/guardian/scam-check"),
    ("POST", r"external-checks"),
    ("GET", rf"external-checks/{UUID_PATTERN}"),
]
ADMIN_PATHS = [
    ("GET", r"soc/feed"),
    ("GET", rf"soc/graph/{UUID_PATTERN}"),
    ("GET", rf"transfers/{UUID_PATTERN}"),
    ("GET", rf"integrations/soc/transactions/{UUID_PATTERN}(?:/timeline|/summary)?"),
    ("GET", r"integrations/health(?:/details)?"),
    ("GET", r"integrations/guardian/reports"),
    ("GET", rf"integrations/guardian/reports/{UUID_PATTERN}(?:/history)?"),
    ("POST", rf"integrations/guardian/reports/{UUID_PATTERN}/acknowledge"),
    ("GET", r"integrations/guardian/soc/cases(?:/analytics)?"),
    ("POST", r"integrations/guardian/soc/cases"),
    ("GET", rf"integrations/guardian/soc/cases/{UUID_PATTERN}(?:/events|/history|/evidence)?"),
    ("POST", rf"integrations/guardian/soc/cases/{UUID_PATTERN}/actions"),
]


WEB_COOKIE = "__Host-qadam-session"


def check_web_origin(request: Request) -> None:
    trusted_origin = f"https://{request.url.netloc}"
    if request.url.hostname in ("127.0.0.1", "localhost") and request.url.scheme == "http":
        trusted_origin = f"http://{request.url.netloc}"
    if request.headers.get("x-qadam-web") != "1" or request.headers.get("origin") != trusted_origin:
        raise HTTPException(403, "web_origin_required")


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    code: SecretStr = Field(min_length=24, max_length=128)


class Identity(BaseModel):
    role: Literal["client", "admin"]
    subject: uuid.UUID


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def session_key(token: str) -> str:
    return f"bcc:mobile:session:{digest(token)}"


async def quota(resources: Resources, key: str, limit: int) -> None:
    try:
        async with resources.redis.pipeline(transaction=True) as pipe:
            pipe.incr(f"bcc:mobile:rate:{key}")
            pipe.expire(f"bcc:mobile:rate:{key}", 60, nx=True)
            count, _ = await pipe.execute()
    except RedisError as exc:
        raise HTTPException(503, "mobile_unavailable") from exc
    if int(count) > limit:
        raise HTTPException(429, "mobile_rate_limit", headers={"Retry-After": "60"})


async def identity(
    request: Request,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(HTTPBearer(auto_error=False))
    ],
) -> Identity:
    token = credentials.credentials if credentials else request.cookies.get(WEB_COOKIE, "")
    if not credentials and token:
        if request.headers.get("x-qadam-web") != "1":
            raise HTTPException(401, "mobile_login_required")
        if request.method not in ("GET", "HEAD"):
            check_web_origin(request)
    if not re.fullmatch(r"[A-Za-z0-9_-]{40,100}", token):
        raise HTTPException(401, "mobile_login_required")
    resources: Resources = request.app.state.resources
    try:
        raw = await resources.redis.get(session_key(token))
    except RedisError as exc:
        raise HTTPException(503, "mobile_unavailable") from exc
    if raw is None:
        raise HTTPException(401, "mobile_session_expired")
    principal = Identity.model_validate_json(raw)
    if not credentials and request.headers.get("x-qadam-subject") != str(principal.subject):
        raise HTTPException(401, "web_account_changed")
    request.state.session_token = token
    await quota(resources, f"session:{digest(token)}", 120)
    return principal


IdentityDep = Annotated[Identity, Depends(identity)]


def create_mobile_app(
    mobile: MobileSettings | None = None,
    settings: Settings | None = None,
    resources: Resources | None = None,
    integrations: IntegrationSettings | None = None,
) -> FastAPI:
    cfg = mobile or MobileSettings()
    core_cfg = settings or Settings()
    if not cfg.enabled or core_cfg.environment == "pilot":
        raise ValueError("Mobile gateway requires an explicitly enabled synthetic test environment")
    core = create_app(core_cfg, resources)
    if integrations is not None:
        core.state.integration_settings = integrations
    # This process never starts a Telegram worker. The gateway cannot enqueue notifications.
    if core.state.integration_settings.telegram_mode == "test" and cfg.auth_mode != "password":
        raise ValueError("Mobile rehearsal requires fake or disabled Telegram")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with core.router.lifespan_context(core):
            app.state.resources = core.state.resources
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=core), base_url="http://internal-core"
            ) as client:
                app.state.core_client = client
                yield

    app = FastAPI(title="Qadam Android synthetic gateway", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_methods=["GET", "POST", "DELETE", "PATCH"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    @app.middleware("http")
    async def privacy(request: Request, call_next: Any) -> Response:
        # Bound actual bytes, including chunked bodies, before JSON validation.
        size = 0
        chunks: list[bytes] = []
        async for chunk in request.stream():
            size += len(chunk)
            if size > 16384:
                return JSONResponse({"detail": "mobile_body_too_large"}, status_code=413)
            chunks.append(chunk)
        # Starlette's cached request forwards this bounded body to the downstream router.
        request._body = b"".join(chunks)
        response: Response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"detail": "mobile_input_invalid"}, status_code=422)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "mode": "synthetic-test"}

    from app.mobile_gateway.accounts import install_accounts
    from app.mobile_gateway.passwords import PasswordLogin, verify

    app.state.guardian_username = cfg.telegram_username
    app.state.telegram_mode = core.state.integration_settings.telegram_mode
    app.state.mobile_bot = (
        cfg.telegram_username if core.state.integration_settings.telegram_mode == "test" else ""
    )
    from app.mobile_gateway.protection import install_protection
    from app.mobile_gateway.wallet import install_wallet

    install_wallet(app)
    install_accounts(app)
    install_protection(app, core.state.integration_settings)

    @app.post("/mobile/v1/auth/login")
    async def password_login(
        body: PasswordLogin, request: Request, response: Response
    ) -> dict[str, Any]:
        if cfg.auth_mode != "password":
            raise HTTPException(404, "unavailable")
        res: Resources = request.app.state.resources
        peer = request.client.host if request.client else "unknown"
        await quota(res, f"password:{digest(peer)}", 24)
        import asyncio

        web = request.headers.get("x-qadam-web") == "1"
        if web:
            check_web_origin(request)
        admin = body.login == "admin_demo"
        encoded = cfg.admin_hash if admin else cfg.client_hash
        matches = await asyncio.to_thread(
            verify, body.password.get_secret_value(), encoded.get_secret_value()
        )
        if not matches or body.login not in ("client_demo", "admin_demo"):
            raise HTTPException(401, "invalid_credentials")
        result = await issue_session(
            res,
            Identity(
                role="admin" if admin else "client",
                subject=cfg.officer_id if admin else cfg.customer_id,
            ),
        )

        if web:
            response.set_cookie(
                WEB_COOKIE,
                result.pop("token"),
                max_age=cfg.session_seconds,
                httponly=True,
                secure=True,
                samesite="strict",
                path="/",
            )
        return result

    @app.post("/mobile/v1/sessions")
    async def login(body: Login, request: Request) -> dict[str, Any]:
        if cfg.auth_mode != "rehearsal":
            raise HTTPException(404, "unavailable")
        res: Resources = request.app.state.resources
        peer = request.client.host if request.client else "unknown"
        await quota(res, f"login:{digest(peer)}", 8)
        supplied = digest(body.code.get_secret_value())
        is_client = secrets.compare_digest(supplied, digest(cfg.client_code.get_secret_value()))
        is_admin = secrets.compare_digest(supplied, digest(cfg.admin_code.get_secret_value()))
        if not is_client and not is_admin:
            raise HTTPException(401, "mobile_bad_code")
        principal = Identity(
            role="client" if is_client else "admin",
            subject=cfg.customer_id if is_client else cfg.officer_id,
        )
        return await issue_session(res, principal)

    async def issue_session(res: Resources, principal: Identity) -> dict[str, Any]:
        if principal.role == "client":
            async with res.session_factory() as session:
                if await session.get(Account, principal.subject) is None:
                    raise HTTPException(503, "mobile_fixtures_missing")
        token = secrets.token_urlsafe(32)
        try:
            await res.redis.set(
                session_key(token), principal.model_dump_json(), ex=cfg.session_seconds
            )
        except RedisError as exc:
            raise HTTPException(503, "mobile_unavailable") from exc
        return {
            "token": token,
            "subject": str(principal.subject),
            "role": principal.role,
            "expires_in": cfg.session_seconds,
            "mode": "synthetic-test",
        }

    @app.get("/mobile/v1/session")
    async def current(principal: IdentityDep) -> dict[str, str]:
        return {"role": principal.role, "subject": str(principal.subject), "mode": "synthetic-test"}

    @app.delete("/mobile/v1/session", status_code=204)
    async def logout(request: Request, principal: IdentityDep) -> Response:
        token = request.state.session_token
        try:
            await request.app.state.resources.redis.delete(session_key(token))
        except RedisError as exc:
            raise HTTPException(503, "mobile_unavailable") from exc
        response = Response(status_code=204)
        if WEB_COOKIE in request.cookies:
            response.delete_cookie(
                WEB_COOKIE, path="/", secure=True, httponly=True, samesite="strict"
            )
        return response

    async def dispatch(
        request: Request, principal: Identity, path: str, body: dict[str, Any] | None = None
    ) -> Response:
        headers = {"Content-Type": "application/json"}
        if core_cfg.api_key:
            headers["X-BCC-API-Key"] = core_cfg.api_key.get_secret_value()
        if core_cfg.soc_api_key:
            headers["X-BCC-SOC-Key"] = core_cfg.soc_api_key.get_secret_value()
        icfg: IntegrationSettings = core.state.integration_settings
        if icfg.enabled:
            headers["Authorization"] = "Bearer " + issue_token(
                Principal(
                    role="owner" if principal.role == "client" else "soc", subject=principal.subject
                ),
                icfg.signing_key.get_secret_value(),
                ttl=60,
            )
        key = request.headers.get("idempotency-key")
        if key:
            try:
                headers["Idempotency-Key"] = str(uuid.UUID(key))
            except ValueError as exc:
                raise HTTPException(422, "mobile_input_invalid") from exc
        if path.startswith("integrations/guardian/soc/cases/") and path.endswith("/events"):
            path = path.removesuffix("/events") + "/history"
        result = await request.app.state.core_client.request(
            request.method,
            f"{core_cfg.api_prefix}/{path}",
            params=request.query_params,
            json=body,
            headers=headers,
        )
        data = result.content
        if result.status_code >= 400:
            # Core validation may echo arbitrary inputs; do not forward raw error bodies.
            data = json.dumps({"detail": f"mobile_core_{result.status_code}"}).encode()
        response_headers = (
            {"Retry-After": result.headers["Retry-After"]}
            if "Retry-After" in result.headers
            else {}
        )
        return Response(
            data,
            status_code=result.status_code,
            media_type="application/json",
            headers=response_headers,
        )

    @app.post("/mobile/v1/requests", status_code=201)
    async def reserve_request(request: Request, principal: IdentityDep) -> dict[str, str]:
        """Register ownership before the phone attempts a mutation with an uncertain outcome."""
        if principal.role != "client":
            raise HTTPException(403, "mobile_role_forbidden")
        request_id = uuid.uuid4()
        resources: Resources = request.app.state.resources
        try:
            await resources.redis.set(
                f"bcc:mobile:request:{request_id}", str(principal.subject), nx=True, ex=86400
            )
        except RedisError as exc:
            raise HTTPException(503, "mobile_unavailable") from exc
        return {"request_id": str(request_id)}

    @app.get("/mobile/v1/transfers")
    async def own_history(
        request: Request,
        principal: IdentityDep,
        session: SessionDep,
        limit: Annotated[int, Query(ge=1, le=50)] = 20,
        offset: Annotated[int, Query(ge=0, le=10000)] = 0,
    ) -> dict[str, Any]:
        if principal.role != "client":
            raise HTTPException(403, "mobile_role_forbidden")
        rows = list(
            (
                await session.scalars(
                    select(Transaction)
                    .where(Transaction.sender_id == principal.subject)
                    .order_by(Transaction.created_at.desc(), Transaction.id.desc())
                    .offset(offset)
                    .limit(limit + 1)
                )
            ).all()
        )
        return {
            "items": [
                {
                    "transaction_id": str(row.id),
                    "status": row.status,
                    "amount": str(row.amount),
                    "created_at": row.created_at,
                    "risk_score": row.risk_score,
                }
                for row in rows[:limit]
            ],
            "has_more": len(rows) > limit,
            "offset": offset,
        }

    @app.api_route("/mobile/v1/api/{path:path}", methods=["GET", "POST", "DELETE", "PATCH"])
    async def proxy(
        path: str, request: Request, principal: IdentityDep, session: SessionDep
    ) -> Response:
        allowlist = CLIENT_PATHS if principal.role == "client" else ADMIN_PATHS
        if not any(
            request.method == method and re.fullmatch(pattern, path)
            for method, pattern in allowlist
        ):
            raise HTTPException(403, "mobile_role_forbidden")
        body: dict[str, Any] | None = None
        if request.method in ("POST", "PATCH"):
            try:
                parsed = await request.json()
                if not isinstance(parsed, dict):
                    raise ValueError
                body = cast(dict[str, Any], parsed)
            except (ValueError, TypeError) as exc:
                raise HTTPException(422, "mobile_input_invalid") from exc
        if principal.role == "client":
            if path == "transfers/evaluate" and body is not None:
                if body.get("sender_id", str(principal.subject)) != str(principal.subject):
                    raise HTTPException(403, "mobile_owner_forbidden")
                if cfg.auth_mode == "password":
                    from app.mobile_gateway.accounts import RECIPIENTS

                    if body.get("recipient_phone") not in RECIPIENTS or body.get("recipient_iban"):
                        raise HTTPException(422, "mobile_recipient_unavailable")
                body["sender_id"] = str(principal.subject)
                # Replayed request IDs must also belong to this customer.
                try:
                    request_id = uuid.UUID(body["request_id"])
                    existing = await session.scalar(
                        select(Transaction).where(
                            (Transaction.id == request_id) | (Transaction.request_id == request_id)
                        )
                    )
                except (KeyError, ValueError, TypeError, AttributeError) as exc:
                    raise HTTPException(422, "mobile_request_id_required") from exc
                if existing is not None and existing.sender_id != principal.subject:
                    raise HTTPException(404, "mobile_transaction_not_found")
                res: Resources = request.app.state.resources
                owner_key = f"bcc:mobile:request:{request_id}"
                try:
                    await res.redis.set(owner_key, str(principal.subject), nx=True, ex=86400)
                    owner = await res.redis.get(owner_key)
                except RedisError as exc:
                    raise HTTPException(503, "mobile_unavailable") from exc
                if owner not in (str(principal.subject), str(principal.subject).encode()):
                    raise HTTPException(404, "mobile_transaction_not_found")
            elif path.startswith("transfers/requests/"):
                request_id = uuid.UUID(path.split("/")[2])
                res = request.app.state.resources
                try:
                    owner = await res.redis.get(f"bcc:mobile:request:{request_id}")
                except RedisError as exc:
                    raise HTTPException(503, "mobile_unavailable") from exc
                if owner not in (str(principal.subject), str(principal.subject).encode()):
                    raise HTTPException(404, "mobile_transaction_not_found")
                existing = await session.scalar(
                    select(Transaction).where(
                        (Transaction.id == request_id) | (Transaction.request_id == request_id)
                    )
                )
                if existing is not None and existing.sender_id != principal.subject:
                    raise HTTPException(404, "mobile_transaction_not_found")
            elif path.startswith("transfers/"):
                tx = await session.get(Transaction, uuid.UUID(path.split("/")[1]))
                if tx is None or tx.sender_id != principal.subject:
                    raise HTTPException(404, "mobile_transaction_not_found")
            if path == "call-check" and body is not None:
                body["customer_id"] = str(principal.subject)
        # Release the read transaction before the core opens its own transaction.
        # This also prevents deadlock on the single-connection SQLite test pool.
        await session.rollback()
        return await dispatch(request, principal, path, body)

    web_assets = Path(__file__).resolve().parents[2] / ".qadam-web"
    if (web_assets / "index.html").is_file():
        app.mount("/wallet", StaticFiles(directory=web_assets, html=True), name="connected_wallet")
    return app


def factory() -> FastAPI:
    """uvicorn app.mobile_gateway.app:factory --factory --port 18001"""
    return create_mobile_app()
