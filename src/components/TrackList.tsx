import React from 'react'
import { Box, Text, useInput } from 'ink'
import { type SpotifyTrack } from '../spotify.js'

interface Props {
  playlist_name: string
  tracks: SpotifyTrack[]
  onConfirm: () => void
  onBack: () => void
}

export function TrackList({ playlist_name, tracks, onConfirm, onBack }: Props) {
  useInput((_input, key) => {
    if (key.return) onConfirm()
    if (key.escape) onBack()
  })

  const preview = tracks.slice(0, 8)

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text bold color="green">{playlist_name}</Text>
      <Text color="gray">{tracks.length} tracks</Text>

      <Box flexDirection="column" marginTop={1}>
        {preview.map((t, i) => (
          <Text key={t.id + i} color="gray">
            <Text color="white">{i + 1}. {t.artists[0]} - {t.title}</Text>
          </Text>
        ))}
        {tracks.length > 8 && (
          <Text color="gray">  ...and {tracks.length - 8} more</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text>
          Press <Text color="green" bold>Enter</Text> to search Soulseek for all tracks
          {'  '}
          <Text color="gray">Esc to go back</Text>
        </Text>
      </Box>
    </Box>
  )
}
