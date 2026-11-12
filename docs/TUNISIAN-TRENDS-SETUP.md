# PUNIX Tunisian streaming trend tracker

The tracker samples a curated, Tunisia-verified creator panel across Twitch, Kick and YouTube Gaming every three hours. GitHub Actions stores up to 14 days of snapshots in `data/tunisian-trends.json`; the Game Hub reads the public JSON file.

## One-time activation

### 1. Add API credentials as GitHub Actions secrets

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Where to get it |
|---|---|
| `TWITCH_CLIENT_ID` | Twitch Developer Console application |
| `TWITCH_CLIENT_SECRET` | Same Twitch application |
| `KICK_CLIENT_ID` | Kick Developer app |
| `KICK_CLIENT_SECRET` | Same Kick app |
| `YOUTUBE_API_KEY` | Google Cloud project with YouTube Data API v3 enabled |

Keep all secrets in GitHub Actions secrets. Never put them in website JavaScript, JSON files, commits, or chat messages.

### 2. Add the Tunisian creator panel

Edit `data/tunisian-streamers.json`. Only add channels whose Tunisian location has been checked by the PUNIX team. The Twitch and Kick APIs do not provide a reliable public country field for every broadcaster, so the `country_verified` flag is an explicit editorial verification step—not a guess based on language.

Example structure (replace the example handles with verified creators):

```json
{
  "twitch": [
    { "login": "verified_twitch_login", "country_verified": true }
  ],
  "kick": [
    { "slug": "verified-kick-slug", "country_verified": true }
  ],
  "youtube": [
    { "channel_id": "UCxxxxxxxxxxxxxxxxxxxxxx", "label": "Creator name" }
  ],
  "game_aliases": {
    "valorant": "VALORANT",
    "rob run": "ROB RUN",
    "fortnite": "Fortnite",
    "league of legends": "League of Legends"
  }
}
```

YouTube channels are included only when YouTube's channel metadata explicitly reports country `TN`. YouTube live video titles are mapped to games using `game_aliases`; add common title spellings used by the monitored creators. Use the channel ID (not a display name).

### 3. Run the first check

Open **Actions → PUNIX Tunisian streaming trends → Run workflow**. The scheduled workflow then runs every three hours (UTC). It needs the five secrets and a non-empty creator registry to collect meaningful results.

## Ranking safeguards

- Rolling seven-day window compared with the preceding seven days.
- Samples every three hours; up to 14 days of history retained.
- A game needs at least 20 observations, 3 unique verified channels, and an average of at least 0.5 active channels per check before it can qualify.
- A challenger must score at least 35% above the current featured game and show at least 20% growth against the previous seven-day window.
- The challenger must pass on two consecutive checks before the spotlight changes.
- If a platform/API fails, collection fails closed: no partial cross-platform ranking is published.
- This is a monitored creator panel, not a complete census of every Tunisian streamer. Rankings should be described as panel-based, not as total national market share.

## Data and privacy

Only public channel identifiers, game/category names, public live viewer counts, platform labels, and public stream links are stored. No private account data or credentials are written to the public JSON file.
