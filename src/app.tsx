import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { PlaylistPicker } from './components/PlaylistPicker.js'
import { TrackList } from './components/TrackList.js'
import { TrackSearchStatus, type TrackResult } from './components/TrackSearchStatus.js'
import { ConfirmDownload } from './components/ConfirmDownload.js'
import { DownloadProgress, type DownloadResult } from './components/DownloadProgress.js'
import { Summary } from './components/Summary.js'
import { connect_slsk, type SlskFile } from './slsk.js'
import { config } from './config.js'
import { type SpotifyTrack } from './spotify.js'
import Spinner from 'ink-spinner'

type Screen =
  | 'playlist_picker'
  | 'connecting'
  | 'track_list'
  | 'searching'
  | 'confirm'
  | 'downloading'
  | 'summary'

export function App() {
  const [screen, set_screen] = useState<Screen>('playlist_picker')
  const [playlist_name, set_playlist_name] = useState('')
  const [tracks, set_tracks] = useState<SpotifyTrack[]>([])
  const [search_results, set_search_results] = useState<TrackResult[]>([])
  const [downloads, set_downloads] = useState<DownloadResult[]>([])
  const [connect_error, set_connect_error] = useState('')
  const [enabled_ids, set_enabled_ids] = useState<Set<string>>(new Set())
  const [file_overrides, set_file_overrides] = useState<Map<string, SlskFile>>(new Map())

  function on_playlist_loaded(name: string, loaded_tracks: SpotifyTrack[]) {
    set_playlist_name(name)
    set_tracks(loaded_tracks)
    set_screen('connecting')
  }

  useEffect(() => {
    if (screen !== 'connecting') return
    connect_slsk()
      .then(() => set_screen('track_list'))
      .catch((e: unknown) => {
        set_connect_error(String(e))
      })
  }, [screen])

  useInput((_input, key) => {
    if (screen === 'searching') {
      const all_done = search_results.length === tracks.length &&
        search_results.every((r) => r.state.status === 'found' || r.state.status === 'not_found')
      if (key.return && all_done) set_screen('confirm')
    }
  })

  if (screen === 'playlist_picker') {
    return <PlaylistPicker onLoaded={on_playlist_loaded} />
  }

  if (screen === 'connecting') {
    if (connect_error) {
      return (
        <Box flexDirection="column" gap={1} padding={1}>
          <Text color="red" bold>Failed to connect to Soulseek</Text>
          <Text>{connect_error}</Text>
          <Text color="gray" dimColor>Check your SLSK_USER and SLSK_PASS in .env</Text>
        </Box>
      )
    }
    return (
      <Box gap={1} padding={1}>
        <Text color="green"><Spinner type="dots" /></Text>
        <Text>Connecting to Soulseek...</Text>
      </Box>
    )
  }

  if (screen === 'track_list') {
    return (
      <TrackList
        playlist_name={playlist_name}
        tracks={tracks}
        onConfirm={() => set_screen('searching')}
        onBack={() => set_screen('playlist_picker')}
      />
    )
  }

  if (screen === 'searching') {
    const all_done = search_results.length === tracks.length &&
      search_results.every((r) => r.state.status === 'found' || r.state.status === 'not_found')
    return (
      <Box flexDirection="column">
        <TrackSearchStatus
          tracks={tracks}
          results={search_results}
          onDone={(results) => set_search_results(results)}
        />
        {all_done && (
          <Box padding={1}>
            <Text color="gray" dimColor>Press Enter to review results</Text>
          </Box>
        )}
      </Box>
    )
  }

  if (screen === 'confirm') {
    return (
      <ConfirmDownload
        results={search_results}
        output_dir={config.outputDir}
        playlist_name={playlist_name}
        onConfirm={(ids, overrides) => {
          set_enabled_ids(ids)
          set_file_overrides(overrides)
          set_screen('downloading')
        }}
        onAbort={() => process.exit(0)}
      />
    )
  }

  if (screen === 'downloading') {
    const all_done = downloads.length > 0 &&
      downloads.every((d) => ['done', 'failed', 'skipped'].includes(d.state.status))
    return (
      <Box flexDirection="column">
        <DownloadProgress
          results={search_results}
          playlist_name={playlist_name}
          output_dir={config.outputDir}
          enabled_ids={enabled_ids}
          file_overrides={file_overrides}
          downloads={downloads}
          onDone={(dl) => {
            set_downloads(dl)
            if (dl.length > 0 && dl.every((d) => ['done', 'failed', 'skipped'].includes(d.state.status))) {
              // slight delay so user sees final state before screen changes
              setTimeout(() => set_screen('summary'), 500)
            }
          }}
        />
        {all_done && (
          <Box padding={1}>
            <Text color="gray" dimColor>Finishing up...</Text>
          </Box>
        )}
      </Box>
    )
  }

  if (screen === 'summary') {
    const not_found_count = search_results.filter((r) => r.state.status === 'not_found').length
    return (
      <Summary
        downloads={downloads}
        playlist_name={playlist_name}
        output_dir={config.outputDir}
        not_found_count={not_found_count}
      />
    )
  }

  return null
}
