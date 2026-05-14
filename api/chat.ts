import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

const BASE_SYSTEM_PROMPT = `You are a senior partner at Mucker Capital, an early-stage venture fund based in Los Angeles that focuses on pre-seed, seed, and Series A investments outside of Silicon Valley.

You are advising a founder who is in the Mucker portfolio or considering applying to MuckerLab. Your job is to give them clear, practical, honest business advice — exactly what a Mucker partner would say in a 1-on-1 meeting.

Mucker's core philosophy:
- Focus on capital efficiency and early revenue
- Prioritize finding repeatable sales motion before scaling
- Prefer founders who are deeply domain-expert and customer-obsessed
- Believe product-market fit is discovered through iteration, not planning
- Value unit economics and sustainable growth over hype metrics
- Invest in markets that are underserved, not overcrowded

When answering:
- Be direct and specific — no generic startup advice
- Reference insights from Mucker content when relevant (provided in context)
- Push back when a founder's thinking has gaps
- Ask clarifying questions if the situation is unclear
- Keep answers concise (3-5 paragraphs max) unless detail is truly needed`

function buildSystemPrompt(profile: Record<string, string> | null): string {
  if (!profile) return BASE_SYSTEM_PROMPT

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

  if (lines.length === 0) return BASE_SYSTEM_PROMPT

  return `${BASE_SYSTEM_PROMPT}

---

FOUNDER'S COMPANY PROFILE (use this as persistent context for all answers):
${lines.join('\n')}

You already know this context — do not ask the founder to repeat it. Tailor every answer specifically to their company, stage, and situation.`
}

async function embedQuery(text: string): Promise<number[]> {
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

async function fetchFounderProfile(userId: string): Promise<Record<string, string> | null> {
  const { data } = await supabase
    .from('founder_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()
  return data ?? null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { message, history = [], userId } = req.body as {
    message: string
    history: Array<{ role: 'user' | 'assistant'; content: string }>
    userId?: string
  }

  if (!message?.trim()) return res.status(400).json({ error: 'Missing message' })

  try {
    // 1. Fetch founder profile + embed question in parallel
    const [profile, embedding] = await Promise.all([
      userId ? fetchFounderProfile(userId) : Promise.resolve(null),
      embedQuery(message),
    ])

    // 2. Retrieve relevant transcript chunks
    const { data: chunks, error } = await supabase.rpc('match_advisor_chunks', {
      query_embedding: embedding,
      match_count: 8,
    })

    if (error) throw new Error(`Vector search: ${error.message}`)

    // 3. Build context from retrieved chunks
    const videoContext = (chunks ?? [])
      .map((c: { text: string }, i: number) => `[Source ${i + 1}]\n${c.text}`)
      .join('\n\n')

    // 4. Build messages for Claude
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history.slice(-6),
      {
        role: 'user',
        content: videoContext
          ? `Relevant Mucker content:\n\n${videoContext}\n\n---\n\nFounder question: ${message}`
          : message,
      },
    ]

    // 5. Stream response from Claude
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: buildSystemPrompt(profile),
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
