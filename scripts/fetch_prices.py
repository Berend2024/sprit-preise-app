import requests, json, os
from datetime import datetime, timezone

API_KEY = os.environ["TANKERKOENIG_KEY"]

# Mehrere Städte abfragen, um bundesweite Abdeckung zu haben
LOCATIONS = [
    {"name": "Berlin", "lat": 52.52, "lng": 13.405},
    {"name": "Hamburg", "lat": 53.5511, "lng": 9.9937},
    {"name": "München", "lat": 48.1351, "lng": 11.5820},
    {"name": "Köln", "lat": 50.9375, "lng": 6.9603},
    {"name": "Frankfurt", "lat": 50.1109, "lng": 8.6821},
    # Region um Berumbur/Emden (entspricht config.js: defaultLat/defaultLng)
    {"name": "Emden", "lat": 53.3631, "lng": 7.2049},
    {"name": "Norden", "lat": 53.5953, "lng": 7.2078},
    {"name": "Aurich", "lat": 53.4671, "lng": 7.5544},
    {"name": "Oldenburg", "lat": 53.1439, "lng": 8.2146},
    {"name": "Bremen", "lat": 53.0793, "lng": 8.8017},
]

RADIUS = 15  # km pro Standort

all_stations = {}

for loc in LOCATIONS:
    url = (
        f"https://creativecommons.tankerkoenig.de/json/list.php"
        f"?lat={loc['lat']}&lng={loc['lng']}&rad={RADIUS}&sort=dist&type=all&apikey={API_KEY}"
    )
    resp = requests.get(url).json()

    if resp.get("ok"):
        for station in resp.get("stations", []):
            # Duplikate über ID vermeiden
            all_stations[station["id"]] = station

print(f"{len(all_stations)} Tankstellen insgesamt gefunden.")

output = {
    "stations": list(all_stations.values()),
    # Zeitstempel fuer die Diagnoseseite (Alter der Daten sichtbar machen)
    "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
}

os.makedirs("data", exist_ok=True)
with open("data/prices.json", "w", encoding="utf-8") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)