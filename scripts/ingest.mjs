/**
 * Ingestion script — fetches all Mucker Capital YouTube transcripts,
 * embeds them with Voyage AI, and stores them in Supabase pgvector.
 *
 * Run: node scripts/ingest.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { YoutubeTranscript } from 'youtube-transcript'
import 'dotenv/config'

const SUPABASE_URL        = process.env.SUPABASE_URL            ?? ''
const SUPABASE_KEY        = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const VOYAGE_API_KEY      = process.env.VOYAGE_API_KEY          ?? ''
const YOUTUBE_API_KEY     = process.env.YOUTUBE_API_KEY         ?? ''
const CHANNEL_ID          = process.env.YOUTUBE_CHANNEL_ID      ?? ''

const CHUNK_SIZE    = 800  // target chars per chunk (~200 tokens)
const CHUNK_OVERLAP = 100  // overlap between chunks
const BATCH_SIZE    = 16   // embeddings per Voyage API call
const MIN_MS_BETWEEN_EMBED_CALLS = 21_000  // 3 RPM free tier = 1 per 20s (21s to be safe)

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Rate limiter for Voyage API
let lastEmbedCall = 0
async function rateLimitedEmbed(texts) {
  const now = Date.now()
  const wait = MIN_MS_BETWEEN_EMBED_CALLS - (now - lastEmbedCall)
  if (wait > 0) {
    process.stdout.write(` (waiting ${Math.ceil(wait/1000)}s)`)
    await new Promise(r => setTimeout(r, wait))
  }
  lastEmbedCall = Date.now()
  return embedBatch(texts)
}

// ── 1. Fetch all video IDs from the channel ──────────────────────────────────

async function fetchAllVideoIds() {
  const videos = []
  let pageToken = ''

  console.log(`Fetching videos from channel ${CHANNEL_ID}...`)

  while (true) {
    const url = new URL('https://www.googleapis.com/youtube/v3/search')
    url.searchParams.set('part', 'id,snippet')
    url.searchParams.set('channelId', CHANNEL_ID)
    url.searchParams.set('type', 'video')
    url.searchParams.set('maxResults', '50')
    url.searchParams.set('key', YOUTUBE_API_KEY)
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url)
    const data = await res.json()

    if (data.error) throw new Error(`YouTube API: ${data.error.message}`)

    for (const item of data.items ?? []) {
      videos.push({
        id:          item.id.videoId,
        title:       item.snippet.title,
        published_at: item.snippet.publishedAt,
      })
    }

    if (data.nextPageToken) {
      pageToken = data.nextPageToken
    } else {
      break
    }
  }

  console.log(`Found ${videos.length} videos`)
  return videos
}

// ── 2. Fetch transcript for a single video ───────────────────────────────────

async function fetchTranscript(videoId) {
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId)
    return items.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim()
  } catch {
    return null   // some videos have transcripts disabled
  }
}

// ── 3. Split text into overlapping chunks ────────────────────────────────────

function chunkText(text) {
  const chunks = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length)
    chunks.push(text.slice(start, end).trim())
    if (end === text.length) break
    start += CHUNK_SIZE - CHUNK_OVERLAP
  }
  return chunks.filter(c => c.length > 80)  // skip tiny trailing chunks
}

// ── 4. Embed a batch of texts via Voyage AI ──────────────────────────────────

async function embedBatch(texts, retries = 5) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voyage-3-lite',
      input: texts,
      output_dimension: 512,
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Voyage API: ${JSON.stringify(data.error)}`)
  if (!data.data) {
    // Rate limited — wait 65s and retry
    if (retries > 0) {
      process.stdout.write(` [rate limited, waiting 65s...]`)
      await new Promise(r => setTimeout(r, 65_000))
      lastEmbedCall = 0  // reset so next call goes immediately
      return embedBatch(texts, retries - 1)
    }
    throw new Error(`Voyage unexpected response: ${JSON.stringify(data)}`)
  }
  return data.data.map(d => d.embedding)
}

// ── 5. Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !VOYAGE_API_KEY || !YOUTUBE_API_KEY || !CHANNEL_ID) {
    throw new Error('Missing required env vars — check .env')
  }

  // Fetch channel videos
  const videos = await fetchAllVideoIds()

  // Check which videos are already ingested
  const { data: existing } = await supabase
    .from('advisor_videos')
    .select('id')
  const existingIds = new Set((existing ?? []).map(r => r.id))

  let totalChunks = 0

  for (const video of videos) {
    if (existingIds.has(video.id)) {
      console.log(`  skip (already ingested): ${video.title}`)
      continue
    }

    process.stdout.write(`  fetching transcript: ${video.title.slice(0, 60)}... `)
    const transcript = await fetchTranscript(video.id)

    if (!transcript) {
      console.log('no transcript')
      continue
    }

    const chunks = chunkText(transcript)
    console.log(`${chunks.length} chunks`)

    // Insert video record first
    await supabase.from('advisor_videos').upsert({
      id:          video.id,
      title:       video.title,
      published_at: video.published_at,
    })

    // Embed chunks in batches and insert
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      const embeddings = await rateLimitedEmbed(batch)

      const rows = batch.map((text, j) => ({
        video_id:    video.id,
        chunk_index: i + j,
        text,
        embedding:   JSON.stringify(embeddings[j]),
      }))

      const { error } = await supabase.from('advisor_chunks').insert(rows)
      if (error) console.error('  insert error:', error.message)

      process.stdout.write('.')
    }
    console.log()

    totalChunks += chunks.length
  }

  console.log(`\nDone! Ingested ${totalChunks} chunks across ${videos.length} videos.`)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
