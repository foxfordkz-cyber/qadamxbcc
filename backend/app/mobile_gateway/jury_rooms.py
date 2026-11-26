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
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from app.mobile_gateway.app import WEB_ASSETS, WEB_COOKIE

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
    trial_forecast: bytes | None = None
    contact_invite: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    interview_route: str = field(default_factory=lambda: secrets.token_urlsafe(18))
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


def bilingual(kk: str, ru: str) -> str:
    return f'<span lang="kk">{kk}</span><span lang="ru">{ru}</span>'


_PUBLIC_ROLES = (
    ("Клиент", "Клиент", "client_demo", "SaqBol-Client-2026"),
    ("SOC қызметкері", "Сотрудник SOC", "admin_demo", "SaqBol-Officer-2026"),
    ("Платформа әкімшісі", "Администратор платформы", "platform_demo", "SaqBol-Platform-2026"),
)
_PUBLIC_LOGINS = (
    '<details id="accounts"><summary>'
    + bilingual("Оқу тіркелгілерінің кіру деректері", "Данные учебных аккаунтов")
    + "</summary><dl>"
    + "".join(
        f'<div data-jury-account="{login}"><dt>{bilingual(kk, ru)}</dt>'
        f"<dd><small>Логин</small><code>{login}</code></dd>"
        f"<dd><small>{bilingual('Құпиясөз', 'Пароль')}</small><code>{password}</code></dd></div>"
        for kk, ru, login, password in _PUBLIC_ROLES
    )
    + "</dl></details>"
)


_HEAD = """<!doctype html><html lang="kk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f5f5f1">
<title>Saq Bol × BCC · Қазылар алқасы / Жюри</title>
<link rel="icon" href="/jury/visuals/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="/jury/visuals/fonts/onest.css">
<link rel="stylesheet" href="/jury/visuals/rooms.css">
<script src="/jury/visuals/room-language.js" defer></script></head><body>
<header class="mast"><b>Saq Bol <span>× BCC</span></b>
<button type="button" id="room-language" hidden>РУС</button></header><main>
<div class="room-art"><picture>
<source media="(max-width: 680px)" srcset="/jury/visuals/alatau-640.webp">
<img alt="" src="/jury/visuals/alatau-764.webp" fetchpriority="high"></picture>
<div class="room-caption"><span lang="kk">Тянь-Шань<br><small>Қазақстан</small></span>
<span lang="ru">Тянь-Шань<br><small>Казахстан</small></span></div></div>
<section class="room-content">"""


def landing(
    *,
    key: str | None = None,
    contact_invite: str | None = None,
    history_available: bool = False,
    message: str = "",
    status: int = 200,
) -> HTMLResponse:
    # All markup consists of fixed bilingual copy and a server-generated URL-safe key.
    title = "<h1>" + bilingual("Қазылар әмияны", "Кошелёк жюри") + "</h1>"
    intro = (
        "<p>"
        + bilingual(
            "Жеке оқу бөлмесін ашыңыз. Оған өз логиніңізбен кіре аласыз.",
            "Откройте свою учебную комнату и войдите со своим логином.",
        )
        + "</p>"
    )
    submit = (
        bilingual("Әмиянға оралу", "Вернуться в кошелёк")
        if key
        else bilingual("Бос бөлме ашу", "Открыть пустую комнату")
    )
    history = ""
    if history_available and not key:
        history = (
            '<form method="post" action="/jury/start/history">'
            '<button class="with-history" type="submit">'
            + bilingual("Тарихымен ашу", "Открыть с историей")
            + "</button></form>"
        )
        intro += (
            '<p class="room-sample">'
            + bilingual("40 оқу аударымы · 10 іс", "40 учебных переводов · 10 дел SOC")
            + "</p>"
        )
    shared = ""
    if key:
        shared = (
            "<p>"
            + bilingual(
                "Басқа рөлмен кіру үшін бөлменің сілтемесін бөлек браузер профилінде ашыңыз.",
                "Для другой роли откройте ссылку своей комнаты в отдельном профиле браузера.",
            )
            + f'</p><a href="/jury/join/{key}">'
            + bilingual("Бөлме сілтемесі", "Ссылка на вашу комнату")
            + "</a>"
        )
    if contact_invite:
        shared += (
            f'<p><a href="/jury/invite-contact/{contact_invite}">'
            + bilingual("Сенімді адамға шақыру", "Приглашение доверенному лицу")
            + "</a></p>"
        )
    return HTMLResponse(
        _HEAD
        + title
        + message
        + intro
        + '<div class="room-actions">'
        + history
        + '<form method="post" action="/jury/start">'
        f'<button type="submit">{submit}</button></form>'
        + "</div>"
        + '<p><a href="/jury/results">Неге тоқтады? · Почему остановлен перевод?</a></p>'
        + '<p><a href="/jury/trial">'
        + bilingual("Өз CSV файлыңызды тексеру", "Проверить свой CSV")
        + "</a></p>"
        + _PUBLIC_LOGINS
        + shared
        + '<p class="room-expiry">'
        + bilingual(
            "Бөлмеге 30 минут бойы ешкім кірмесе, деректері өшіріледі.",
            "После 30 минут бездействия данные комнаты удаляются.",
        )
        + '</p><a href="https://saq-bol-mobile.onrender.com/wallet/">'
        + bilingual("Команда әмиянына кіру", "Вход в кошелёк команды")
        + "</a></section></main></body></html>",
        status_code=status,
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "same-origin",
            "X-Robots-Tag": "noindex, nofollow",
            "Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; "
            "img-src 'self'; font-src 'self'; "
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


def enter(request: Request, key: str, destination: str = "/wallet/") -> Response:
    response = redirect(destination)
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
    from app.mobile_gateway.jury_results import router
    from app.mobile_gateway.jury_trial import install_trial

    app.include_router(router)
    install_trial(app, pool)
    app.mount("/jury/visuals", StaticFiles(directory=WEB_ASSETS / "media", check_dir=False))

    @app.get("/jury/interview/{asset}")
    async def interview_asset(asset: str) -> Response:
        if asset not in {"counterparty.html", "counterparty.mjs", "mobile.css"}:
            return Response(status_code=404)
        file = WEB_ASSETS / asset
        if not file.is_file():
            return Response(status_code=404)
        return FileResponse(
            file,
            media_type="text/javascript" if asset.endswith(".mjs") else None,
            headers={"Referrer-Policy": "no-referrer"},
        )

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

    async def start_room(
        request: Request, room_factory: Factory, destination: str = "/wallet/"
    ) -> Response:
        if not same_origin(request):
            return JSONResponse(
                {"detail": "same_origin_required"},
                status_code=403,
                headers={"Cache-Control": "no-store"},
            )
        current = request.cookies.get(ROOM_COOKIE)
        with pool.borrow(current) as room:
            if room and current:
                return enter(request, current, destination)
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
        return enter(request, key, destination)

    @app.post("/jury/start/trial")
    async def start_trial(request: Request) -> Response:
        return await start_room(request, factory, "/jury/trial")

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
        room_key = request.cookies.get(ROOM_COOKIE)
        selector = request.headers.get("x-saq-interview")
        if selector is not None:
            # This reference routes a single reply. It cannot open a wallet or create a session.
            if (
                path != "/mobile/v1/wallet/jury-interview"
                or request.method != "POST"
                or not same_origin(request)
            ):
                await JSONResponse({"detail": "invalid_interview"}, 403)(scope, receive, send)
                return
            room_key = next(
                (
                    key
                    for key, candidate in pool.rooms.items()
                    if candidate.interview_route == selector
                ),
                None,
            )
        with pool.borrow(room_key) as room:
            if room:
                if path.endswith("/jury-invite") and request.method == "POST":
                    scope = {
                        **scope,
                        "state": {
                            **scope.get("state", {}),
                            "jury_interview_route": room.interview_route,
                        },
                    }
                await room.app(scope, receive, send)
                return
        if selector is not None:
            await JSONResponse({"detail": "invalid_interview"}, 403)(scope, receive, send)
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
