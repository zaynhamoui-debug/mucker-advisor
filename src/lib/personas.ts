export interface Persona {
  id: string
  name: string
  icon: string
  tagline: string
  defaultStarters: string[]
}

export const PERSONAS: Persona[] = [
  {
    id: 'partner',
    name: 'Mucker Partner',
    icon: 'M',
    tagline: 'VC investor — big picture, funding, strategy',
    defaultStarters: [
      "I'm not sure if what I'm seeing is real traction or just noise — can you help me think through it?",
      "We've been building for 3 months and haven't charged anyone. Is that a problem?",
      "I keep getting told my market is too small. Am I thinking about this wrong?",
      "I'm stuck between two very different directions for the product. Talk me through it?",
      "How do I know when I actually have product-market fit, not just friendly early customers?",
    ],
  },
  {
    id: 'marketing',
    name: 'Marketing Expert',
    icon: '📣',
    tagline: 'Positioning, channels & growth strategy',
    defaultStarters: [
      "Our website isn't converting and I don't know if it's a messaging problem or a traffic problem.",
      "We have no idea which marketing channel to bet on first — where do we even start?",
      "I've been told our positioning is too broad but I don't know how to narrow it without losing customers.",
      "We're getting some organic traffic but it's not converting. What should I look at first?",
      "How do I write copy that actually sounds like it's talking to my customer and not just describing features?",
    ],
  },
  {
    id: 'sales',
    name: 'Sales Coach',
    icon: '🤝',
    tagline: 'Pipeline, discovery & closing deals',
    defaultStarters: [
      "I have a promising demo next week and I don't know how to structure the conversation.",
      "Deals keep stalling after the first meeting and I can't figure out why.",
      "I'm a technical founder and selling feels unnatural — where do I even start?",
      "How do I handle it when a prospect says 'we'll revisit in Q3' and I know they mean never?",
      "I'm getting meetings but nothing is converting to pipeline. What am I missing?",
    ],
  },
  {
    id: 'product',
    name: 'Product Strategist',
    icon: '🧭',
    tagline: 'Roadmap, prioritization & user research',
    defaultStarters: [
      "I have a list of 20 features customers have asked for and no idea how to prioritize them.",
      "We shipped something users said they wanted and nobody is using it. What went wrong?",
      "I feel like we're building but not making progress — how do I know if we're working on the right things?",
      "How do I run user interviews without just hearing people tell me what I want to hear?",
      "Our retention is dropping and I don't know if it's a product problem or an expectations problem.",
    ],
  },
  {
    id: 'legal',
    name: 'Legal Advisor',
    icon: '⚖️',
    tagline: 'Equity, structure & startup law basics',
    defaultStarters: [
      "We have a co-founder joining late and I don't know how to handle their equity fairly.",
      "Someone wants to invest but only via a convertible note — should I push back for a SAFE instead?",
      "We're bringing on our first employee and I don't know what a standard offer letter should include.",
      "A big company wants to pilot our product — what should I watch out for in their contract?",
      "We never did IP assignment paperwork at the start. How big of a problem is that now?",
    ],
  },
  {
    id: 'finance',
    name: 'Finance Advisor',
    icon: '📊',
    tagline: 'Unit economics, fundraising & runway',
    defaultStarters: [
      "I have 8 months of runway and I don't know if I should be raising now or cutting burn.",
      "An investor asked for our unit economics and I'm not sure I'm calculating CAC correctly.",
      "We're profitable on some customers and losing money on others — how do I think about this?",
      "I'm building a financial model for our seed round and don't know what assumptions investors will push on.",
      "How do I figure out what our business is actually worth at this stage?",
    ],
  },
]

export const DEFAULT_PERSONA_ID = 'partner'

export function getPersona(id: string): Persona {
  return PERSONAS.find(p => p.id === id) ?? PERSONAS[0]
}
