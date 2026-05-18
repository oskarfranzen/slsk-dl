import { mkdir } from "fs/promises";
import { dirname } from "path";
import slsk from "slsk-client";
import { config } from "./config.js";

// slsk-client uses callbacks — we promisify it here

export interface SlskFile {
	user: string;
	file: string;
	size: number;
	slots: boolean;
	bitrate?: number;
	speed?: number;
}

interface SlskClient {
	search(
		opts: { req: string; timeout?: number },
		cb: (err: Error | null, res: SlskFile[]) => void,
	): void;
	download(
		opts: { file: SlskFile; path: string },
		cb: (err: Error | null, data: { buffer: Buffer }) => void,
	): void;
}

let _client: SlskClient | null = null;

export async function connect_slsk(): Promise<SlskClient> {
	if (_client) return _client;
	return new Promise((resolve, reject) => {
		slsk.connect(
			{ user: config.slsk.user, pass: config.slsk.pass },
			(err: Error | null, client: SlskClient) => {
				if (err) return reject(err);
				_client = client;
				resolve(client);
			},
		);
	});
}

// ─── File scoring ─────────────────────────────────────────────────────────────

const AUDIO_EXTENSIONS = /\.(mp3|flac|ogg|aac|m4a|opus|wav)$/i;
const FLAC_EXT = /\.flac$/i;
const MP3_EXT = /\.mp3$/i;

function score_file(file: SlskFile, format: "flac" | "mp3" | "any"): number {
	if (!file.slots) return -1;
	if (!AUDIO_EXTENSIONS.test(file.file)) return -1;

	let score = 0;

	// Format preference
	if (format === "flac") {
		if (FLAC_EXT.test(file.file)) score += 1000;
	} else if (format === "mp3") {
		if (MP3_EXT.test(file.file)) score += 1000;
	} else {
		// 'any': prefer MP3 320 over FLAC over other MP3
		if (MP3_EXT.test(file.file) && (file.bitrate ?? 0) >= 320) score += 900;
		else if (FLAC_EXT.test(file.file)) score += 800;
		else if (MP3_EXT.test(file.file)) score += 700;
	}

	// Bitrate contribution (0–320 => 0–320 pts)
	score += Math.min(file.bitrate ?? 0, 320);

	// Speed contribution (capped at reasonable value)
	score += Math.min((file.speed ?? 0) / 10000, 100);

	// Penalise peers below the minimum speed threshold (still usable as last resort)
	if (file.speed !== undefined && file.speed < config.minSpeed) {
		score -= 500;
	}

	return score;
}

export function pick_best_result(results: SlskFile[]): SlskFile | null {
	const scored = results
		.map((f) => ({ file: f, score: score_file(f, config.format) }))
		.filter((x) => x.score >= 0)
		.sort((a, b) => b.score - a.score);
	return scored[0]?.file ?? null;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function search_slsk(
	query: string,
	timeout = 5000,
): Promise<SlskFile[]> {
	const client = await connect_slsk();
	return new Promise((resolve) => {
		client.search({ req: query, timeout }, (_err, res) => {
			resolve(res ?? []);
		});
	});
}

export interface SearchResult {
	found: true;
	file: SlskFile;
	query: string;
}

export interface SearchMiss {
	found: false;
	query: string;
}

export async function search_track(
	primary_query: string,
	title_only_query: string,
): Promise<SearchResult | SearchMiss> {
	// Attempt 1: primary query (artist + title)
	const results1 = await search_slsk(primary_query);
	const best1 = pick_best_result(results1);
	if (best1) return { found: true, file: best1, query: primary_query };

	// Attempt 2: title only
	const results2 = await search_slsk(title_only_query);
	const best2 = pick_best_result(results2);
	if (best2) return { found: true, file: best2, query: title_only_query };

	return { found: false, query: primary_query };
}

// ─── Download ─────────────────────────────────────────────────────────────────

// Errors from slsk-client that indicate the peer is gone — not worth retrying the same file
const USER_OFFLINE_PATTERNS = [
  /user not exist/i,
  /user.*(offline|not found|unavailable)/i,
  /cannot connect/i,
  /peer.*not.*connected/i,
  /connection.*refused/i,
]

function is_user_offline_error(err: unknown): boolean {
  const msg = String(err)
  return USER_OFFLINE_PATTERNS.some((p) => p.test(msg))
}

export async function download_file(
	file: SlskFile,
	dest_path: string,
	timeout_ms = 60_000,
): Promise<void> {
	const client = await connect_slsk();
	await mkdir(dirname(dest_path), { recursive: true });

	return new Promise((resolve, reject) => {
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new Error(`Download timed out after ${timeout_ms / 1000}s`));
		}, timeout_ms);

		client.download({ file, path: dest_path }, (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (err) return reject(err);
			resolve();
		});
	});
}

export interface DownloadAttempt {
  file: SlskFile
  error: string
}

export interface DownloadWithFallbackResult {
  status: 'done'
  file: SlskFile
  path: string
  retries: DownloadAttempt[]
}

/**
 * Download a track with automatic fallback:
 * - If the chosen file fails with a "user offline" type error, re-search and
 *   try the next best result from a different user, up to `max_retries` times.
 * - Non-offline errors (e.g. timeout) are retried once with a fresh search,
 *   then treated as fatal.
 */
export async function download_with_fallback(
  initial_file: SlskFile,
  query: string,
  dest_path: string,
  timeout_ms = 60_000,
  max_retries = 5,
  on_retry?: (attempt: number, failed_user: string, reason: string) => void,
): Promise<DownloadWithFallbackResult> {
  const failed_attempts: DownloadAttempt[] = []
  const failed_users = new Set<string>()

  let current_file = initial_file

  for (let attempt = 0; attempt <= max_retries; attempt++) {
    try {
      await download_file(current_file, dest_path, timeout_ms)
      return { status: 'done', file: current_file, path: dest_path, retries: failed_attempts }
    } catch (err) {
      const error_str = String(err)
      failed_attempts.push({ file: current_file, error: error_str })
      failed_users.add(current_file.user)

      // On last attempt, give up
      if (attempt === max_retries) break

      // Notify caller that we're retrying
      on_retry?.(attempt + 1, current_file.user, error_str)

      // Re-search, excluding all users that have already failed
      const results = await search_slsk(query, 5000)
      const next = pick_best_result(
        results.filter((f) => !failed_users.has(f.user))
      )

      if (!next) break  // no alternative peers found

      current_file = next
    }
  }

  const last = failed_attempts[failed_attempts.length - 1]!
  throw Object.assign(
    new Error(last.error),
    { retries: failed_attempts }
  )
}

export function get_extension(file_path: string): string {
	const match = file_path.match(/\.([a-zA-Z0-9]+)$/);
	return match ? `.${match[1]!.toLowerCase()}` : ".mp3";
}

export function format_size(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
