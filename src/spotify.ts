import { createServer } from 'http'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname } from 'path'
import { exec } from 'child_process'
import { config } from './config.js'

export interface SpotifyTokens {
  access_token: string
  refresh_token: string
  expires_at: number
}

export interface SpotifyTrack {
  id: string
  title: string
  artists: string[]
  durationMs: number
}

export interface SpotifyPlaylist {
  id: string
  name: string
  owner: string
  trackCount: number
}

// ─── Token persistence ────────────────────────────────────────────────────────

async function save_tokens(tokens: SpotifyTokens): Promise<void> {
  await mkdir(dirname(config.tokenPath), { recursive: true })
  await writeFile(config.tokenPath, JSON.stringify(tokens, null, 2))
}

async function load_tokens(): Promise<SpotifyTokens | null> {
  if (!existsSync(config.tokenPath)) return null
  try {
    const raw = await readFile(config.tokenPath, 'utf-8')
    return JSON.parse(raw) as SpotifyTokens
  } catch {
    return null
  }
}

async function refresh_access_token(refresh_token: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token,
    client_id: config.spotify.clientId,
    client_secret: config.spotify.clientSecret,
  })
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
  }
}

export async function get_valid_access_token(): Promise<string | null> {
  const tokens = await load_tokens()
  if (!tokens) return null
  if (Date.now() < tokens.expires_at) return tokens.access_token
  try {
    const refreshed = await refresh_access_token(tokens.refresh_token)
    await save_tokens(refreshed)
    return refreshed.access_token
  } catch {
    return null
  }
}

// ─── OAuth Authorization Code flow ───────────────────────────────────────────

function open_browser(url: string) {
  const platform = process.platform
  const cmd = platform === 'darwin' ? `open "${url}"`
    : platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`
  exec(cmd)
}

export async function spotify_oauth(): Promise<SpotifyTokens> {
  const scopes = 'playlist-read-private playlist-read-collaborative'
  const redirect_uri_obj = new URL(config.spotify.redirectUri)
  const port = parseInt(redirect_uri_obj.port || '8888', 10)

  const auth_url = new URL('https://accounts.spotify.com/authorize')
  auth_url.searchParams.set('client_id', config.spotify.clientId)
  auth_url.searchParams.set('response_type', 'code')
  auth_url.searchParams.set('redirect_uri', config.spotify.redirectUri)
  auth_url.searchParams.set('scope', scopes)

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith('/callback')) return
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Authorization complete. You can close this tab.</h2></body></html>')
      server.close()

      if (error || !code) {
        reject(new Error(`Spotify auth error: ${error ?? 'no code'}`))
        return
      }

      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.spotify.redirectUri,
          client_id: config.spotify.clientId,
          client_secret: config.spotify.clientSecret,
        })
        const token_res = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
        if (!token_res.ok) {
          reject(new Error(`Token exchange failed: ${token_res.status}`))
          return
        }
        const data = await token_res.json() as {
          access_token: string
          refresh_token: string
          expires_in: number
        }
        const tokens: SpotifyTokens = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + data.expires_in * 1000 - 60_000,
        }
        await save_tokens(tokens)
        resolve(tokens)
      } catch (e) {
        reject(e)
      }
    })

    server.listen(port, '127.0.0.1', () => {
      open_browser(auth_url.toString())
    })
  })
}

// ─── Spotify API calls ────────────────────────────────────────────────────────

async function spotify_get(path: string, access_token: string): Promise<unknown> {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  if (!res.ok) throw new Error(`Spotify API error ${res.status}: ${path}`)
  const json = await res.json()
  if (process.env['SLSK_DEBUG']) {
    process.stderr.write(`[spotify_get] ${path}\n${JSON.stringify(json).slice(0, 500)}\n`)
  }
  return json
}

export async function fetch_user_playlists(access_token: string): Promise<SpotifyPlaylist[]> {
  const playlists: SpotifyPlaylist[] = []
  let url: string | null = '/me/playlists?limit=50'
  while (url) {
    const data = await spotify_get(url, access_token) as {
      items: Array<{
        id: string
        name: string
        owner?: { display_name?: string }
        // "tracks" field is null in newer API responses — total comes from items pagination
        tracks?: { total?: number } | null
      }>
      next: string | null
    }
    for (const item of data.items ?? []) {
      if (!item?.id) continue
      playlists.push({
        id: item.id,
        name: item.name ?? 'Untitled',
        owner: item.owner?.display_name ?? '',
        // tracks.total is unreliable/null in newer API — use 0, will be shown correctly on TrackList
        trackCount: item.tracks?.total ?? 0,
      })
    }
    if (data.next) {
      url = data.next.replace('https://api.spotify.com/v1', '')
    } else {
      url = null
    }
  }
  return playlists
}

export async function fetch_playlist_tracks(
  playlist_id: string,
  access_token: string,
): Promise<{ name: string; tracks: SpotifyTrack[] }> {
  const playlist_data = await spotify_get(`/playlists/${playlist_id}?fields=name`, access_token) as {
    name?: string
  }
  const name = playlist_data.name ?? 'Unknown Playlist'
  const tracks: SpotifyTrack[] = []

  // Spotify's newer API returns items under the key "item" (not "track") per playlist item.
  // We support both for compatibility.
  let url: string | null = `/playlists/${playlist_id}/items?limit=100`

  while (url) {
    const data = await spotify_get(url, access_token) as {
      items: Array<{
        // Legacy field name
        track?: {
          id?: string
          name?: string
          duration_ms?: number
          artists?: Array<{ name: string }>
          type?: string
        } | null
        // New field name used by Spotify's updated API
        item?: {
          id?: string
          name?: string
          duration_ms?: number
          artists?: Array<{ name: string }>
          type?: string
        } | null
      }>
      next: string | null
    }
    for (const entry of data.items ?? []) {
      // Prefer "item", fall back to "track"
      const t = entry.item ?? entry.track
      if (!t?.id || !t.name) continue
      if (t.type === 'episode') continue
      tracks.push({
        id: t.id,
        title: t.name,
        artists: (t.artists ?? []).map((a) => a.name),
        durationMs: t.duration_ms ?? 0,
      })
    }
    if (data.next) {
      url = data.next.replace('https://api.spotify.com/v1', '')
    } else {
      url = null
    }
  }
  return { name, tracks }
}

export function extract_playlist_id(input: string): string | null {
  // Handle spotify:playlist:ID URIs
  const uri_match = input.match(/^spotify:playlist:([A-Za-z0-9]+)$/)
  if (uri_match) return uri_match[1]!

  // Handle open.spotify.com/playlist/ID URLs
  try {
    const url = new URL(input)
    const match = url.pathname.match(/\/playlist\/([A-Za-z0-9]+)/)
    if (match) return match[1]!
  } catch {
    // not a URL
  }

  // Bare ID (22 alphanumeric chars)
  if (/^[A-Za-z0-9]{22}$/.test(input)) return input

  return null
}

export async function fetch_public_playlist(
  playlist_id: string,
): Promise<{ name: string; tracks: SpotifyTrack[] }> {
  // For public playlists, use client credentials flow (no user auth needed)
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.spotify.clientId,
    client_secret: config.spotify.clientSecret,
  })
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`Client credentials failed: ${res.status}`)
  const token_data = await res.json() as { access_token: string }
  return fetch_playlist_tracks(playlist_id, token_data.access_token)
}
