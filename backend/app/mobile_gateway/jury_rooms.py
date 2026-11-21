"""Bounded, single-process room routing for the separate public jury wallet."""

import asyncio
import logging
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from posixpath import normpath
from time import monotonic

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from app.mobile_gateway.app import WEB_COOKIE

Factory = Callable[[int], AbstractAsyncContextManager[ASGIApp]]
ROOM_COOKIE = "__Host-saq-jury"
CONTACT_COOKIE = "__Host-saq-jury-contact"
CONTACT_INBOX = "/jury/contact/inbox"
IDLE_SECONDS = 30 * 60
MAX_ROOMS = 8
log = logging.getLogger(__name__)


@dataclass
class Room:
    slot: int
    app: ASGIApp
    context: AbstractAsyncContextManager[ASGIApp]
    last_used: float
    active: int = 0
    contact_invite: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    contact_session: str = field(default_factory=lambda: secrets.token_urlsafe(32))


class RoomPool:
    """A reservation is taken before awaiting startup and returned only after teardown."""

    def __init__(self, factory: Factory, clock: Callable[[], float] = monotonic) -> None:
        self.factory = factory
        self.clock = clock
        self.free = set(range(1, MAX_ROOMS + 1))
        self.rooms: dict[str, Room] = {}
        self.releasing: set[asyncio.Task[None]] = set()
        self.stopping = False
        self.starting = 0
        self.changed = asyncio.Event()

    def expired(self, room: Room) -> bool:
        return room.active == 0 and self.clock() - room.last_used >= IDLE_SECONDS

    @contextmanager
    def borrow(self, key: str | None) -> Iterator[Room | None]:
        room = self.rooms.get(key or "")
        if self.stopping or room is None or self.expired(room):
            yield None
            return
        room.active += 1
        try:
            yield room
        finally:
            room.last_used = self.clock()
            room.active -= 1
            if self.stopping:
                self.changed.set()

    async def release(self, room: Room) -> None:
        try:
            await room.context.__aexit__(None, None, None)
        except Exception:
            # Retire a slot whose database or Redis namespace might still be open.
            log.error("Could not close jury wallet slot %d", room.slot)
        else:
            self.free.add(room.slot)

    async def reap(self, *, shutdown: bool = False) -> None:
        if shutdown:
            self.stopping = True
            while self.starting or any(r.active for r in self.rooms.values()):
                self.changed.clear()
                await self.changed.wait()
        # No await between eviction and removal. Other requests can use healthy rooms
        # while these contexts release their databases and Redis namespaces.
        keys = [key for key, r in self.rooms.items() if shutdown or self.expired(r)]
        closing = [self.rooms.pop(key) for key in keys]
        for room in closing:
            task = asyncio.create_task(self.release(room))
            self.releasing.add(task)
            task.add_done_callback(self.releasing.discard)
        if self.releasing:
            # An abandoned start request cannot cancel a pending storage cleanup.
            await asyncio.shield(asyncio.gather(*self.releasing))

    async def create(self, *, factory: Factory | None = None) -> str | None:
        if self.stopping:
            return None
        if not self.free:
            await self.reap()
        if self.stopping or not self.free:
            return None
        slot = min(self.free)
        self.free.remove(slot)
        self.starting += 1
        try:
            context = (factory if factory is not None else self.factory)(slot)
            app = await context.__aenter__()
        except BaseException:
            # Failed context entry has completed its own startup cleanup. Each entry
            # must initialize fresh backing stores for the reserved slot.
            self.free.add(slot)
            raise
        finally:
            self.starting -= 1
            if self.stopping:
                self.changed.set()
        key = secrets.token_urlsafe(32)
        self.rooms[key] = Room(slot, app, context, self.clock())
        return key


_HEAD = """<!doctype html><html lang="kk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saq Bol × BCC · Қазылар алқасы / Жюри</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#101828;
font:1rem/1.5 system-ui,sans-serif}main{max-width:36rem;margin:8vh auto;padding:2rem;
border-radius:1.5rem;background:white}h1{font-size:1.6rem;line-height:1.2}button,a{font:inherit}
button{border:0;border-radius:.75rem;padding:.7rem 1rem;background:#00804c;color:white;
cursor:pointer}a{color:#006b40}small{color:#475467}p{margin:1rem 0}
details{margin-top:1.25rem}summary{cursor:pointer}dt{font-weight:600;margin-top:.75rem}
dd{margin:0}code{overflow-wrap:anywhere}.room-actions{display:flex;gap:.5rem;flex-wrap:wrap}
.with-history{color:#006b40;background:white;border:1px solid #00804c}
</style></head><body><main><small>Saq Bol × BCC</small>"""

_PUBLIC_LOGINS = """<details><summary>Үш рөлге кіру / Вход под тремя ролями</summary>
<dl><dt>Клиент</dt>
<dd>Логин <code>client_demo</code><br>Құпиясөз / Пароль <code>SaqBol-Client-2026</code></dd>
<dt>SOC қызметкері / Сотрудник SOC</dt>
<dd>Логин <code>admin_demo</code><br>Құпиясөз / Пароль <code>SaqBol-Officer-2026</code></dd>
<dt>Платформа әкімшісі / Администратор платформы</dt>
<dd>Логин <code>platform_demo</code><br>Құпиясөз / Пароль <code>SaqBol-Platform-2026</code></dd>
</dl></details>"""


def landing(
    *,
    key: str | None = None,
    contact_invite: str | None = None,
    history_available: bool = False,
    message: str = "",
    status: int = 200,
) -> HTMLResponse:
    # All markup consists of fixed bilingual copy and a server-generated URL-safe key.
    title = "<h1>Қазылар алқасының әмияны<br><span lang=ru>Кошелёк жюри</span></h1>"
    intro = (
        "<p>Клиент пен SOC қызметкері бір оқу ісімен жұмыс істейді. "
        "Әкімші сұраулар санын көреді және қызметкердің кіру рұқсатын басқарады. "
        "Бөлме 30 минут әрекетсіздіктен кейін тазартылады.</p>"
        "<p lang=ru>Клиент и сотрудник SOC работают с одним учебным делом. "
        "Администратор видит счётчики запросов и управляет доступом сотрудника. "
        "Через 30 минут бездействия данные комнаты удаляются.</p>"
    )
    submit = "Әмиянға оралу / Вернуться в кошелёк" if key else "Бөлме ашу / Открыть комнату"
    history = ""
    if history_available and not key:
        history = (
            '<form method="post" action="/jury/start/history">'
            '<button class="with-history" type="submit">Тарихымен ашу / '
            "Открыть с историей</button></form>"
        )
        intro += (
            "<p>Дайын тарихта 40 оқу аударымы мен 10 іс бар. "
            "<span lang=ru>В комнате с историей уже есть 40 учебных переводов и 10 дел SOC."
            "</span></p>"
        )
    shared = ""
    if key:
        shared = (
            "<p>Қосымша рөлге кіру үшін сілтемені басқа браузер профилінде ашыңыз.</p>"
            "<p lang=ru>Чтобы войти под другой ролью, откройте ссылку в отдельном "
            "профиле браузера. По этой ссылке доступны учебные данные вашей комнаты.</p>"
            f'<p><a href="/jury/join/{key}">Бөлме сілтемесі / Ссылка на вашу комнату</a></p>'
        )
    if contact_invite:
        shared += (
            "<p>Сенімді адамның шақыруын басқа браузерге көшіріңіз. "
            "Скопируйте приглашение в отдельный профиль браузера. В нём близкий "
            "увидит сумму, получателя и срок только своих учебных запросов.</p>"
            f'<a href="/jury/invite-contact/{contact_invite}">'
            "Сенімді адамның шақыруы / Приглашение доверенному лицу</a>"
        )
    return HTMLResponse(
        _HEAD + title + message + intro + '<div class="room-actions">'
        '<form method="post" action="/jury/start">'
        f'<button type="submit">{submit}</button></form>'
        + history
        + "</div>"
        + _PUBLIC_LOGINS
        + shared
        + "</main></body></html>",
        status_code=status,
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "same-origin",
            "X-Robots-Tag": "noindex, nofollow",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; "
            "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        },
    )


def redirect(path: str) -> RedirectResponse:
    return RedirectResponse(
        path,
        status_code=303,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


def same_origin(request: Request) -> bool:
    local = request.url.hostname in ("localhost", "127.0.0.1") and request.url.scheme == "http"
    scheme = "http" if local else "https"
    return request.headers.get("origin") == f"{scheme}://{request.url.netloc}"


def enter(request: Request, key: str) -> Response:
    response = redirect("/wallet/")
    if request.cookies.get(ROOM_COOKIE) != key:
        response.delete_cookie(WEB_COOKIE, secure=True, httponly=True, samesite="strict")
    response.set_cookie(ROOM_COOKIE, key, secure=True, httponly=True, samesite="lax")
    return response


def create_jury_app(
    factory: Factory,
    *,
    history_factory: Factory | None = None,
    ready: Callable[[], Awaitable[bool]] | None = None,
) -> FastAPI:
    pool = RoomPool(factory)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        done = asyncio.Event()

        async def sweep() -> None:
            while not done.is_set():
                try:
                    await asyncio.wait_for(done.wait(), 60)
                except TimeoutError:
                    await pool.reap()

        sweeper = asyncio.create_task(sweep())
        try:
            yield
        finally:
            # Uvicorn drains requests before lifespan shutdown.
            done.set()
            await sweeper
            await pool.reap(shutdown=True)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.api_route("/health", methods=["GET", "HEAD"])
    async def health() -> JSONResponse:
        try:
            ok = ready is None or await asyncio.wait_for(ready(), 2)
        except Exception:
            ok = False
        return JSONResponse(
            {"status": "ok" if ok else "unavailable", "mode": "synthetic-jury"},
            status_code=200 if ok else 503,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/")
    @app.get("/jury")
    @app.get("/jury/")
    async def home(request: Request) -> HTMLResponse:
        key = request.cookies.get(ROOM_COOKIE)
        with pool.borrow(key) as room:
            return landing(
                key=key if room else None,
                contact_invite=room.contact_invite if room else None,
                history_available=history_factory is not None,
            )

    async def start_room(request: Request, room_factory: Factory) -> Response:
        if not same_origin(request):
            return JSONResponse(
                {"detail": "same_origin_required"},
                status_code=403,
                headers={"Cache-Control": "no-store"},
            )
        current = request.cookies.get(ROOM_COOKIE)
        with pool.borrow(current) as room:
            if room and current:
                return enter(request, current)
        try:
            key = await pool.create(factory=room_factory)
        except Exception:
            log.error("Jury wallet startup failed")
            key = None
        if not key:
            response = landing(
                message="<p>Бөлме әзірге қолжетімсіз. / "
                "Комната пока недоступна. Попробуйте позже.</p>",
                status=503,
                history_available=history_factory is not None,
            )
            response.headers["Retry-After"] = "60"
            return response
        return enter(request, key)

    @app.post("/jury/start")
    async def start(request: Request) -> Response:
        return await start_room(request, factory)

    if history_factory is not None:

        @app.post("/jury/start/history")
        async def start_history(request: Request) -> Response:
            return await start_room(request, history_factory)

    @app.get("/jury/join/{key}")
    async def join(key: str, request: Request) -> Response:
        with pool.borrow(key) as room:
            if room is None:
                return landing(
                    message="<p>Бөлме жабылды немесе сілтеме қате. / "
                    "Комната закрыта или ссылка неверна.</p>",
                    status=404,
                    history_available=history_factory is not None,
                )
            return enter(request, key)

    @app.get("/jury/invite-contact/{invite}")
    async def join_contact(invite: str, request: Request) -> Response:
        if request.cookies.get(ROOM_COOKIE) or request.cookies.get(WEB_COOKIE):
            return landing(
                message="<p>Жеке браузер профилін ашыңыз. / "
                "Откройте приглашение в отдельном профиле браузера.</p>",
                status=409,
            )
        for key, candidate in pool.rooms.items():
            if candidate.contact_invite == invite:
                with pool.borrow(key) as room:
                    if room:
                        response = redirect(CONTACT_INBOX)
                        response.set_cookie(
                            CONTACT_COOKIE,
                            room.contact_session,
                            secure=True,
                            httponly=True,
                            samesite="strict",
                        )
                        return response
        return landing(
            message="<p>Шақырудың мерзімі өтті. / Срок приглашения истёк.</p>", status=404
        )

    async def dispatch(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        path = normpath(scope["path"])
        request = Request(scope)
        if path == CONTACT_INBOX or path.startswith(CONTACT_INBOX + "/"):
            session = request.cookies.get(CONTACT_COOKIE)
            key = next((k for k, r in pool.rooms.items() if r.contact_session == session), None)
            with pool.borrow(key) as room:
                if (
                    room is None
                    or request.cookies.get(ROOM_COOKIE)
                    or request.cookies.get(WEB_COOKIE)
                ):
                    await JSONResponse({"detail": "contact_invitation_required"}, 403)(
                        scope, receive, send
                    )
                elif request.method == "POST" and not same_origin(request):
                    await JSONResponse({"detail": "same_origin_required"}, 403)(
                        scope, receive, send
                    )
                else:
                    contact_scope = {
                        **scope,
                        "state": {**scope.get("state", {}), "jury_contact": True},
                    }
                    await room.app(contact_scope, receive, send)
            return
        is_wallet = path == "/wallet" or path.startswith("/wallet/")
        is_api = path == "/mobile/v1" or path.startswith("/mobile/v1/")
        if (
            not (is_wallet or is_api)
            or path == "/wallet/install"
            or path.startswith("/wallet/install/")
        ):
            await JSONResponse({"detail": "not_found"}, status_code=404)(scope, receive, send)
            return
        with pool.borrow(request.cookies.get(ROOM_COOKIE)) as room:
            if room:
                await room.app(scope, receive, send)
                return
        response: Response = (
            redirect("/jury")
            if is_wallet
            else JSONResponse(
                {"detail": "jury_room_required"},
                status_code=401,
                headers={"Cache-Control": "no-store"},
            )
        )
        await response(scope, receive, send)

    app.mount("/", dispatch)
    return app
