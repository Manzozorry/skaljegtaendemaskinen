"""Laver delingsbillede og ikoner til site/ ud fra scripts/deling.html.

Kræver Python med Playwright og Chromium:
    pip install playwright && playwright install chromium
    python3 scripts/lav_billeder.py
"""
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROD = Path(__file__).resolve().parent.parent
PORT = 8799

IKON = """<!doctype html><html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="{s}" height="{s}" style="display:block">
<rect width="16" height="16" fill="#FFD400"/>
<path d="M9.5 1.5L3.5 9.2h4L6.6 14.5l6-7.7H8.6l.9-5.3z" fill="#0D1B24"/></svg></body></html>"""

server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", str(ROD)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        side = b.new_page(viewport={"width": 1200, "height": 630})
        side.goto(f"http://localhost:{PORT}/scripts/deling.html")
        side.evaluate("document.fonts.ready")
        side.wait_for_timeout(300)
        side.screenshot(path=str(ROD / "site/deling.png"))
        for navn, s in (("apple-touch-icon.png", 180), ("favicon-32.png", 32)):
            ikon = b.new_page(viewport={"width": s, "height": s})
            ikon.set_content(IKON.format(s=s))
            ikon.screenshot(path=str(ROD / "site" / navn))
        b.close()
finally:
    server.terminate()
print("Lavet: site/deling.png, site/apple-touch-icon.png, site/favicon-32.png")
