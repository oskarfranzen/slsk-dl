/**
 * Normalize a search query for Soulseek.
 *
 * Goals:
 * - Strip parenthetical/bracketed annotations (feat., ft., with, remix, edit, remaster, etc.)
 * - Split multi-artist strings and keep only the primary artist
 * - Remove all non-alphanumeric characters
 * - Collapse whitespace, lowercase
 */

// Annotations to strip from track titles
const ANNOTATION_PATTERNS = [
  // featuring variants
  /\(?\bfeat\.?\s+[^)[\]]+\)?/gi,
  /\(?\bft\.?\s+[^)[\]]+\)?/gi,
  /\(?\bwith\s+[^)[\]]+\)?/gi,
  /\(?\bprod\.?\s+[^)[\]]+\)?/gi,
  // version/edition labels in parens or brackets
  /[\[(][^\])"]*\b(remix|edit|mix|version|remaster(?:ed)?|deluxe|extended|radio|original|live|acoustic|instrumental|explicit|clean|bonus|interlude|reprise|intro|outro|skit|demo|cover)\b[^\])"]*[\])]/gi,
  // any remaining empty parens/brackets
  /\(\s*\)/g,
  /\[\s*\]/g,
]

/**
 * Split an artist string that may contain multiple artists
 * joined by commas, ampersands, "x", "/" or feat. variants.
 * Returns the primary (first) artist only.
 */
function extract_primary_artist(artist: string): string {
  // Split on common multi-artist separators
  const parts = artist.split(/\s*[,&\/]\s*|\s+x\s+|\s+vs\.?\s+/i)
  return parts[0]?.trim() ?? artist
}

/**
 * Strip all non-alphanumeric characters (except spaces),
 * collapse whitespace, lowercase.
 */
function alphanumeric_only(s: string): string {
  return s
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export interface NormalizedQuery {
  /** The query to send to Soulseek first */
  primary: string
  /** Fallback: title only (if primary returns nothing) */
  title_only: string
}

export function normalize_query(artists: string[], title: string): NormalizedQuery {
  // Take the primary artist from the first listed artist
  const primary_artist = extract_primary_artist(artists[0] ?? '')

  // Strip annotations from title
  let clean_title = title
  for (const pattern of ANNOTATION_PATTERNS) {
    clean_title = clean_title.replace(pattern, '')
  }
  clean_title = clean_title.trim()

  const query_artist = alphanumeric_only(primary_artist)
  const query_title = alphanumeric_only(clean_title)

  return {
    primary: `${query_artist} ${query_title}`.trim(),
    title_only: query_title,
  }
}
