# slsk-playlist-dl — Agent Reference

This document provides quick-reference documentation for the two external APIs used in this project. Consult these references when implementing, debugging, or extending Spotify or Soulseek functionality.

---

## Spotify Web API

**Full reference:** https://developer.spotify.com/documentation/web-api

### Authorization

- **Authorization Code flow** (used here for user playlists — requires user login):
  https://developer.spotify.com/documentation/web-api/tutorials/code-flow
- **Client Credentials flow** (used here for public playlists — no user login):
  https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow
- **Refreshing tokens:**
  https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens
- **Redirect URIs** — `localhost` is NOT allowed. Use `http://127.0.0.1:PORT/callback`:
  https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- **Scopes** — this app uses `playlist-read-private playlist-read-collaborative`:
  https://developer.spotify.com/documentation/web-api/concepts/scopes

Token persistence is stored at `~/.config/slsk-playlist-dl/spotify-tokens.json`.
See `src/spotify.ts` for the full OAuth + refresh implementation.

### Key API Shapes (as observed from the live API — Spotify's newer responses differ from older docs)

#### `GET /me/playlists`
- Returns paginated list of user's playlists.
- The `tracks` field on each item is **`null`** in newer API responses. Do not rely on it for track count.
- Use `items[].id` and `items[].name`.
- Reference: https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists

#### `GET /playlists/{playlist_id}/items`
- **IMPORTANT:** Spotify's newer API returns each playlist entry with the track under `item` (not `track`).
  - Old shape: `{ track: { id, name, artists, ... } }`
  - New shape: `{ item: { id, name, artists, type, ... } }`
  - Our code (`src/spotify.ts:fetch_playlist_tracks`) handles both via `entry.item ?? entry.track`.
- Filter out podcast episodes: `item.type === 'episode'`.
- Pagination: follow `data.next`, strip `https://api.spotify.com/v1` prefix before passing to `spotify_get()`.
- Reference: https://developer.spotify.com/documentation/web-api/reference/get-playlists-items

#### `GET /playlists/{playlist_id}`
- Used only to fetch the playlist name (`?fields=name`).
- The `tracks` field on this object is also unreliable in newer responses — do not use for counting.
- Reference: https://developer.spotify.com/documentation/web-api/reference/get-playlist

### Rate limits
https://developer.spotify.com/documentation/web-api/concepts/rate-limits

---

## Soulseek — slsk-client

**npm package:** `slsk-client`
**GitHub:** https://github.com/f-hj/slsk-client

### Usage

```js
import slsk from 'slsk-client'

slsk.connect({ user, pass }, (err, client) => {
  // Search
  client.search({ req: 'artist title', timeout: 5000 }, (err, results) => {
    // results: Array<{ user, file, size, slots, bitrate?, speed? }>
  })

  // Download
  client.download({ file: results[0], path: '/output/track.mp3' }, (err, data) => {
    // data.buffer: Buffer — also written to path if provided
  })
})
```

### API Reference

#### `slsk.connect(opts, callback)`
| Key | Required | Default | Notes |
|-----|----------|---------|-------|
| `user` | yes | — | Soulseek username |
| `pass` | yes | — | Soulseek password |
| `host` | no | `server.slsknet.org` | |
| `port` | no | `2242` | |
| `incomingPort` | no | `2234` | |

#### `client.search(opts, callback)`
| Key | Required | Default | Notes |
|-----|----------|---------|-------|
| `req` | yes | — | Search query string |
| `timeout` | no | `4000` | ms — Soulseek does not signal search end, results are cut off here |

Result object fields:
- `user` — peer username
- `file` — full path on peer's machine (e.g. `@@username/folder/track.mp3`)
- `size` — bytes
- `slots` — **boolean** — `true` means peer has open download slots. Only download if `true`, otherwise you will wait indefinitely
- `bitrate` — kbps, may be `undefined`
- `speed` — peer speed, peer-reported, may be inaccurate

#### `client.download(opts, callback)`
| Key | Required | Default | Notes |
|-----|----------|---------|-------|
| `file` | yes | — | A result object from `search()` |
| `path` | no | `/tmp/slsk/{{originalName}}` | Full output path including filename |

Returns `data.buffer` (entire file in RAM). **Only download files where `slots: true`.**

### File selection heuristic (src/slsk.ts)

Results are scored and ranked:
1. `slots: true` — required (score `-1` if false)
2. Format preference (`--format` flag): FLAC > MP3 320 > other MP3
3. Highest bitrate (up to 320 bonus points)
4. Highest speed (up to 100 bonus points)

### Search normalization (src/normalize.ts)

Queries are cleaned before sending to Soulseek:
1. Strip parenthetical annotations: `(feat. X)`, `[Extended Mix]`, `(Radio Edit)`, `(Remastered)`, etc.
2. Extract primary artist only from multi-artist strings (`A, B & C` → `A`)
3. Remove all non-alphanumeric characters
4. Lowercase and collapse whitespace

Two query attempts per track:
1. `<primary artist> <clean title>`
2. `<clean title>` only (fallback if attempt 1 returns nothing)

---

## Project Structure

```
src/
├── index.tsx              # CLI entry point — renders <App />
├── app.tsx                # Root Ink state machine (screens: playlist_picker → connecting → track_list → searching → confirm → downloading → summary)
├── config.ts              # Loads .env + CLI args (--output, --format, --concurrency)
├── spotify.ts             # Spotify OAuth, token refresh/persistence, playlist + track fetching
├── slsk.ts                # Soulseek connect/search/download wrappers + file scoring
├── normalize.ts           # Search query normalization
└── components/
    ├── PlaylistPicker.tsx  # Screen 1: paste URL or browse playlists with fuzzy filter
    ├── TrackList.tsx       # Screen 2: preview playlist, confirm to start search
    ├── TrackSearchStatus.tsx # Screen 3: live Soulseek search progress (5 concurrent)
    ├── ConfirmDownload.tsx # Screen 4: review found/not-found, confirm downloads
    ├── DownloadProgress.tsx # Screen 5: per-track download progress (3 concurrent)
    └── Summary.tsx         # Screen 6: final report + output path
```

## Environment variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `SLSK_USER` | yes | — | Soulseek username |
| `SLSK_PASS` | yes | — | Soulseek password |
| `SPOTIFY_CLIENT_ID` | yes | — | From Spotify developer dashboard |
| `SPOTIFY_CLIENT_SECRET` | yes | — | From Spotify developer dashboard |
| `SPOTIFY_REDIRECT_URI` | no | `http://127.0.0.1:8888/callback` | Must match exactly what's registered in Spotify app settings. Must use `127.0.0.1`, not `localhost` |
| `OUTPUT_DIR` | no | `~/Music/slsk-downloads` | Override download destination |
| `SLSK_DEBUG` | no | — | Set to `1` to log raw Spotify API responses to stderr |

## Running

```bash
cp .env.example .env   # fill in credentials
npm run dev            # development (tsx, no build step)
npm run build          # compile to dist/
npm start              # run compiled output
```
