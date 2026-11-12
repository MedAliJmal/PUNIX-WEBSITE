#!/usr/bin/env python3
"""Collect verified Tunisian creator live snapshots and rank games conservatively."""
import json, os, statistics, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = json.loads((ROOT / "data/tunisian-streamers.json").read_text(encoding="utf-8"))
HISTORY_PATH = ROOT / "data/tunisian-trends.json"
NOW = datetime.now(timezone.utc)
NOW_ISO = NOW.isoformat(timespec="seconds").replace("+00:00", "Z")


def api(url, headers=None, data=None):
    body = urlencode(data).encode() if isinstance(data, dict) else data
    req = Request(url, headers=headers or {}, data=body)
    with urlopen(req, timeout=25) as response:
        return json.loads(response.read().decode("utf-8"))


def add_stream(rows, platform, channel, game, viewers, url):
    game = " ".join(str(game or "").strip().split())
    if not game or game.lower() in {"just chatting", "music", "sports", "talk shows & podcasts"}:
        return
    rows.append({
        "platform": platform, "channel": channel, "game": game,
        "viewers": max(0, int(viewers or 0)), "url": url
    })


def twitch_collect(rows):
    client_id, secret = os.getenv("TWITCH_CLIENT_ID"), os.getenv("TWITCH_CLIENT_SECRET")
    if not client_id or not secret:
        raise RuntimeError("Missing TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET repository secrets")
    token = api("https://id.twitch.tv/oauth2/token", data={
        "client_id": client_id, "client_secret": secret, "grant_type": "client_credentials"
    })["access_token"]
    headers = {"Client-Id": client_id, "Authorization": "Bearer " + token}
    for entry in REGISTRY.get("twitch", []):
        if not entry.get("country_verified") or not entry.get("login"):
            continue
        users = api("https://api.twitch.tv/helix/users?" + urlencode({"login": entry["login"]}), headers)
        if not users.get("data"):
            continue
        user = users["data"][0]
        streams = api("https://api.twitch.tv/helix/streams?" + urlencode({"user_id": user["id"], "first": 1}), headers)
        for stream in streams.get("data", []):
            add_stream(rows, "Twitch", user.get("display_name", entry["login"]),
                       stream.get("game_name"), stream.get("viewer_count"),
                       "https://twitch.tv/" + user.get("login", entry["login"]))


def kick_collect(rows):
    client_id, secret = os.getenv("KICK_CLIENT_ID"), os.getenv("KICK_CLIENT_SECRET")
    if not client_id or not secret:
        raise RuntimeError("Missing KICK_CLIENT_ID / KICK_CLIENT_SECRET repository secrets")
    token_data = api("https://id.kick.com/oauth/token", data={
        "client_id": client_id, "client_secret": secret, "grant_type": "client_credentials"
    })
    headers = {"Authorization": "Bearer " + token_data["access_token"]}
    for entry in REGISTRY.get("kick", []):
        if not entry.get("country_verified") or not entry.get("slug"):
            continue
        channels = api("https://api.kick.com/public/v1/channels?" + urlencode({"slug": entry["slug"]}), headers)
        channel_data = channels.get("data", [])
        if not channel_data:
            continue
        user_id = channel_data[0].get("broadcaster_user_id")
        if not user_id:
            continue
        streams = api("https://api.kick.com/public/v1/users/livestreams?" + urlencode({"user_id": user_id}), headers)
        for stream in streams.get("data", []):
            category = stream.get("category") or {}
            add_stream(rows, "Kick", entry["slug"], category.get("name") or stream.get("category_name"),
                       stream.get("viewer_count"), "https://kick.com/" + entry["slug"])


def youtube_collect(rows):
    key = os.getenv("YOUTUBE_API_KEY")
    if not key:
        raise RuntimeError("Missing YOUTUBE_API_KEY repository secret")
    aliases = {k.lower(): v for k, v in REGISTRY.get("game_aliases", {}).items()}
    for entry in REGISTRY.get("youtube", []):
        channel_id = entry.get("channel_id")
        if not channel_id:
            continue
        channel = api("https://www.googleapis.com/youtube/v3/channels?" + urlencode({
            "part": "snippet", "id": channel_id, "key": key
        }))
        items = channel.get("items", [])
        # YouTube exposes channel country. Do not count a channel unless it is explicitly Tunisia.
        if not items or items[0].get("snippet", {}).get("country") != "TN":
            continue
        live = api("https://www.googleapis.com/youtube/v3/search?" + urlencode({
            "part": "snippet", "channelId": channel_id, "eventType": "live",
            "type": "video", "videoCategoryId": "20", "maxResults": 10, "key": key
        }))
        video_ids = [x.get("id", {}).get("videoId") for x in live.get("items", []) if x.get("id", {}).get("videoId")]
        if not video_ids:
            continue
        details = api("https://www.googleapis.com/youtube/v3/videos?" + urlencode({
            "part": "snippet,liveStreamingDetails", "id": ",".join(video_ids), "key": key
        }))
        for video in details.get("items", []):
            title = video.get("snippet", {}).get("title", "")
            lowered = title.lower()
            game = next((name for alias, name in aliases.items() if alias in lowered), None)
            if not game:
                continue
            viewers = video.get("liveStreamingDetails", {}).get("concurrentViewers", 0)
            add_stream(rows, "YouTube", entry.get("label") or channel_id, game, viewers,
                       "https://youtube.com/watch?v=" + video["id"])


def aggregate(samples, start, end):
    selected = [s for s in samples if start <= datetime.fromisoformat(s["timestamp"].replace("Z", "+00:00")) < end]
    names = set()
    result = {}
    for sample in selected:
        for game, values in sample.get("games", {}).items():
            bucket = result.setdefault(game, {"viewers": [], "channels": set(), "platforms": set(), "sample_count": 0})
            bucket["viewers"].append(values.get("viewers", 0))
            bucket["channels"].update(values.get("channels", []))
            bucket["platforms"].update(values.get("platforms", []))
            bucket["sample_count"] += 1
    for game, bucket in result.items():
        # Include zero-activity intervals so a one-off spike cannot dominate a weekly average.
        avg_viewers = statistics.mean([
            s.get("games", {}).get(game, {}).get("viewers", 0) for s in selected
        ]) if selected else 0
        avg_channels = statistics.mean([
            len(s.get("games", {}).get(game, {}).get("channels", [])) for s in selected
        ]) if selected else 0
        bucket["avg_viewers"] = round(avg_viewers, 1)
        bucket["avg_channels"] = round(avg_channels, 2)
        bucket["unique_channels"] = len(bucket["channels"])
        bucket["platforms"] = sorted(bucket["platforms"])
        bucket["score"] = round(avg_viewers + 75 * avg_channels, 2)
        del bucket["viewers"], bucket["channels"]
    return result, len(selected)


def main():
    history = {"version": 1, "samples": [], "current": None, "state": {"featured_game": None, "challenger": None, "challenger_streak": 0}}
    if HISTORY_PATH.exists():
        try:
            history.update(json.loads(HISTORY_PATH.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass

    streams = []
    # Fail closed: a missing platform credential must not create a misleading partial all-platform ranking.
    twitch_collect(streams)
    kick_collect(streams)
    youtube_collect(streams)

    games = {}
    for row in streams:
        bucket = games.setdefault(row["game"], {"viewers": 0, "channels": [], "platforms": []})
        bucket["viewers"] += row["viewers"]
        bucket["channels"].append(row["platform"] + ":" + row["channel"])
        bucket["platforms"].append(row["platform"])
    for bucket in games.values():
        bucket["channels"] = sorted(set(bucket["channels"]))
        bucket["platforms"] = sorted(set(bucket["platforms"]))

    samples = history.get("samples", [])
    # Avoid duplicate timestamps on workflow retries within the same 3-hour collection slot.
    slot = NOW.replace(hour=(NOW.hour // 3) * 3, minute=0, second=0, microsecond=0)
    def sample_slot(sample):
        stamp = datetime.fromisoformat(sample["timestamp"].replace("Z", "+00:00"))
        return stamp.replace(hour=(stamp.hour // 3) * 3, minute=0, second=0, microsecond=0)
    samples = [sample for sample in samples if sample_slot(sample) != slot]
    samples.append({"timestamp": slot.isoformat(timespec="seconds").replace("+00:00", "Z"), "games": games})
    samples = [s for s in samples if datetime.fromisoformat(s["timestamp"].replace("Z", "+00:00")) >= NOW - timedelta(days=14)]
    current, current_count = aggregate(samples, NOW - timedelta(days=7), NOW + timedelta(seconds=1))
    previous, previous_count = aggregate(samples, NOW - timedelta(days=14), NOW - timedelta(days=7))

    ranked = []
    for name, stats in current.items():
        old = previous.get(name)
        growth = None
        if old and old["score"] > 0 and old["sample_count"] >= 20:
            growth = round((stats["score"] - old["score"]) / old["score"] * 100, 1)
        ranked.append({
            "name": name, "score": stats["score"], "avg_viewers": stats["avg_viewers"],
            "avg_channels": stats["avg_channels"], "unique_channels": stats["unique_channels"],
            "platforms": stats["platforms"], "growth_pct": growth, "samples": stats["sample_count"]
        })
    ranked.sort(key=lambda x: x["score"], reverse=True)

    state = history.get("state") or {"featured_game": None, "challenger": None, "challenger_streak": 0}
    incumbent = next((g for g in ranked if g["name"] == state.get("featured_game")), None)
    eligible = [g for g in ranked if g["samples"] >= 20 and g["unique_channels"] >= 3 and g["avg_channels"] >= 0.5]
    winner = incumbent
    if not incumbent and eligible:
        winner = eligible[0]
        state.update({"featured_game": winner["name"], "challenger": None, "challenger_streak": 0})
    elif incumbent and eligible:
        challenger = next((g for g in eligible if g["name"] != incumbent["name"]), None)
        if challenger and challenger["score"] >= max(1, incumbent["score"]) * 1.35 and challenger.get("growth_pct") is not None and challenger["growth_pct"] >= 20:
            if state.get("challenger") == challenger["name"]:
                state["challenger_streak"] = int(state.get("challenger_streak", 0)) + 1
            else:
                state["challenger"] = challenger["name"]
                state["challenger_streak"] = 1
            if state["challenger_streak"] >= 2:
                winner = challenger
                state.update({"featured_game": challenger["name"], "challenger": None, "challenger_streak": 0})
        else:
            state.update({"challenger": None, "challenger_streak": 0})

    winner_stats = next((g for g in ranked if winner and g["name"] == winner["name"]), None)
    output = {
        "updated_at": NOW_ISO,
        "status": "collecting" if current_count < 20 else ("ready" if winner_stats else "no_qualified_game"),
        "sample_count_7d": current_count,
        "sample_count_previous_7d": previous_count,
        "featured": winner_stats,
        "leaderboard": ranked[:8],
        "rules": {"window_days": 7, "sample_interval_hours": 3, "minimum_samples": 20,
                  "minimum_unique_channels": 3, "minimum_average_channels": 0.5,
                  "challenger_lead": 1.35, "minimum_growth_pct": 20, "consecutive_checks": 2},
        "sources": ["Twitch Helix", "Kick Public API", "YouTube Data API"],
        "coverage_note": "This is a monitored panel of Tunisia-verified creator channels, not a complete census of all Tunisian streamers."
    }
    history["samples"] = samples
    history["current"] = output
    history["state"] = state
    HISTORY_PATH.write_text(json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"streams_seen": len(streams), "games": len(ranked), "sample_count_7d": current_count, "featured": output["featured"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (HTTPError, URLError, KeyError, RuntimeError, ValueError) as exc:
        print("Trend collection failed safely: " + str(exc), file=sys.stderr)
        sys.exit(1)
