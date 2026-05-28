import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { PERSONA_PROMPTS } from './_personas.js'

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

// ─── Build system prompt with persona + founder profile ───────────────────────

function buildSystemPrompt(
  personaId: string,
  profile: Record<string, string> | null,
): string {
  const base = PERSONA_PROMPTS[personaId] ?? PERSONA_PROMPTS['partner']

  if (!profile) return base

  const lines: string[] = []
  if (profile.company_name)    lines.push(`Company: ${profile.company_name}`)
  if (profile.website)         lines.push(`Website: ${profile.website}`)
  if (profile.tagline)         lines.push(`One-liner: ${profile.tagline}`)
  if (profile.stage)           lines.push(`Stage: ${profile.stage}`)
  if (profile.team_size)       lines.push(`Team size: ${profile.team_size}`)
  if (profile.problem)         lines.push(`Problem they solve: ${profile.problem}`)
  if (profile.solution)        lines.push(`Product/solution: ${profile.solution}`)
  if (profile.target_customer) lines.push(`Target customer: ${profile.target_customer}`)
  if (profile.business_model)  lines.push(`Business model: ${profile.business_model}`)
  if (profile.revenue)         lines.push(`Revenue/traction: ${profile.revenue}`)
  if (profile.traction)        lines.push(`Other traction: ${profile.traction}`)
  if (profile.challenges)      lines.push(`Current challenges: ${profile.challenges}`)
  if (profile.extra_context)   lines.push(`Additional context: ${profile.extra_context}`)

  if (lines.length === 0 && !profile.file_context) return base

  const profileSection = lines.length > 0
    ? `WHAT YOU ALREADY KNOW ABOUT THIS FOUNDER (never ask them to repeat this — use it to make every answer specific):\n${lines.join('\n')}\n\nUse this actively. Generic advice is a waste of their time.`
    : ''

  const fileSection = profile.file_context
    ? `UPLOADED DATA FILES (financials, cap table, customer data, etc. — reference specific numbers when relevant):\n${profile.file_context}`
    : ''

  const sections = [profileSection, fileSection].filter(Boolean).join('\n\n---\n\n')

  return `${base}\n\n---\n\n${sections}`
}

// ─── Embedding ────────────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'voyage-3-lite', input: [text], output_dimension: 512 }),
  })
  const data = await res.json() as { data: Array<{ embedding: number[] }> }
  if (!data.data) throw new Error(`Voyage embed failed: ${JSON.stringify(data)}`)
  return data.data[0].embedding
}

// ─── Profile fetch ────────────────────────────────────────────────────────────

async function fetchFounderProfile(userId: string): Promise<Record<string, string> | null> {
  const { data } = await supabase
    .from('founder_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()
  return data ?? null
}

// ─── RAG retrieval ────────────────────────────────────────────────────────────

type Chunk = { text: string; similarity: number }

async function retrieveChunks(embedding: number[], count: number): Promise<Chunk[]> {
  const { data, error } = await supabase.rpc('match_advisor_chunks', {
    query_embedding: embedding,
    match_count: count,
  })
  if (error) throw new Error(`Vector search: ${error.message}`)
  return (data ?? []) as Chunk[]
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { message, history = [], userId, personaId = 'partner' } = req.body as {
    message: string
    history: Array<{ role: 'user' | 'assistant'; content: string }>
    userId?: string
    personaId?: string
  }

  if (!message?.trim()) return res.status(400).json({ error: 'Missing message' })

  try {
    // 1. Fetch profile + content embedding in parallel
    const styleQuery = `let me give you my honest take on this as an investor who's seen a lot of companies`

    const [profile, contentEmbedding] = await Promise.all([
      userId ? fetchFounderProfile(userId) : Promise.resolve(null),
      embed(message),
    ])

    // 2. Content retrieval first, then style embedding sequentially to respect rate limits
    const contentChunks = await retrieveChunks(contentEmbedding, 6)

    let styleChunks: Chunk[] = []
    try {
      const styleEmbedding = await embed(styleQuery)
      styleChunks = await retrieveChunks(styleEmbedding, 3)
    } catch {
      // Style retrieval is best-effort — if rate limited, proceed without it
    }

    // De-duplicate style chunks that overlap with content chunks
    const contentTexts = new Set(contentChunks.map(c => c.text))
    const uniqueStyleChunks = styleChunks.filter(c => !contentTexts.has(c.text))

    // 3. Build the context block
    const contentBlock = contentChunks
      .map((c, i) => `[${i + 1}] ${c.text}`)
      .join('\n\n')

    const styleBlock = uniqueStyleChunks
      .map(c => c.text)
      .join('\n\n')

    const contextBlock = [
      contentBlock ? `RELEVANT MUCKER KNOWLEDGE:\n${contentBlock}` : '',
      styleBlock   ? `EXAMPLES OF HOW MUCKER PARTNERS ACTUALLY TALK (mirror this register and rhythm in your response):\n${styleBlock}` : '',
    ].filter(Boolean).join('\n\n---\n\n')

    // 4. Build messages
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history.slice(-12),
      {
        role: 'user',
        content: contextBlock
          ? `${contextBlock}\n\n---\n\nFounder: ${message}`
          : message,
      },
    ]

    // 5. Stream from Claude
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: buildSystemPrompt(personaId, profile),
      messages,
    })

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Chat error:', msg)
    res.status(500).json({ error: msg })
  }
}
