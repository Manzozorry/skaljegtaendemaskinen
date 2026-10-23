"""Laver testdata over skiftet fra sommertid til vintertid (25. okt. 2026),
hvor døgnet har 25 timer og kl. 02:00-03:00 kommer to gange.

    python3 test/lav_sommertid.py
    node scripts/update.mjs --fixtures test/fixtures-sommertid --nu 2026-10-24T19:30:00Z
"""
import json
import math
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROD = Path(__file__).resolve().parent
UD = ROD / "fixtures-sommertid"
UD.mkdir(exist_ok=True)
DK = ZoneInfo("Europe/Copenhagen")

# Lørdag 24. okt. kl. 00 dansk tid (UTC+2) til tirsdag 27. okt. kl. 00 (UTC+1)
start = datetime(2026, 10, 23, 22, 0, tzinfo=timezone.utc)
slut = datetime(2026, 10, 26, 23, 0, tzinfo=timezone.utc)
profil = [520, 470, 430, 400, 420, 520, 900, 1250, 1150, 980, 820, 700,
          640, 600, 640, 760, 1050, 1450, 1600, 1500, 1200, 950, 780, 650]
rec = []
t = start
while t < slut:
    lokal = t.astimezone(DK)
    for omr, faktor in (("DK1", 0.92), ("DK2", 1.0)):
        p = profil[lokal.hour] * faktor + [0, 25, -15, 10][lokal.minute // 15] + 40 * math.sin(lokal.day)
        # Den gentagne time (2. gang kl. 02) får en anden pris, så vi kan se forskel
        if lokal.hour == 2 and lokal.utcoffset() == timedelta(hours=1):
            p -= 120
        rec.append({"TimeUTC": t.strftime("%Y-%m-%dT%H:%M:%S"), "PriceArea": omr, "DayAheadPriceDKK": round(p, 2)})
    t += timedelta(minutes=15)
(UD / "spot.json").write_text(json.dumps({"records": rec}))

for navn in ("faste.json", "tarif-radius.json", "tarif-cerius.json", "tarif-n1.json"):
    shutil.copy(ROD / "fixtures" / navn, UD / navn)
print("ok", len(rec) // 2, "kvarterer pr. område")
