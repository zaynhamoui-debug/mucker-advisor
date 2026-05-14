import { useState, useEffect, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface Profile {
  company_name:    string
  website:         string
  tagline:         string
  stage:           string
  team_size:       string
  problem:         string
  solution:        string
  target_customer: string
  business_model:  string
  revenue:         string
  traction:        string
  challenges:      string
  extra_context:   string
}

const EMPTY: Profile = {
  company_name: '', website: '', tagline: '', stage: '', team_size: '',
  problem: '', solution: '', target_customer: '', business_model: '',
  revenue: '', traction: '', challenges: '', extra_context: '',
}

const STAGES = ['Idea', 'Pre-seed', 'Seed', 'Series A', 'Series B+', 'Bootstrapped']

const FIELDS: Array<{
  key: keyof Profile
  label: string
  placeholder: string
  multiline?: boolean
  tip?: string
}> = [
  { key: 'company_name',    label: 'Company Name',       placeholder: 'Acme Inc.' },
  { key: 'website',         label: 'Website',             placeholder: 'https://acme.com' },
  { key: 'tagline',         label: 'One-liner',           placeholder: 'What your company does in one sentence' },
  { key: 'problem',         label: 'Problem',             placeholder: 'What problem are you solving? Who feels this pain?', multiline: true },
  { key: 'solution',        label: 'Solution / Product',  placeholder: 'What do you build and how does it solve the problem?', multiline: true },
  { key: 'target_customer', label: 'Target Customer',     placeholder: 'Who exactly buys this? Be specific — job title, company size, industry', multiline: true },
  { key: 'business_model',  label: 'Business Model',      placeholder: 'How do you make money? SaaS, marketplace, usage-based, services…', multiline: true },
  { key: 'revenue',         label: 'Revenue / Traction',  placeholder: 'MRR, ARR, # of customers, growth rate, pilot status…' },
  { key: 'traction',        label: 'Other Traction',      placeholder: 'Waitlist, LOIs, partnerships, press, notable customers…', multiline: true },
  { key: 'challenges',      label: 'Current Challenges',  placeholder: 'What are your biggest blockers or open questions right now?', multiline: true },
  { key: 'extra_context',   label: 'Anything Else',       placeholder: 'Competitive landscape, previous pivots, co-founders, anything the advisor should know…', multiline: true },
]

export default function Profile({ user, onBack }: { user: User; onBack: () => void }) {
  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [saved, setSaved]     = useState(false)
  const [saving, setSaving]   = useState(false)
  const [loaded, setLoaded]   = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    supabase
      .from('founder_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          const { id: _id, user_id: _uid, updated_at: _ua, ...rest } = data as Record<string, string>
          setProfile({ ...EMPTY, ...rest })
        }
        setLoaded(true)
      })
  }, [user.id])

  function handleChange(key: keyof Profile, value: string) {
    setProfile(prev => ({ ...prev, [key]: value }))
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => autosave({ ...profile, [key]: value }), 800)
  }

  async function autosave(data: Profile) {
    setSaving(true)
    await supabase.from('founder_profiles').upsert(
      { user_id: user.id, ...data, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    setSaving(false)
    setSaved(true)
  }

  if (!loaded) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex gap-1.5">
          {[0, 150, 300].map(d => (
            <span key={d} className="w-2 h-2 bg-amber-500/40 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">

      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between gap-3 sticky top-0 bg-[#0a0a0f]/95 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
            <span className="text-amber-400 text-sm font-bold">M</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white leading-none">Company Profile</h1>
            <p className="text-xs text-white/40 mt-0.5">This context shapes every answer you get</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-xs text-white/30">Saving…</span>}
          {saved && !saving && <span className="text-xs text-emerald-400">✓ Saved</span>}
          <button
            onClick={onBack}
            className="text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all"
          >
            ← Back to chat
          </button>
        </div>
      </header>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="max-w-2xl mx-auto flex flex-col gap-8">

          {/* Intro */}
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl px-5 py-4">
            <p className="text-sm text-amber-400/80 leading-relaxed">
              Fill this in once. Mucker Advisor will use it as context for every conversation — no need to re-explain your company each time.
            </p>
          </div>

          {/* Stage selector */}
          <div>
            <label className="block text-xs text-white/40 uppercase tracking-widest mb-3">Stage</label>
            <div className="flex flex-wrap gap-2">
              {STAGES.map(s => (
                <button
                  key={s}
                  onClick={() => handleChange('stage', s)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                    profile.stage === s
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                      : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Team size */}
          <div>
            <label className="block text-xs text-white/40 uppercase tracking-widest mb-3">Team Size</label>
            <div className="flex flex-wrap gap-2">
              {['Solo founder', '2', '3–5', '6–10', '11–25', '25+'].map(s => (
                <button
                  key={s}
                  onClick={() => handleChange('team_size', s)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                    profile.team_size === s
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                      : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Text fields */}
          {FIELDS.filter(f => f.key !== 'stage' && f.key !== 'team_size').map(({ key, label, placeholder, multiline }) => (
            <div key={key}>
              <label className="block text-xs text-white/40 uppercase tracking-widest mb-2">{label}</label>
              {multiline ? (
                <textarea
                  value={profile[key]}
                  onChange={e => handleChange(key, e.target.value)}
                  placeholder={placeholder}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 focus:border-amber-500/30 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none resize-none transition-colors leading-relaxed"
                />
              ) : (
                <input
                  type={key === 'website' ? 'url' : 'text'}
                  value={profile[key]}
                  onChange={e => handleChange(key, e.target.value)}
                  placeholder={placeholder}
                  className="w-full bg-white/5 border border-white/10 focus:border-amber-500/30 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-colors"
                />
              )}
            </div>
          ))}

          <div className="pb-8" />
        </div>
      </div>
    </div>
  )
}
