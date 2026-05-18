import { config as loadDotenv } from 'dotenv'
import { homedir } from 'os'
import { join } from 'path'

loadDotenv()

function require_env(key: string): string {
  const val = process.env[key]
  if (!val) {
    console.error(`Missing required environment variable: ${key}`)
    console.error(`Copy .env.example to .env and fill in your credentials.`)
    process.exit(1)
  }
  return val
}

function parse_args() {
  const args = process.argv.slice(2)
  const opts: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      opts.output = args[++i]
    } else if (args[i] === '--format' && args[i + 1]) {
      opts.format = args[++i]
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      opts.concurrency = args[++i]
    } else if (args[i] === '--min-speed' && args[i + 1]) {
      opts.minSpeed = args[++i]
    }
  }
  return opts
}

const args = parse_args()

export const config = {
  slsk: {
    user: require_env('SLSK_USER'),
    pass: require_env('SLSK_PASS'),
  },
  spotify: {
    clientId: require_env('SPOTIFY_CLIENT_ID'),
    clientSecret: require_env('SPOTIFY_CLIENT_SECRET'),
    redirectUri: process.env['SPOTIFY_REDIRECT_URI'] ?? 'http://127.0.0.1:8888/callback',
  },
  outputDir: args.output
    ?? process.env['OUTPUT_DIR']
    ?? join(homedir(), 'Music', 'slsk-downloads'),
  format: (args.format ?? 'any') as 'flac' | 'mp3' | 'any',
  concurrency: parseInt(args.concurrency ?? '3', 10),
  // Minimum peer speed in bytes/s to consider for auto-selection (default 100 KB/s).
  // Peers below this threshold get a heavy score penalty but are still usable as fallback.
  minSpeed: parseInt(args.minSpeed ?? process.env['MIN_SPEED'] ?? String(500 * 1024), 10),
  tokenPath: join(homedir(), '.config', 'slsk-playlist-dl', 'spotify-tokens.json'),
}
