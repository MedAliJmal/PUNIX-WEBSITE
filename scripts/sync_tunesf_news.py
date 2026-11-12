#!/usr/bin/env python3
"""Mirror the latest public articles from the official TUNESF news page."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

SOURCE_URL = "https://esports.tunesf.com/blog"
OUTPUT = Path("data/tunesf-news.json")
ALLOWED_HOSTS = {"tunesf.com", "www.tunesf.com", "esports.tunesf.com"}
DATE_RE = re.compile(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b", re.I)


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def parse_date(text: str) -> str:
    match = DATE_RE.search(text)
    if not match:
        return ""
    raw = match.group(0).replace(",", "")
    for fmt in ("%b %d %Y", "%B %d %Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    return ""


def main() -> None:
    response = requests.get(
        SOURCE_URL,
        timeout=30,
        headers={"User-Agent": "PUNIX-NewsMirror/1.0 (+https://github.com/MedAliJmal/PUNIX-WEBSITE)"},
    )
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    articles = []
    seen = set()

    for anchor in soup.find_all("a", href=True):
        title = clean(anchor.get_text(" ", strip=True))
        absolute = urljoin(SOURCE_URL, anchor["href"])
        parsed = urlparse(absolute)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            continue
        if not re.search(r"/blog/post/[^/]+/?$", parsed.path):
            continue
        if not title or len(title) < 8 or absolute in seen:
            continue
        seen.add(absolute)

        card = anchor
        for _ in range(5):
            parent = card.parent
            if parent is None:
                break
            card = parent
            text = clean(card.get_text(" ", strip=True))
            if DATE_RE.search(text) and len(text) < 1800:
                break
        card_text = clean(card.get_text(" ", strip=True))
        date = parse_date(card_text)
        description = ""
        for paragraph in card.find_all("p"):
            candidate = clean(paragraph.get_text(" ", strip=True))
            if candidate and candidate.lower() != title.lower() and len(candidate) > 35:
                description = candidate[:360]
                break
        if not description:
            description = card_text.replace(title, "", 1)
            if date:
                description = description.replace(date, "", 1)
            description = clean(re.sub(r"(?i)read more", "", description))[:360]
        image = ""
        img = card.find("img")
        if img:
            image = urljoin(SOURCE_URL, img.get("src") or img.get("data-src") or "")
            if urlparse(image).hostname not in ALLOWED_HOSTS:
                image = ""
        articles.append({
            "title": title[:220],
            "description": description,
            "url": absolute,
            "date": date,
            "image": image,
        })

    if not articles:
        raise RuntimeError("No official TUNESF article links were detected; preserving the previous snapshot.")

    def sort_key(item: dict) -> str:
        return item["date"] or ""

    articles.sort(key=sort_key, reverse=True)
    payload = {
        "source": SOURCE_URL,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "articles": articles[:6],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(payload['articles'])} official TUNESF articles to {OUTPUT}")


if __name__ == "__main__":
    main()
