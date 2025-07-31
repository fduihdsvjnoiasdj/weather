"""Skript pro stažení dat z Open‑Meteo pomocí modelů ICON.
Vygeneruje 48 h předpovědi z ICON‑D2 a následných 72 h z ICON‑EU.
"""
import json
from datetime import datetime, timedelta
from typing import Any, Dict

import requests


def fetch_icon_d2(lat: float, lon: float) -> Dict[str, Any]:
    """Fetch 48 hour forecast from ICON-D2 model."""
    now = datetime.utcnow()
    start = now.strftime("%Y-%m-%d")
    end = (now + timedelta(hours=48)).strftime("%Y-%m-%d")
    url = (
        "https://api.open-meteo.com/v1/dwd-icon"
        f"?latitude={lat}&longitude={lon}&hourly=temperature_2m,precipitation&"
        f"forecast_model=icon_d2&start_date={start}&end_date={end}"
    )
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_icon_eu(lat: float, lon: float, start_iso: str) -> Dict[str, Any]:
    """Fetch next 72 hour forecast from ICON-EU model starting after start_iso."""
    start = datetime.fromisoformat(start_iso)
    end = start + timedelta(hours=72)
    url = (
        "https://api.open-meteo.com/v1/dwd-icon"
        f"?latitude={lat}&longitude={lon}&hourly=temperature_2m,precipitation&"
        f"forecast_model=icon_eu&start_date={start.strftime('%Y-%m-%d')}&"
        f"end_date={end.strftime('%Y-%m-%d')}"
    )
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


if __name__ == "__main__":
    LATITUDE = 50.0755
    LONGITUDE = 14.4378
    d2 = fetch_icon_d2(LATITUDE, LONGITUDE)
    end_iso = d2["hourly"]["time"][-1]
    eu = fetch_icon_eu(LATITUDE, LONGITUDE, end_iso)
    with open("forecast_d2.json", "w", encoding="utf-8") as f:
        json.dump(d2, f, indent=2)
    with open("forecast_eu.json", "w", encoding="utf-8") as f:
        json.dump(eu, f, indent=2)
    print("Data ulozena do forecast_d2.json a forecast_eu.json")
