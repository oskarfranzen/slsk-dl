import React from 'react'
import { Box, Text, useInput } from 'ink'
import { type DownloadResult } from './DownloadProgress.js'
import { join } from 'path'

interface Props {
  downloads: DownloadResult[]
  playlist_name: string
  output_dir: string
  not_found_count: number
}

export function Summary({ downloads, playlist_name, output_dir, not_found_count }: Props) {
  useInput((_input, key) => {
    if (key.escape) process.exit(0)
  })

  const succeeded = downloads.filter((d) => d.state.status === 'done')
  const failed = downloads.filter((d) => d.state.status === 'failed')
  const dir = join(output_dir, playlist_name.replace(/[/\\:*?"<>|]/g, '_').trim())

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text bold color="green">Download complete</Text>

      <Text>
        Downloaded to: <Text color="cyan">{dir}</Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text color="green">✓ {succeeded.length} succeeded</Text>
        {succeeded.map((d, i) => (
          <Box key={i} flexDirection="column">
            <Text color="green">
              {'    '}{d.track.track.artists[0]} - {d.track.track.title}
            </Text>
            {d.state.status === 'done' && (
              <Text color="gray" dimColor>{'      '}{d.state.path}</Text>
            )}
          </Box>
        ))}

        {failed.length > 0 && (
          <>
            <Text color="red" bold>✗ {failed.length} failed:</Text>
            {failed.map((d, i) => (
              <Box key={i} flexDirection="column">
                <Text color="red" dimColor>
                  {'    '}{d.track.track.artists[0]} - {d.track.track.title}
                  {d.state.status === 'failed' && (
                    <Text color="gray"> — {d.state.error}{d.state.attempts > 1 ? ` (${d.state.attempts} attempts)` : ''}</Text>
                  )}
                </Text>
              </Box>
            ))}
          </>
        )}

        {not_found_count > 0 && (
          <Text color="gray">○ {not_found_count} not found on Soulseek</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>Press Esc to exit</Text>
      </Box>
    </Box>
  )
}
