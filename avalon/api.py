from __future__ import annotations

import asyncio
from typing import Dict, Optional

from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .bot.manager import BotManager
from .config import SETTINGS
from .game import GameEngine
from .models import ActionRequest, CreateGameRequest, PlayerAddRequest, PlayerUpdateRequest
from .storage import EventStore
from .tunnel import TunnelManager


store = EventStore(SETTINGS.database_path)
engine = GameEngine(store)
bot_manager = BotManager(engine)
tunnel_manager = TunnelManager(f"http://localhost:{SETTINGS.port}")

app = FastAPI(title="Avalon")
WEB_DIR = Path(__file__).parent / "web"
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "control.html")


@app.get("/control")
async def control() -> FileResponse:
    return FileResponse(WEB_DIR / "control.html")


@app.get("/play")
async def play() -> FileResponse:
    return FileResponse(WEB_DIR / "player.html")


@app.post("/game/new")
async def new_game(req: CreateGameRequest) -> Dict:
    await engine.create_game(req)
    return {"state": engine.public_state()}


@app.post("/game/start")
async def start_game() -> Dict:
    await engine.start_game()
    await bot_manager.maybe_act()
    return {"state": engine.public_state()}


@app.post("/game/action")
async def action(req: ActionRequest) -> Dict:
    await engine.apply_action(req.player_id, req.action_type, req.payload)
    await bot_manager.maybe_act()
    return {"state": engine.public_state()}


@app.get("/game/state")
async def get_state(player_id: Optional[str] = None) -> Dict:
    if not engine.has_state():
        return {"state": None}
    if player_id:
        return engine.private_state_for(player_id)
    return {"state": engine.public_state()}


@app.get("/game/events")
async def get_events() -> Dict:
    return {"events": store.list_events()}


@app.post("/game/players/add")
async def add_player(req: PlayerAddRequest) -> Dict:
    state = await engine.add_player(req.is_bot, req.name)
    return {"state": engine.public_state()}


@app.post("/game/players/remove")
async def remove_player(req: PlayerUpdateRequest) -> Dict:
    state = await engine.remove_player(req.player_id)
    return {"state": engine.public_state()}


@app.post("/game/players/rename")
async def rename_player(req: PlayerUpdateRequest) -> Dict:
    if not req.name:
        return JSONResponse(status_code=400, content={"error": "Name required"})
    state = await engine.rename_player(req.player_id, req.name)
    return {"state": engine.public_state()}


@app.post("/game/players/reset")
async def reset_player(req: PlayerUpdateRequest) -> Dict:
    state = await engine.reset_player(req.player_id)
    return {"state": engine.public_state()}


@app.post("/game/players/claim")
async def claim_player(req: PlayerUpdateRequest) -> Dict:
    if not req.name:
        return JSONResponse(status_code=400, content={"error": "Name required"})
    state = await engine.claim_player(req.player_id, req.name)
    return {"state": engine.public_state()}


@app.post("/tunnel/start")
async def start_tunnel() -> Dict:
    status = tunnel_manager.start()
    return {"tunnel": status.__dict__}


@app.get("/tunnel/status")
async def tunnel_status() -> Dict:
    status = tunnel_manager.status()
    return {"tunnel": status.__dict__}


@app.post("/tunnel/stop")
async def stop_tunnel() -> Dict:
    status = tunnel_manager.stop()
    return {"tunnel": status.__dict__}


@app.websocket("/game/stream")
async def stream_state(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = None if not engine.has_state() else engine.public_state().model_dump()
            await websocket.send_json({"type": "state", "payload": payload})
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        return


@app.exception_handler(ValueError)
async def value_error_handler(_, exc: ValueError):
    return JSONResponse(status_code=400, content={"error": str(exc)})
