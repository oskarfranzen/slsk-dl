import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import {
  get_valid_access_token,
  spotify_oauth,
  fetch_user_playlists,
  extract_playlist_id,
  fetch_public_playlist,
  fetch_playlist_tracks,
  type SpotifyPlaylist,
  type SpotifyTrack,
} from '../spotify.js'
import Spinner from 'ink-spinner'

type Mode = 'menu' | 'paste' | 'browse_loading' | 'browse_search' | 'oauth' | 'loading_playlist' | 'error'

interface Props {
  onLoaded: (playlist_name: string, tracks: SpotifyTrack[]) => void
}

export function PlaylistPicker({ onLoaded }: Props) {
  const [mode, set_mode] = useState<Mode>('menu')
  const [url_input, set_url_input] = useState('')
  const [search_query, set_search_query] = useState('')
  const [playlists, set_playlists] = useState<SpotifyPlaylist[]>([])
  const [selected_index, set_selected_index] = useState(0)
  const [error, set_error] = useState('')
  const [status_msg, set_status_msg] = useState('')
  const [access_token, set_access_token] = useState<string | null>(null)

  const filtered = playlists.filter((p) =>
    p.name.toLowerCase().includes(search_query.toLowerCase()),
  )

  useInput((input, key) => {
    if (mode === 'menu') {
      if (input === 'p' || input === 'P') set_mode('paste')
      if (input === 'b' || input === 'B') start_browse()
      if (key.escape || input === 'q') process.exit(0)
    }

    if (mode === 'browse_search') {
      if (key.upArrow) set_selected_index((i) => Math.max(0, i - 1))
      if (key.downArrow) set_selected_index((i) => Math.min(filtered.length - 1, i + 1))
      if (key.return && filtered[selected_index]) {
        load_playlist_by_id(filtered[selected_index]!.id, filtered[selected_index]!.name, access_token!)
      }
      if (key.escape) set_mode('menu')
    }
  })

  async function start_browse() {
    set_mode('browse_loading')
    try {
      let token = await get_valid_access_token()
      if (!token) {
        set_mode('oauth')
        set_status_msg('Opening browser for Spotify login...')
        const tokens = await spotify_oauth()
        token = tokens.access_token
      }
      set_access_token(token)
      set_status_msg('Loading your playlists...')
      const lists = await fetch_user_playlists(token)
      set_playlists(lists)
      set_selected_index(0)
      set_mode('browse_search')
    } catch (e) {
      set_error(String(e))
      set_mode('error')
    }
  }

  async function load_playlist_by_id(id: string, name: string, token: string) {
    set_mode('loading_playlist')
    set_status_msg(`Loading "${name}"...`)
    try {
      const result = await fetch_playlist_tracks(id, token)
      onLoaded(result.name, result.tracks)
    } catch (e) {
      set_error(String(e))
      set_mode('error')
    }
  }

  async function submit_url() {
    const id = extract_playlist_id(url_input.trim())
    if (!id) {
      set_error('Could not extract a playlist ID from that input. Try pasting the full Spotify URL.')
      set_mode('error')
      return
    }
    set_mode('loading_playlist')
    set_status_msg('Loading playlist...')
    try {
      // Try with user token first (handles private playlists too), fall back to client credentials
      let token = await get_valid_access_token()
      let result
      if (token) {
        result = await fetch_playlist_tracks(id, token)
      } else {
        result = await fetch_public_playlist(id)
      }
      onLoaded(result.name, result.tracks)
    } catch (e) {
      set_error(String(e))
      set_mode('error')
    }
  }

  // Reset selected_index when filter changes
  useEffect(() => {
    set_selected_index(0)
  }, [search_query])

  if (mode === 'menu') {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text bold color="green">slsk-playlist-dl</Text>
        <Text>How would you like to select a playlist?</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>[<Text color="yellow">P</Text>] Paste a public Spotify URL</Text>
          <Text>[<Text color="yellow">B</Text>] Browse my Spotify playlists</Text>
          <Text>[<Text color="gray">Q</Text>] Quit</Text>
        </Box>
      </Box>
    )
  }

  if (mode === 'paste') {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text bold>Paste Spotify playlist URL or URI:</Text>
        <Box>
          <Text color="gray">&gt; </Text>
          <TextInput
            value={url_input}
            onChange={set_url_input}
            onSubmit={submit_url}
            placeholder="https://open.spotify.com/playlist/..."
          />
        </Box>
        <Text color="gray" dimColor>Press Enter to load  |  Esc to go back</Text>
      </Box>
    )
  }

  if (mode === 'browse_loading' || mode === 'oauth' || mode === 'loading_playlist') {
    return (
      <Box gap={1} padding={1}>
        <Text color="green"><Spinner type="dots" /></Text>
        <Text>{status_msg}</Text>
      </Box>
    )
  }

  if (mode === 'browse_search') {
    const visible_count = 12
    const start = Math.max(0, selected_index - Math.floor(visible_count / 2))
    const visible = filtered.slice(start, start + visible_count)

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text bold>Your playlists <Text color="gray">({playlists.length} total)</Text></Text>
        <Box>
          <Text color="gray">Search: </Text>
          <TextInput
            value={search_query}
            onChange={set_search_query}
            placeholder="type to filter..."
          />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {visible.length === 0 && <Text color="gray">No playlists match.</Text>}
          {visible.map((p, vi) => {
            const actual_index = start + vi
            const is_selected = actual_index === selected_index
            return (
              <Box key={p.id}>
                <Text
                  color={is_selected ? 'green' : undefined}
                  bold={is_selected}
                >
                  {is_selected ? '> ' : '  '}
                  {p.name}
                  {p.trackCount > 0 && <Text color="gray"> ({p.trackCount} tracks)</Text>}
                </Text>
              </Box>
            )
          })}
        </Box>
        <Text color="gray" dimColor>↑↓ navigate  |  Enter to select  |  Esc back</Text>
      </Box>
    )
  }

  if (mode === 'error') {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text color="red" bold>Error</Text>
        <Text>{error}</Text>
        <Text color="gray" dimColor>Press Q to quit</Text>
      </Box>
    )
  }

  return null
}
