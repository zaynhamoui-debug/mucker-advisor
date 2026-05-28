import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const PERSONA_FOCUS: Record<string, string> = {
  partner:   'VC investor perspective — funding readiness, traction, market size, PMF, founder-market fit, investor narrative, strategic decisions',
  marketing: 'marketing and growth — positioning, messaging, copywriting, channel strategy, CAC, brand, landing pages, go-to-market, content, SEO, paid',
  sales:     'sales coaching — discovery calls, pipeline, outbound, objection handling, closing, pricing conversations, demo structure, CRM hygiene',
  product:   'product strategy — roadmap prioritization, user research, feature decisions, retention, activation, metrics, user interviews, build vs. buy',
  legal:     'startup legal — equity splits, vesting, SAFEs, convertible notes, cap table, IP assignment, employment agreements, co-founder agreements',
  finance:   'startup finance — burn rate, runway, unit economics, CAC payback, LTV, gross margin, financial modelling, fundraising narrative, investor metrics',
}

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userId, personaId = 'partner' } = req.body as { userId?: string; personaId?: string }

  // Client already shows persona-specific defaults instantly; returning null tells it to keep them
  if (!userId) return res.json({ starters: null })

  try {
    const { data: profile } = await supabase
      .from('founder_profiles')
      .select('company_name,tagline,stage,team_size,problem,solution,target_customer,business_model,revenue,traction,challenges,extra_context')
      .eq('user_id', userId)
      .single()

    // Check if there's meaningful profile data
    const fields = ['company_name', 'problem', 'solution', 'target_customer', 'business_model', 'revenue', 'traction', 'challenges'] as const
    const hasContent = profile && fields.some(f => profile[f]?.trim())

    if (!hasContent) return res.json({ starters: null })

    // Build a compact profile summary
    const lines: string[] = []
    if (profile.company_name)    lines.push(`Company: ${profile.company_name}`)
    if (profile.tagline)         lines.push(`What they do: ${profile.tagline}`)
    if (profile.stage)           lines.push(`Stage: ${profile.stage}`)
    if (profile.team_size)       lines.push(`Team: ${profile.team_size}`)
    if (profile.problem)         lines.push(`Problem: ${profile.problem}`)
    if (profile.solution)        lines.push(`Solution: ${profile.solution}`)
    if (profile.target_customer) lines.push(`Customer: ${profile.target_customer}`)
    if (profile.business_model)  lines.push(`Business model: ${profile.business_model}`)
    if (profile.revenue)         lines.push(`Revenue/traction: ${profile.revenue}`)
    if (profile.traction)        lines.push(`Other traction: ${profile.traction}`)
    if (profile.challenges)      lines.push(`Current challenges: ${profile.challenges}`)
    if (profile.extra_context)   lines.push(`Extra: ${profile.extra_context}`)

    const summary = lines.join('\n')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: `You generate conversation starters for a founder advisory chat.

The advisor is a specialist in: ${PERSONA_FOCUS[personaId] ?? PERSONA_FOCUS['partner']}

STRICT RULE: Every starter must be directly relevant to the advisor's specialty above. Do not generate generic startup questions. If the advisor is a Sales Coach, every starter is about sales. If they're a Finance Advisor, every starter is about numbers, burn, fundraising, or unit economics. Stay in that lane.

Given the founder's company profile below, write exactly 5 short first-person conversation openers the founder would say to kick off a session with this advisor. Each should:
- Be specific to their actual company details (use their real product, stage, revenue, customer, challenge where relevant)
- Sound like a founder talking — conversational, a bit uncertain, not polished
- Be under 20 words
- Be about the advisor's specialty, not general startup advice

Return only a JSON array of 5 strings, nothing else.`,
      messages: [
        {
          role: 'user',
          content: `Founder profile:\n${summary}\n\nGenerate 5 starters for a ${PERSONA_FOCUS[personaId] ?? 'startup advisor'} session.`,
        },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''

    // Parse the JSON array
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return res.json({ starters: null })

    const starters = JSON.parse(match[0]) as string[]
    if (!Array.isArray(starters) || starters.length === 0) return res.json({ starters: null })

    return res.json({ starters: starters.slice(0, 5) })
  } catch (err) {
    console.error('Starters error:', err)
    return res.json({ starters: null })
  }
}
