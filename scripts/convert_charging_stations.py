# Wandelt das offizielle Ladesaechlenregister der Bundesnetzagentur (CSV)
# in die fuer die App benoetigte data/charging_stations.json um.
#
# CSV-Format: UTF-8 mit BOM, Semikolon-getrennt, 10 Zeilen Praeambel,
# Header = Zeile 11, Daten ab Zeile 12.
#
# Aufruf:  python scripts/convert_charging_stations.py [pfad-zur-csv]
# Ohne Pfad wird die Datei einmalig von der BNetzA-Seite geladen
# und im System-Temp-Verzeichnis gecacht.
import csv
import json
import os
import sys
import urllib.request
from pathlib import Path

CSV_URL = (
    "https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/"
    "ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-09-01.csv"
)
PREAMBLE_ROWS = 10
STATUS_FILTER = "In Betrieb"

# Kurzform der Steckertypen; Sortierung nach Prioritaet (DC zuerst).
CONNECTOR_SHORT = {
    "DC Fahrzeugkupplung Typ Combo 2 (CCS)": "CCS",
    "DC CHAdeMO": "CHAdeMO",
    "DC Tesla Fahrzeugkupplung (Typ 2)": "Tesla",
    "DC Megawatt Charging System (MCS)": "MCS",
    "AC Typ 2 Steckdose": "Typ 2",
    "AC Typ 2 Fahrzeugkupplung": "Typ 2",
    "AC Typ 1 Steckdose": "Typ 1",
    "AC CEE 3-polig": "CEE",
    "AC CEE 5-polig": "CEE",
    "AC Schuko": "Schuko",
}
CONNECTOR_ORDER = ["CCS", "CHAdeMO", "Tesla", "MCS", "Typ 2", "Typ 1", "CEE", "Schuko"]

SOCKET_COUNT = 6  # Steckertypen1..6 / Nennleistung Stecker1..6

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "charging_stations.json"


def resolve_csv_path():
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    cache = Path(os.environ.get("TEMP", "/tmp")) / "Ladesaeulenregister_BNetzA_2026-09-01.csv"
    if not cache.exists():
        print(f"Lade {CSV_URL} ...")
        urllib.request.urlretrieve(CSV_URL, cache)
    return cache


def to_number(raw):
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return float(raw.replace(",", "."))
    except ValueError:
        return None


def clean_number(value):
    if value is None:
        return None
    return int(value) if value == int(value) else value


def compose_address(row, columns):
    # "Strasse Hausnr., PLZ Ort" - leere Teile weglassen, keine doppelten
    # Leerzeichen oder Kommas.
    street = " ".join(
        part.strip() for part in (row[columns["Straße"]], row[columns["Hausnummer"]])
        if part and part.strip()
    )
    city = " ".join(
        part.strip() for part in (row[columns["Postleitzahl"]], row[columns["Ort"]])
        if part and part.strip()
    )
    return ", ".join(part for part in (street, city) if part)


def connector_short(raw_values, unknown):
    shorts = []
    for value in raw_values:
        value = (value or "").strip()
        if not value:
            continue
        short = CONNECTOR_SHORT.get(value)
        if short is None:
            unknown.add(value)
            continue
        if short not in shorts:
            shorts.append(short)
    # Dedupe + Prioritaet (DC zuerst); unbekannte Typen haengen alphabetisch hinten an.
    shorts.sort(key=lambda s: CONNECTOR_ORDER.index(s) if s in CONNECTOR_ORDER else len(CONNECTOR_ORDER))
    return "/".join(shorts)


def convert(csv_path):
    stations = []
    skipped_status = 0
    skipped_coords = 0
    unknown = set()
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f, delimiter=";")
        for _ in range(PREAMBLE_ROWS):
            next(reader)
        header = next(reader)
        columns = {name.strip(): index for index, name in enumerate(header)}
        for row in reader:
            if len(row) < len(header):
                continue
            if row[columns["Status"]].strip() != STATUS_FILTER:
                skipped_status += 1
                continue
            lat = to_number(row[columns["Breitengrad"]])
            lon = to_number(row[columns["Längengrad"]])
            if lat is None or lon is None:
                skipped_coords += 1
                continue
            # Max. Steckerleistung vorziehen, Fallback: Nennleistung der Einrichtung.
            socket_powers = [
                to_number(row[columns[f"Nennleistung Stecker{i}"]])
                for i in range(1, SOCKET_COUNT + 1)
            ]
            socket_powers = [p for p in socket_powers if p is not None]
            power_kw = max(socket_powers) if socket_powers else to_number(
                row[columns["Nennleistung Ladeeinrichtung [kW]"]]
            )
            connectors = []
            for i in range(1, SOCKET_COUNT + 1):
                connectors.extend(row[columns[f"Steckertypen{i}"]].split(";"))
            stations.append({
                "id": row[columns["Ladeeinrichtungs-ID"]].strip(),
                "name": row[columns["Anzeigename (Karte)"]].strip()
                        or row[columns["Betreiber"]].strip(),
                "address": compose_address(row, columns),
                "lat": lat,
                "lon": lon,
                "power_kw": clean_number(power_kw),
                "connector_type": connector_short(connectors, unknown),
                "points": clean_number(to_number(row[columns["Anzahl Ladepunkte"]])),
                "operator": row[columns["Betreiber"]].strip(),
            })
    print(f"Status != '{STATUS_FILTER}' uebersprungen: {skipped_status}")
    print(f"Zeilen ohne gueltige Koordinaten uebersprungen: {skipped_coords}")
    if unknown:
        print(f"WARNUNG - unbekannte Steckertypen (uebersprungen): {sorted(unknown)}")
    return stations


def main():
    csv_path = resolve_csv_path()
    print(f"Verarbeite: {csv_path}")
    stations = convert(csv_path)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"stations": stations}, f, separators=(",", ":"), ensure_ascii=False)
    size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
    print(f"OK: {len(stations)} Ladeeinrichtungen -> {OUTPUT_PATH} ({size_mb:.1f} MB)")
    for station in stations[:5]:
        print("Beispiel:", json.dumps(station, ensure_ascii=False))


if __name__ == "__main__":
    main()
