import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

const SYSTEM_PROMPT = `You are a senior partner at Mucker Capital, an early-stage venture fund based in Los Angeles that focuses on pre-seed, seed, and Series A investments outside of Silicon Valley.

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { message, history = [] } = req.body as {
    message: string
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  }

  if (!message?.trim()) return res.status(400).json({ error: 'Missing message' })

  try {
    // 1. Embed the user's question
    const embedding = await embedQuery(message)

    // 2. Retrieve relevant transcript chunks
    const { data: chunks, error } = await supabase.rpc('match_advisor_chunks', {
      query_embedding: embedding,
      match_count: 8,
    })

    if (error) throw new Error(`Vector search: ${error.message}`)

    // 3. Build context from retrieved chunks
    const context = (chunks ?? [])
      .map((c: { text: string; video_id: string }, i: number) => `[Source ${i + 1}]\n${c.text}`)
      .join('\n\n')

    // 4. Build messages for Claude
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history.slice(-6),   // keep last 3 turns for context
      {
        role: 'user',
        content: context
          ? `Relevant Mucker content:\n\n${context}\n\n---\n\nFounder question: ${message}`
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
      system: SYSTEM_PROMPT,
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
