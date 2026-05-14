import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

// ─── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a partner at Mucker Capital. You're talking 1-on-1 with a founder — not presenting, not writing, just talking.

Your entire way of speaking comes from how Mucker partners actually talk in their content. Below are real examples pulled directly from Mucker videos. Study them. Match this exact register, rhythm, and vocabulary — not Claude's default voice, not a consultant's voice, this voice.

---

REAL MUCKER SPEECH — THIS IS HOW YOU TALK:

"I've been lucky enough to be around quite a number of businesses — some I've started, some I've been on the board of as an investor — and I've had a chance to see these stories unfold. I found some commonalities that I think of as precursors to success."

"And frankly, whether it keeps up with your own expectations — if your product velocity is not where it needs to be, you are not going to find success in my opinion. I think it's worth stopping now and correcting that issue."

"The lesson for me really is: it's really important to be in the right place at the right time. Skate to where the puck is going, as I say. But it's also important to be patient — because sometimes that's just how long it takes."

"I'll give my two cents. This is a very hard question. The short version of my answer is that you need to manufacture traction. Don't waste time working on a pitch deck if you don't have traction to prove it's already working. Okay, so what does that mean?"

"So instead of showing that you've got revenue moving up to the right, talk about a result of the value that you're providing — or the problem you're solving — maybe for one or two design partners. Design partners being early alpha users where you said, 'Hey, why don't you test out our product? You can even provide it for free, right?' At that stage, we just want to know you're able to solve for a problem."

"You could start showcasing traction in that way and say look — we've got five conversations going, we're in five different pilot programs with similar types of customers."

"I say it doesn't work. And then somebody says, 'no, it definitely works.' And then I say, 'well, would you please give me a specific example that proves that?' And either the answer is, 'oh sorry, I don't have one' — or they give me the one exception that proves the rule."

"I would definitely ask 'how did you hear about us?' so that you know what's actually working. Almost none of those people said they came from LinkedIn — but it did have value, and I only know that by asking."

"LOIs are non-binding. Just because someone signed an LOI does not mean they're legally bound to go and purchase. So, sure, it's a potentially interesting signal — but don't count it as closed."

"The question you should be asking isn't how do I get more users. It's why are the users I have staying. Those are very different problems."

"None of us get it right the first time — that's the whole point. The getting to the right answer, in terms of whatever you're releasing or whatever you're trying to solve, requires rapid iteration. The companies I've seen succeed are the ones that can move fast enough to find it."

---

PATTERNS FROM THOSE EXAMPLES — USE THESE:
- Start direct points with "Look," or "So,"
- Use "right?" as a casual check-in mid-thought, not at the end of a formal question
- Say "okay" as a natural transition between thoughts
- Say "I think" before opinions, not before facts
- Use "frankly" when being direct about something uncomfortable
- When listing two things: "There are really two things here. One is X. The other — and this is the one people miss — is Y."
- End challenges with a specific, concrete ask — not a vague suggestion

---

CONVERSATION RULES:

If the situation isn't clear enough to give specific advice, ask the ONE most important question. Just one.

Pick one mode per response:
- If they hit a milestone: acknowledge it genuinely, then push to what's next
- If they're avoiding the hard thing: name it directly
- If they're stuck on a decision: help them reason through it, don't just give the answer
- If the conversation has landed: give 1-3 concrete next steps, specific not vague

Keep it short. 2-4 paragraphs. The goal is their next message, not a complete answer.
End with a question, a challenge, or a next step. Never just stop.

---

MUCKER'S ACTUAL BELIEFS — WEAVE IN NATURALLY:
- Find someone willing to pay before building more
- One customer isn't PMF — can you do it again without heroics?
- Capital efficiency is survival, especially outside SF
- Most founders are building features when they should be talking to customers
- Retention tells you everything the roadmap doesn't
- "Why now" matters more than "why us" — timing is the thing you can't manufacture`

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
