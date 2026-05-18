import React, { useEffect, useRef } from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { type SpotifyTrack } from '../spotify.js'
import { normalize_query } from '../normalize.js'
import { search_track, format_size } from '../slsk.js'
import pLimit from 'p-limit'

export type TrackSearchState =
  | { status: 'pending' }
  | { status: 'searching' }
  | { status: 'found'; file: { user: string; file: string; size: number; bitrate?: number; slots: boolean; speed?: number }; query: string }
  | { status: 'not_found'; query: string }

export interface TrackResult {
  track: SpotifyTrack
  state: TrackSearchState
}

interface Props {
  tracks: SpotifyTrack[]
  results: TrackResult[]
  onDone: (results: TrackResult[]) => void
}

export function TrackSearchStatus({ tracks, results, onDone }: Props) {
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    run_searches()
  }, [])

  async function run_searches() {
    // Initialize all as pending
    const state: TrackResult[] = tracks.map((t) => ({
      track: t,
      state: { status: 'pending' },
    }))

    // We mutate state and call onDone incrementally to trigger re-renders
    const limit = pLimit(5)

    const promises = tracks.map((track, i) =>
      limit(async () => {
        // Mark as searching
        state[i] = { track, state: { status: 'searching' } }
        onDone([...state])

        const { primary, title_only } = normalize_query(track.artists, track.title)
        const result = await search_track(primary, title_only)

        if (result.found) {
          state[i] = { track, state: { status: 'found', file: result.file, query: result.query } }
        } else {
          state[i] = { track, state: { status: 'not_found', query: result.query } }
        }
        onDone([...state])
      }),
    )

    await Promise.all(promises)
    onDone([...state])
  }

  const done_count = results.filter(
    (r) => r.state.status === 'found' || r.state.status === 'not_found',
  ).length
  const found_count = results.filter((r) => r.state.status === 'found').length
  const all_done = done_count === tracks.length

  // Show last 14 results (most recent activity)
  const visible = results.slice(-14)

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Box gap={2}>
        <Text bold>Searching Soulseek</Text>
        <Text color="gray">{done_count}/{tracks.length}</Text>
        {all_done && <Text color="green">Done — {found_count} found</Text>}
      </Box>

      <Box flexDirection="column">
        {visible.map((r, i) => {
          const label = `${r.track.artists[0]} - ${r.track.title}`
          const { state } = r
          if (state.status === 'pending') {
            return <Text key={i} color="gray" dimColor>  · {label}</Text>
          }
          if (state.status === 'searching') {
            return (
              <Box key={i} gap={1}>
                <Text color="yellow"><Spinner type="dots" /></Text>
                <Text>{label}</Text>
              </Box>
            )
          }
          if (state.status === 'found') {
            const ext = state.file.file.split('.').pop()?.toUpperCase() ?? '?'
            const bitrate = state.file.bitrate ? ` ${state.file.bitrate}kbps` : ''
            return (
              <Text key={i} color="green">
                {'  ✓ '}{label}
                <Text color="gray"> ({ext}{bitrate}, {format_size(state.file.size)})</Text>
              </Text>
            )
          }
          if (state.status === 'not_found') {
            return <Text key={i} color="red">{'  ✗ '}{label}</Text>
          }
          return null
        })}
      </Box>

      {all_done && (
        <Text color="gray" dimColor>Press Enter to review and confirm downloads</Text>
      )}
    </Box>
  )
}
