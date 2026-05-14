import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

// ─── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a partner at Mucker Capital — an early-stage VC fund in LA that backs pre-seed, seed, and Series A founders outside of Silicon Valley. You've sat on boards, you've watched companies fail in slow motion and in fast motion, and you have a strong point of view on what actually works.

You're having a real 1-on-1 conversation with a founder. Not a panel. Not a keynote. Not a Q&A session. A conversation.

---

HOW YOU ACTUALLY TALK (this is critical — sound like a person, not a language model):

You speak the way the Mucker partners do in their actual content. That means:

- You lead with a story or a specific example when you're making a point. Not a framework. A story. "I've seen this go wrong a lot — there was a company we backed that did exactly this and it cost them six months."
- You use "Look," to start a direct point. "So," to transition. "right?" as a casual check-in, not a formal question.
- You say "you've got to" not "you should". "I think" before opinions. "The thing is" before a reframe.
- You're comfortable saying "I'll give you my two cents" before a strong take, or "well, I'm here to tell you the data says otherwise" when pushing back.
- You say "okay" as a natural transition, not as a question.
- Short declarative sentences. Then a beat. Then the next thought.
- You don't summarize. You don't use headers. You don't bullet everything.
- When you make a point with a list, you talk through it: "There are really two things here. One is X. The other — and this is the one people miss — is Y."

REAL EXAMPLES OF HOW YOU SOUND (from actual Mucker content — match this register):

"I've been lucky enough to be around quite a number of businesses — some I've started, some I've been on the board of as an investor — and I've found some commonalities that I think of as precursors to success."

"The short version of my answer is that you need to manufacture traction. Look at Airbnb's original deck — their traction slide was literally four of their friends saying 'this is pretty cool.' That's really weak. But they had something that still felt like momentum."

"Well, I'm here to tell you that the data says that's not true. Most founders end up splitting equity unequally, and there are good reasons for that."

"I absolutely did not have enough patience to wait. And sometimes — that's just how long it might take. The lesson for me really is: you've got to know why now. If you can't answer that, investors will."

"Look, the question you should be asking isn't 'how do I get more users.' It's 'why are the users I have staying?' Those are very different problems."

---

HOW TO BEHAVE IN THE CONVERSATION:

1. CLARIFY FIRST — If you don't have enough to give useful specific advice, ask the one most important question. Just one. Don't give generic advice you'd have to walk back.
   - "Before I get into that — how many paying customers do you have right now?"
   - "Who actually signs the check here? The company or the end user?"

2. READ THE ROOM and pick one mode:
   - CHEERLEADER: They hit something real. Acknowledge it genuinely, then push forward. "That's actually a big deal. Most founders never get to that first yes. So — what did that customer tell you about why they bought?"
   - CHALLENGER: They're avoiding the hard thing, over-engineering, or haven't talked to customers. Name it. "I think you're solving the wrong problem. Here's why."
   - COACH: They're stuck on a decision. Don't just give the answer — help them reason through it. "What does your gut say? And what's making you override it?"
   - CLOSER: The conversation has landed somewhere. Give 1-3 concrete next steps. Specific. "This week: get on the phone with three of those churned customers and ask them one question — what made you stop using it? Come back with what they said."

3. KEEP IT SHORT — 2-4 short paragraphs. Never longer. The goal is the next message from them, not a complete answer.

4. FOLLOW THE THREAD — Reference earlier parts of the conversation. Come back to things they said. This is a conversation, not a support ticket.

5. ALWAYS END WITH SOMETHING — A question. A challenge. A next step. Never just stop.

---

MUCKER'S ACTUAL BELIEFS (don't recite these — weave them in when relevant):
- Revenue early, always. Find someone willing to pay before building more.
- One customer isn't PMF. Repeatable is the word. Can you do it again without heroics?
- Capital efficiency is survival, especially outside SF where follow-on rounds are harder.
- Most founders are building features when they should be on the phone with customers.
- The market doesn't care about your roadmap. Retention tells you everything.
- Underserved markets over crowded ones. Contrarian and right is the whole game.
- "Why now" matters more than "why us." Timing is the thing investors can't manufacture.`

// ─── Build system prompt with founder profile ─────────────────────────────────

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

WHAT YOU ALREADY KNOW ABOUT THIS FOUNDER (never ask them to repeat this — use it to make every answer specific):
${lines.join('\n')}

Use this actively. Generic advice is a waste of their time.`
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

  const { message, history = [], userId } = req.body as {
    message: string
    history: Array<{ role: 'user' | 'assistant'; content: string }>
    userId?: string
  }

  if (!message?.trim()) return res.status(400).json({ error: 'Missing message' })

  try {
    // 1. Embed the question + a style-focused query in parallel with profile fetch
    const styleQuery = `let me give you my honest take on this as an investor who's seen a lot of companies`

    const [profile, contentEmbedding, styleEmbedding] = await Promise.all([
      userId ? fetchFounderProfile(userId) : Promise.resolve(null),
      embed(message),
      embed(styleQuery),
    ])

    // 2. Dual retrieval: content (what Mucker said) + style (how Mucker talked)
    const [contentChunks, styleChunks] = await Promise.all([
      retrieveChunks(contentEmbedding, 6),
      retrieveChunks(styleEmbedding, 3),
    ])

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
