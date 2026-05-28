import { useState, useEffect, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
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

const ACCEPTED = '.csv,.xlsx,.xls,.txt,.tsv'

function parseFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'csv' || ext === 'tsv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data as Record<string, string>[]
          if (rows.length === 0) return resolve('')
          // Convert to readable key: value lines
          const text = rows.map((row, i) =>
            `Row ${i + 1}: ` + Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(' | ')
          ).join('\n')
          resolve(`[${file.name}]\n${text}`)
        },
        error: reject,
      })
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'binary' })
          const sections: string[] = []
          for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName]
            const csv = XLSX.utils.sheet_to_csv(ws)
            // Parse the CSV output
            const rows = csv.split('\n').filter(r => r.trim() && r.replace(/,/g, '').trim())
            if (rows.length > 0) {
              sections.push(`[Sheet: ${sheetName}]\n${rows.join('\n')}`)
            }
          }
          resolve(`[${file.name}]\n${sections.join('\n\n')}`)
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = reject
      reader.readAsBinaryString(file)
    } else if (ext === 'txt' || ext === 'tsv') {
      const reader = new FileReader()
      reader.onload = (e) => resolve(`[${file.name}]\n${e.target?.result as string}`)
      reader.onerror = reject
      reader.readAsText(file)
    } else {
      reject(new Error(`Unsupported file type: .${ext}`))
    }
  })
}

export default function Profile({ user, onBack }: { user: User; onBack: () => void }) {
  const [profile, setProfile]         = useState<Profile>(EMPTY)
  const [saved, setSaved]             = useState(false)
  const [saving, setSaving]           = useState(false)
  const [loaded, setLoaded]           = useState(false)
  const [fileNames, setFileNames]     = useState<string[]>([])
  const [fileContext, setFileContext]  = useState<string>('')
  const [fileError, setFileError]     = useState<string | null>(null)
  const [fileParsing, setFileParsing] = useState(false)
  const [dragging, setDragging]       = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase
      .from('founder_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          const { id: _id, user_id: _uid, updated_at: _ua,
                  file_context, file_names, ...rest } = data as Record<string, unknown>
          setProfile({ ...EMPTY, ...(rest as Partial<Profile>) })
          setFileContext((file_context as string) ?? '')
          setFileNames((file_names as string[]) ?? [])
        }
        setLoaded(true)
      })
  }, [user.id])

  function handleChange(key: keyof Profile, value: string) {
    const next = { ...profile, [key]: value }
    setProfile(next)
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => autosave(next, fileContext, fileNames), 800)
  }

  async function autosave(data: Profile, fc: string, fn: string[]) {
    setSaving(true)
    await supabase.from('founder_profiles').upsert(
      { user_id: user.id, ...data, file_context: fc, file_names: fn, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    setSaving(false)
    setSaved(true)
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setFileError(null)
    setFileParsing(true)

    const newTexts: string[] = []
    const newNames: string[] = [...fileNames]

    for (const file of Array.from(files)) {
      if (file.size > 5 * 1024 * 1024) {
        setFileError(`${file.name} is too large (max 5MB)`)
        continue
      }
      try {
        const text = await parseFile(file)
        newTexts.push(text)
        if (!newNames.includes(file.name)) newNames.push(file.name)
      } catch {
        setFileError(`Could not parse ${file.name}`)
      }
    }

    const combined = [fileContext, ...newTexts].filter(Boolean).join('\n\n')
    // Cap at ~20k chars to stay within context limits
    const capped = combined.length > 20000 ? combined.slice(0, 20000) + '\n[truncated]' : combined

    setFileContext(capped)
    setFileNames(newNames)
    setFileParsing(false)
    setSaved(false)
    autosave(profile, capped, newNames)
  }

  function removeFile(name: string) {
    const next = fileNames.filter(n => n !== name)
    // Rebuild context without that file's section
    const sections = fileContext.split(/\n(?=\[)/)
    const filtered = sections.filter(s => !s.startsWith(`[${name}]`)).join('\n\n')
    setFileNames(next)
    setFileContext(filtered)
    setSaved(false)
    autosave(profile, filtered, next)
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

          {/* File upload */}
          <div>
            <label className="block text-xs text-white/40 uppercase tracking-widest mb-3">
              Upload Data Files
            </label>
            <p className="text-xs text-white/30 mb-3">
              Financials, cap table, customer data, pitch deck exports — anything with numbers or context the advisor should know. CSV, Excel, or plain text.
            </p>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-all ${
                dragging
                  ? 'border-amber-500/50 bg-amber-500/5'
                  : 'border-white/10 hover:border-white/20 hover:bg-white/5'
              }`}
            >
              {fileParsing ? (
                <p className="text-sm text-white/40">Parsing file…</p>
              ) : (
                <>
                  <p className="text-2xl mb-2">📂</p>
                  <p className="text-sm text-white/50">Drop files here or click to upload</p>
                  <p className="text-xs text-white/25 mt-1">.csv  .xlsx  .xls  .txt — max 5MB each</p>
                </>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              multiple
              className="hidden"
              onChange={e => handleFiles(e.target.files)}
            />

            {fileError && (
              <p className="text-xs text-red-400 mt-2">{fileError}</p>
            )}

            {/* Uploaded files list */}
            {fileNames.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {fileNames.map(name => (
                  <div key={name} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                    <span className="text-xs text-white/60 font-mono truncate">{name}</span>
                    <button
                      onClick={() => removeFile(name)}
                      className="text-xs text-white/30 hover:text-red-400 transition-colors ml-3 shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <p className="text-xs text-white/25 mt-1">
                  {Math.round(fileContext.length / 1000)}k characters extracted · used as context in every chat
                </p>
              </div>
            )}
          </div>

          <div className="pb-8" />
        </div>
      </div>
    </div>
  )
}
