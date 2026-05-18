import React, { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { type TrackResult } from './TrackSearchStatus.js'
import { download_with_fallback, get_extension, format_size, type SlskFile } from '../slsk.js'
import { join } from 'path'
import pLimit from 'p-limit'

export type DownloadState =
  | { status: 'queued' }
  | { status: 'downloading'; started_at: number }
  | { status: 'retrying'; attempt: number; reason: string; started_at: number }
  | { status: 'done'; path: string }
  | { status: 'failed'; error: string; attempts: number }
  | { status: 'skipped' }

export interface DownloadResult {
  track: TrackResult
  state: DownloadState
}

interface Props {
  results: TrackResult[]
  playlist_name: string
  output_dir: string
  enabled_ids: Set<string>
  file_overrides: Map<string, SlskFile>
  downloads: DownloadResult[]
  onDone: (downloads: DownloadResult[]) => void
}

function safe_filename(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '_').trim()
}

export function DownloadProgress({ results, playlist_name, output_dir, enabled_ids, file_overrides, downloads, onDone }: Props) {
  const started = useRef(false)
  const [tick, set_tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => set_tick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    run_downloads()
  }, [])

  async function run_downloads() {
    const state: DownloadResult[] = results.map((r) => ({
      track: r,
      state: (r.state.status === 'found' && enabled_ids.has(r.track.id))
        ? { status: 'queued' as const }
        : { status: 'skipped' as const },
    }))
    onDone([...state])

    const limit = pLimit(3)
    const dir = join(output_dir, safe_filename(playlist_name))

    const promises = state.map((dl, i) =>
      limit(async () => {
        if (dl.state.status === 'skipped') return
        const track_result = dl.track
        if (track_result.state.status !== 'found') return

        const file = file_overrides.get(track_result.track.id) ?? track_result.state.file
        const query = track_result.state.query
        const ext = get_extension(file.file)
        const filename = safe_filename(
          `${track_result.track.artists[0]} - ${track_result.track.title}`,
        ) + ext
        const dest = join(dir, filename)

        state[i] = { track: dl.track, state: { status: 'downloading', started_at: Date.now() } }
        onDone([...state])

        try {
          const result = await download_with_fallback(
            file,
            query,
            dest,
            60_000,
            5,
            // Progress callback — called each time a retry starts
            (attempt, failed_user, reason) => {
              state[i] = {
                track: dl.track,
                state: { status: 'retrying', attempt, reason: `${failed_user}: ${reason}`, started_at: Date.now() },
              }
              onDone([...state])
            },
          )
          state[i] = { track: dl.track, state: { status: 'done', path: result.path } }
        } catch (e) {
          const err = e as { retries?: { error: string }[] }
          state[i] = {
            track: dl.track,
            state: {
              status: 'failed',
              error: String(e),
              attempts: (err.retries?.length ?? 0) + 1,
            },
          }
        }
        onDone([...state])
      }),
    )

    await Promise.all(promises)
    onDone([...state])
  }

  const total_downloadable = downloads.filter((d) => d.state.status !== 'skipped').length
  const done_count = downloads.filter((d) => d.state.status === 'done').length
  const failed_count = downloads.filter((d) => d.state.status === 'failed').length
  const in_progress = downloads.filter((d) => d.state.status === 'downloading').length
  const all_done = downloads.length > 0 &&
    downloads.every((d) => ['done', 'failed', 'skipped'].includes(d.state.status))

  // Show only non-skipped, last 14
  const active = downloads.filter((d) => d.state.status !== 'skipped').slice(-14)

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Box gap={2}>
        <Text bold>Downloading</Text>
        <Text color="gray">{done_count + failed_count}/{total_downloadable}</Text>
        {in_progress > 0 && <Text color="yellow">{in_progress} in progress</Text>}
        {all_done && <Text color="green">Complete</Text>}
      </Box>

      <Box flexDirection="column">
        {active.map((dl, i) => {
          const label = `${dl.track.track.artists[0]} - ${dl.track.track.title}`
          const { state } = dl
          if (state.status === 'queued') {
            return <Text key={i} color="gray" dimColor>  · {label}</Text>
          }
          if (state.status === 'downloading') {
            const elapsed = Math.floor((Date.now() - state.started_at) / 1000)
            const elapsed_str = elapsed > 0 ? `${elapsed}s` : '…'
            const file = (dl.track.state.status === 'found') ? dl.track.state.file : null
            const size_str = file ? format_size(file.size) : ''
            const speed_str = (file?.speed && elapsed > 0)
              ? `~${(file.speed / 1024 / 1024).toFixed(1)}MB/s peer`
              : ''
            return (
              <Box key={i} gap={1}>
                <Text color="cyan"><Spinner type="dots" /></Text>
                <Text>{label}</Text>
                <Text color="gray" dimColor>
                  {[size_str, elapsed_str, speed_str].filter(Boolean).join(' · ')}
                </Text>
              </Box>
            )
          }
          if (state.status === 'retrying') {
            const elapsed = Math.floor((Date.now() - state.started_at) / 1000)
            const elapsed_str = elapsed > 0 ? `${elapsed}s` : '…'
            const file = (dl.track.state.status === 'found') ? dl.track.state.file : null
            const size_str = file ? format_size(file.size) : ''
            const speed_str = file?.speed ? `~${(file.speed / 1024 / 1024).toFixed(1)}MB/s peer` : ''
            return (
              <Box key={i} gap={1}>
                <Text color="yellow"><Spinner type="dots" /></Text>
                <Text>{label}</Text>
                <Text color="yellow" dimColor>(retry {state.attempt})</Text>
                <Text color="gray" dimColor>
                  {[size_str, elapsed_str, speed_str].filter(Boolean).join(' · ')}
                </Text>
              </Box>
            )
          }
          if (state.status === 'done') {
            return <Text key={i} color="green">  ✓ {label}</Text>
          }
          if (state.status === 'failed') {
            const attempts_str = state.attempts > 1 ? ` after ${state.attempts} attempts` : ''
            return (
              <Text key={i} color="red">
                {'  ✗ '}{label}
                <Text color="gray" dimColor> ({state.error}{attempts_str})</Text>
              </Text>
            )
          }
          return null
        })}
      </Box>
    </Box>
  )
}
