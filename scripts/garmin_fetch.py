"""Garmin Connect -> days for the diary (JSON list), applied later by scripts/garmin-apply.mjs.

Uses the unofficial garminconnect library (pip install garminconnect==0.3.17). Logs in with the
token file made by scripts/garmin_login.py; no password here. When Garmin refreshes the token,
the library writes the new one back to the same file, and the workflow saves it as a secret.

Every value is read defensively: Garmin's JSON isn't documented, so a missing field means
"no data" and never stops the run.

Usage: python scripts/garmin_fetch.py --tokens DIR [--days 3] [--out days.json]
"""
import argparse
import datetime as dt
import json
import sys
from zoneinfo import ZoneInfo

from garminconnect import Garmin

TZ = ZoneInfo("Europe/Warsaw")


def dig(obj, *path):
    for key in path:
        if isinstance(obj, dict):
            obj = obj.get(key)
        elif isinstance(obj, list) and isinstance(key, int) and -len(obj) <= key < len(obj):
            obj = obj[key]
        else:
            return None
    return obj


def first(*values):
    return next((v for v in values if v is not None), None)


def number(value, lo=None, hi=None):
    """A real measurement or None. Garmin uses -1 / -2 for 'not enough data'."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value < 0 or (lo is not None and value < lo) or (hi is not None and value > hi):
        return None
    return value


class Fetcher:
    def __init__(self, api):
        self.api = api
        self.problems = []

    def call(self, label, fn, *args):
        try:
            return fn(*args)
        except Exception as err:  # one failed call must not lose the other numbers
            self.problems.append(f"{label}: {type(err).__name__}")
            return None

    def day(self, day):
        out = {"date": day}

        stats = self.call(f"{day} podsumowanie", self.api.get_stats, day) or {}
        out["steps"] = number(stats.get("totalSteps"))
        out["restingHr"] = number(stats.get("restingHeartRate"), 20, 250)
        out["stress"] = number(stats.get("averageStressLevel"), 0, 100)
        out["bodyBatteryHigh"] = number(stats.get("bodyBatteryHighestValue"), 0, 100)
        out["bodyBatteryLow"] = number(stats.get("bodyBatteryLowestValue"), 0, 100)

        # The night that ended on the morning of `day`, like a sleep entry typed in the app.
        sleep = self.call(f"{day} sen", self.api.get_sleep_data, day) or {}
        dto = sleep.get("dailySleepDTO") or {}
        seconds = number(dto.get("sleepTimeSeconds"))
        out["sleep"] = round(seconds / 3600, 2) if seconds else None
        out["sleepScore"] = number(dig(dto, "sleepScores", "overall", "value"), 0, 100)
        if out["restingHr"] is None:
            out["restingHr"] = number(sleep.get("restingHeartRate"), 20, 250)

        hrv = self.call(f"{day} HRV", self.api.get_hrv_data, day) or {}
        summary = hrv.get("hrvSummary") or {}
        out["hrv"] = number(first(summary.get("lastNightAvg"), sleep.get("avgOvernightHrv")), 1, 300)
        status = first(summary.get("status"), sleep.get("hrvStatus"))
        out["hrvStatus"] = status.lower() if isinstance(status, str) and status else None

        metrics = self.call(f"{day} VO2max", self.api.get_max_metrics, day)
        items = metrics if isinstance(metrics, list) else [metrics] if isinstance(metrics, dict) else []
        vo2 = None
        for item in items:
            vo2 = first(
                number(dig(item, "generic", "vo2MaxPreciseValue"), 10, 100),
                number(dig(item, "generic", "vo2MaxValue"), 10, 100),
                number(dig(item, "cycling", "vo2MaxPreciseValue"), 10, 100),
                number(dig(item, "cycling", "vo2MaxValue"), 10, 100),
                vo2,
            )
        out["vo2max"] = round(vo2, 1) if vo2 is not None else None

        weigh = self.call(f"{day} waga", self.api.get_daily_weigh_ins, day) or {}
        grams = first(
            *(number(w.get("weight")) for w in (weigh.get("dateWeightList") or []) if isinstance(w, dict)),
            number(dig(weigh, "totalAverage", "weight")),
        )
        out["weight"] = round(grams / 1000, 2) if grams else None  # Garmin stores grams

        return {k: v for k, v in out.items() if v is not None}

    def activities(self, start, end):
        """{date: [activity, ...]} for every day in the range, or None when the call failed."""
        found = self.call("aktywności", self.api.get_activities_by_date, start, end)
        if found is None:
            return None
        by_day = {}
        for a in found if isinstance(found, list) else []:
            day = str(a.get("startTimeLocal") or "")[:10]
            if not day:
                continue
            distance = number(a.get("distance"))
            duration = number(first(a.get("movingDuration"), a.get("duration")))
            by_day.setdefault(day, []).append({
                "type": dig(a, "activityType", "typeKey") or "",
                "name": a.get("activityName") or "",
                "km": round(distance / 1000, 2) if distance else None,
                "min": round(duration / 60) if duration else None,
            })
        return by_day


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tokens", required=True, help="folder z garmin_tokens.json")
    parser.add_argument("--days", type=int, default=3, help="ile ostatnich dni, razem z dzisiaj")
    parser.add_argument("--out", default="-")
    args = parser.parse_args()

    api = Garmin()
    try:
        api.login(args.tokens)
    except Exception as err:
        print(f"::error::Logowanie do Garmina nie działa ({type(err).__name__}). "
              "Uruchom jeszcze raz scripts/garmin_login.py i podmień sekret GARMIN_TOKENS.", file=sys.stderr)
        return 2

    today = dt.datetime.now(TZ).date()
    dates = [(today - dt.timedelta(days=i)).isoformat() for i in range(max(1, args.days) - 1, -1, -1)]
    fetcher = Fetcher(api)
    days = [fetcher.day(d) for d in dates]
    acts = fetcher.activities(dates[0], dates[-1])
    if acts is not None:
        for d in days:
            d["activities"] = acts.get(d["date"], [])

    for d in days:
        got = sorted(k for k in d if k != "date")
        print(f"{d['date']}: {', '.join(got) if got else 'brak danych'}", file=sys.stderr)
    for p in fetcher.problems:
        print(f"::warning::Garmin, nie udało się: {p}", file=sys.stderr)

    text = json.dumps(days, ensure_ascii=False, indent=1)
    if args.out == "-":
        print(text)
    else:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
