import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import Spinner from 'ink-spinner'
import { type TrackResult } from './TrackSearchStatus.js'
import { search_slsk, pick_best_result, format_size, type SlskFile } from '../slsk.js'

interface Props {
  results: TrackResult[]
  output_dir: string
  playlist_name: string
  onConfirm: (enabled_ids: Set<string>, file_overrides: Map<string, SlskFile>) => void
  onAbort: () => void
}

type Mode = 'table' | 'requery' | 'picking' | 'searching'

// Inline override: track index → manually chosen file
type Overrides = Map<number, SlskFile>

function slsk_filename(file_path: string): string {
  const parts = file_path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? file_path
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const half = Math.floor((max - 3) / 2)
  return s.slice(0, half) + '...' + s.slice(s.length - (max - half - 3))
}

function file_meta(f: SlskFile): string {
  const ext = slsk_filename(f.file).split('.').pop()?.toUpperCase() ?? '?'
  const bitrate = f.bitrate ? `${f.bitrate}k` : ''
  const size = format_size(f.size)
  const speed = f.speed ? `${(f.speed / 1024 / 1024).toFixed(1)}MB/s` : ''
  return [ext, bitrate, size, speed].filter(Boolean).join(' ')
}

export function ConfirmDownload({ results, onConfirm, onAbort }: Props) {
  const found_indices = results
    .map((r, i) => (r.state.status === 'found' ? i : -1))
    .filter((i) => i >= 0)

  const [checked, set_checked] = useState<Set<number>>(() => new Set(found_indices))
  const [cursor, set_cursor] = useState(0)
  const [scroll_offset, set_scroll_offset] = useState(0)
  const page_size = 16

  const [mode, set_mode] = useState<Mode>('table')
  const [query_input, set_query_input] = useState('')
  const [search_results, set_search_results] = useState<SlskFile[]>([])
  const [search_error, set_search_error] = useState('')
  const [pick_cursor, set_pick_cursor] = useState(0)
  const [pick_scroll, set_pick_scroll] = useState(0)
  const pick_page = 12

  // Per-row file overrides selected via re-query
  const [overrides, set_overrides] = useState<Overrides>(new Map())

  // Get the effective file for a result row (override takes precedence)
  function effective_file(idx: number): SlskFile | null {
    if (overrides.has(idx)) return overrides.get(idx)!
    const r = results[idx]
    if (r?.state.status === 'found') return r.state.file
    return null
  }

  function move_cursor(delta: number) {
    const next = Math.max(0, Math.min(results.length - 1, cursor + delta))
    set_cursor(next)
    if (next < scroll_offset) set_scroll_offset(next)
    else if (next >= scroll_offset + page_size) set_scroll_offset(next - page_size + 1)
  }

  function open_requery() {
    const r = results[cursor]
    if (!r) return
    // Pre-fill with original query if available, else artist + title
    const default_q = r.state.status === 'found' || r.state.status === 'not_found'
      ? r.state.query
      : `${r.track.artists[0]} ${r.track.title}`
    set_query_input(default_q)
    set_search_error('')
    set_mode('requery')
  }

  async function run_requery(q: string) {
    if (!q.trim()) return
    set_mode('searching')
    set_search_error('')
    try {
      const res = await search_slsk(q.trim(), 6000)
      // Sort: slots first, then score — show all audio files not just best
      const audio = res.filter((f) => /\.(mp3|flac|ogg|aac|m4a|opus|wav)$/i.test(f.file))
      audio.sort((a, b) => {
        if (a.slots && !b.slots) return -1
        if (!a.slots && b.slots) return 1
        const br_diff = (b.bitrate ?? 0) - (a.bitrate ?? 0)
        if (br_diff !== 0) return br_diff
        return (b.speed ?? 0) - (a.speed ?? 0)
      })
      if (audio.length === 0) {
        set_search_error('No audio files found for that query.')
        set_mode('requery')
        return
      }
      set_search_results(audio)
      set_pick_cursor(0)
      set_pick_scroll(0)
      set_mode('picking')
    } catch (e) {
      set_search_error(String(e))
      set_mode('requery')
    }
  }

  function apply_pick(file: SlskFile) {
    set_overrides((prev) => {
      const next = new Map(prev)
      next.set(cursor, file)
      return next
    })
    // Auto-check if it was unchecked
    set_checked((prev) => {
      const next = new Set(prev)
      next.add(cursor)
      return next
    })
    set_mode('table')
  }

  useInput((input, key) => {
    if (mode === 'table') {
      if (key.escape) { onAbort(); return }
      if (key.upArrow) { move_cursor(-1); return }
      if (key.downArrow) { move_cursor(1); return }

      if (input === ' ') {
        // Toggle only rows that have a file (found or overridden)
        if (effective_file(cursor) !== null) {
          set_checked((prev) => {
            const next = new Set(prev)
            if (next.has(cursor)) next.delete(cursor)
            else next.add(cursor)
            return next
          })
        }
        return
      }

      if (input === 'r' || input === 'R') {
        open_requery()
        return
      }

      if (input === 'a' || input === 'A') {
        const all_found = results
          .map((_, i) => i)
          .filter((i) => effective_file(i) !== null)
        if (checked.size === all_found.length) {
          set_checked(new Set())
        } else {
          set_checked(new Set(all_found))
        }
        return
      }

      if (key.return) {
        const enabled_ids = new Set<string>()
        const file_overrides = new Map<string, SlskFile>()
        for (const idx of checked) {
          const r = results[idx]
          if (!r) continue
          enabled_ids.add(r.track.id)
          // If this row has a manually picked file, pass it along keyed by track ID
          if (overrides.has(idx)) {
            file_overrides.set(r.track.id, overrides.get(idx)!)
          }
        }
        onConfirm(enabled_ids, file_overrides)
      }
    }

    if (mode === 'requery') {
      if (key.escape) { set_mode('table'); return }
    }

    if (mode === 'picking') {
      if (key.escape) { set_mode('requery'); return }
      if (key.upArrow) {
        const next = Math.max(0, pick_cursor - 1)
        set_pick_cursor(next)
        if (next < pick_scroll) set_pick_scroll(next)
      }
      if (key.downArrow) {
        const next = Math.min(search_results.length - 1, pick_cursor + 1)
        set_pick_cursor(next)
        if (next >= pick_scroll + pick_page) set_pick_scroll(next - pick_page + 1)
      }
      if (key.return) {
        const chosen = search_results[pick_cursor]
        if (chosen) apply_pick(chosen)
      }
    }
  })

  // ─── Requery input screen ──────────────────────────────────────────────────

  if (mode === 'requery' || mode === 'searching') {
    const r = results[cursor]!
    const track_label = `${r.track.artists[0]} - ${r.track.title}`
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text bold>Re-query: <Text color="cyan">{track_label}</Text></Text>
        <Box gap={1}>
          <Text color="gray">Search: </Text>
          <TextInput
            value={query_input}
            onChange={set_query_input}
            onSubmit={run_requery}
            focus={mode === 'requery'}
          />
          {mode === 'searching' && <Text color="yellow"><Spinner type="dots" /></Text>}
        </Box>
        {search_error && <Text color="red">{search_error}</Text>}
        <Text color="gray" dimColor>Enter to search  ·  Esc to cancel</Text>
      </Box>
    )
  }

  // ─── Result picker screen ──────────────────────────────────────────────────

  if (mode === 'picking') {
    const r = results[cursor]!
    const track_label = `${r.track.artists[0]} - ${r.track.title}`
    const visible_picks = search_results.slice(pick_scroll, pick_scroll + pick_page)

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text bold>Pick a file for: <Text color="cyan">{track_label}</Text></Text>
        <Text color="gray" dimColor>{search_results.length} results</Text>

        <Box flexDirection="column" borderStyle="single" borderColor="gray">
          {visible_picks.map((f, vi) => {
            const real_idx = pick_scroll + vi
            const is_sel = real_idx === pick_cursor
            const filename = slsk_filename(f.file)
            const meta = file_meta(f)
            const slots_indicator = f.slots ? '' : ' [no slots]'
            return (
              <Box key={real_idx} paddingX={1} flexDirection="column">
                <Text
                  color={is_sel ? 'white' : f.slots ? undefined : 'gray'}
                  bold={is_sel}
                  inverse={is_sel}
                  dimColor={!f.slots && !is_sel}
                >
                  {is_sel ? '> ' : '  '}{filename}{'  '}<Text color={is_sel ? 'white' : 'gray'}>{meta}{slots_indicator}</Text>
                </Text>
                <Text color="gray" dimColor>
                  {'    '}{f.file}
                </Text>
              </Box>
            )
          })}
        </Box>

        {search_results.length > pick_page && (
          <Text color="gray" dimColor>
            {pick_cursor + 1}/{search_results.length}
          </Text>
        )}
        <Text color="gray" dimColor>↑↓ navigate  ·  Enter to select  ·  Esc back to search</Text>
      </Box>
    )
  }

  // ─── Main table ────────────────────────────────────────────────────────────

  const not_found_count = results.filter(
    (r, i) => r.state.status === 'not_found' && !overrides.has(i),
  ).length
  const checked_count = checked.size

  const visible = results.slice(scroll_offset, scroll_offset + page_size)

  // Column widths
  const file_col = 44
  const spotify_col = 30
  const meta_col = 16

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Box gap={2}>
        <Text bold>Confirm Downloads</Text>
        <Text color="green">✓ {checked_count} selected</Text>
        {not_found_count > 0 && <Text color="red">✗ {not_found_count} not found</Text>}
        <Text color="gray" dimColor>({results.length} total)</Text>
      </Box>

      {/* Table */}
      <Box flexDirection="column" borderStyle="single" borderColor="gray">
        {/* Header */}
        <Box paddingX={1}>
          <Text bold color="gray">
            {'   '}
            {'Soulseek File'.padEnd(file_col)}
            {'  '}
            {'Queried For'.padEnd(spotify_col)}
            {'  '}
            {'Info'.padEnd(meta_col)}
          </Text>
        </Box>

        {/* Rows */}
        {visible.map((r, vi) => {
          const real_idx = scroll_offset + vi
          const is_cursor = real_idx === cursor
          const is_checked = checked.has(real_idx)
          const file = effective_file(real_idx)
          const has_override = overrides.has(real_idx)

          const spotify_label = truncate(
            `${r.track.artists[0] ?? '?'} - ${r.track.title}`,
            spotify_col,
          ).padEnd(spotify_col)

          let file_col_str: string
          let meta_col_str: string
          let row_color: string | undefined
          let checkbox: string

          if (file) {
            const filename = slsk_filename(file.file)
            file_col_str = truncate(filename, file_col).padEnd(file_col)
            meta_col_str = truncate(file_meta(file), meta_col).padEnd(meta_col)
            row_color = is_checked ? 'green' : 'gray'
            checkbox = is_checked ? '✓ ' : '○ '
          } else {
            file_col_str = truncate('not found', file_col).padEnd(file_col)
            meta_col_str = ''.padEnd(meta_col)
            row_color = 'red'
            checkbox = '  '
          }

          const override_marker = has_override ? '*' : ' '
          const prefix = is_cursor ? '>' : ' '

          return (
            <Box key={real_idx} paddingX={1}>
              <Text
                color={is_cursor ? 'white' : row_color}
                bold={is_cursor}
                inverse={is_cursor}
                dimColor={!is_cursor && !file}
              >
                {prefix}{checkbox}{override_marker}{file_col_str}{'  '}{spotify_label}{'  '}{meta_col_str}
              </Text>
            </Box>
          )
        })}
      </Box>

      {results.length > page_size && (
        <Text color="gray" dimColor>
          Row {cursor + 1}/{results.length}
          {'  '}({scroll_offset + 1}–{Math.min(scroll_offset + page_size, results.length)} visible)
        </Text>
      )}

      <Box gap={3} marginTop={1}>
        <Text><Text color="green" bold>Enter</Text> download {checked_count}</Text>
        <Text><Text color="yellow">Space</Text> toggle</Text>
        <Text><Text color="yellow">R</Text> re-query</Text>
        <Text><Text color="yellow">A</Text> toggle all</Text>
        <Text><Text color="gray">Esc</Text> abort</Text>
      </Box>
      <Text color="gray" dimColor>* = manually selected file</Text>
    </Box>
  )
}
