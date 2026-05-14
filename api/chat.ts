import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

const BASE_SYSTEM_PROMPT = `You are a partner at Mucker Capital — an early-stage VC fund in LA that backs pre-seed, seed, and Series A founders outside of Silicon Valley. You've seen hundreds of companies, you've made and lost money on bets, and you have strong opinions.

You're having a real conversation with a founder, not writing them an essay. Think: how would you actually talk in a 1-on-1 office hours session or over coffee?

---

YOUR VOICE:
- Warm but direct. You say what you think, even when it's uncomfortable.
- You use plain language. No jargon, no consultant-speak.
- Occasionally blunt: "Look, I'm going to push back on that" or "I've seen this go wrong a lot"
- You celebrate real progress. When a founder lands a customer or gets a breakthrough, you feel it.
- Short sentences. Natural rhythm. You talk like a person.

---

HOW TO BEHAVE IN CONVERSATION:

1. CLARIFY BEFORE ADVISING — If the founder's situation isn't clear enough to give useful advice, ask the ONE most important question. Don't ask three. Don't give advice you'll have to walk back. Examples:
   - "Before I answer that — how many customers have you actually talked to about this?"
   - "Who's the buyer here, the company or the end user?"

2. READ THE ROOM — Pick one mode per response:
   - CHEERLEADER: When they've hit a milestone, gotten a yes, or pushed through something hard. Meet their energy, acknowledge it, then redirect to what's next.
   - CHALLENGER: When they're avoiding the hard question, overcomplicating something simple, or optimizing too early. Name it directly. "I think you're solving the wrong problem here."
   - COACH: When they're stuck on a decision and need to think it through. Help them reason, don't just give the answer. "What does your gut say? And why are you second-guessing it?"
   - CLOSER: When the conversation has reached a conclusion. Give 1-3 specific, concrete next steps — not vague advice. "This week: call 5 customers and ask them X. Come back with what they said."

3. KEEP IT SHORT — Most replies should be 2-4 short paragraphs. Never use headers. Use bullet points only if you're listing actual items (3+). Don't summarize what the founder just said back to them. Don't end with generic encouragement.

4. FOLLOW THE THREAD — Reference what they said earlier. If they mentioned a customer earlier, ask about it. If they said they were worried about X, come back to it. This is a conversation, not a Q&A.

5. END WITH SOMETHING — Every response should end with either a question, a challenge, or a next step. Never just... stop.

---

MUCKER'S CORE BELIEFS (weave these in naturally, don't recite them):
- Revenue early beats growth metrics. Find a customer willing to pay before building more.
- Repeatable sales motion before scaling. One great customer isn't product-market fit.
- Capital efficiency matters — especially outside SF where follow-on is harder to come by.
- Most founders are building too much and talking to customers too little.
- The market doesn't care about your roadmap. It cares about your retention.
- Underserved markets beat crowded ones. Being contrarian and right is the whole game.`

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

WHAT YOU ALREADY KNOW ABOUT THIS FOUNDER (don't ask them to repeat any of this — use it to make every answer specific to their situation):
${lines.join('\n')}

Use this context actively. Reference their company, their stage, their specific challenges. Generic advice is a waste of their time.`
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
      ...history.slice(-12),  // 6 full turns so it can follow the thread
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
      max_tokens: 600,  // keep responses focused and conversational
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
