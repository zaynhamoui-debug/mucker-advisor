import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import { PERSONAS, DEFAULT_PERSONA_ID, getPersona } from '../lib/personas'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const PERSONA_STORAGE_KEY = 'mucker_persona'

export default function Chat({ user, onProfile }: { user: User; onProfile: () => void }) {
  const [messages, setMessages]         = useState<Message[]>([])
  const [input, setInput]               = useState('')
  const [loading, setLoading]           = useState(false)
  const [personaId, setPersonaId]       = useState<string>(
    () => localStorage.getItem(PERSONA_STORAGE_KEY) ?? DEFAULT_PERSONA_ID
  )
  const [personaOpen, setPersonaOpen]   = useState(false)
  const personaRef = useRef<HTMLDivElement>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)

  const activePersona = getPersona(personaId)
  // Starters start as the persona's built-in defaults; API may upgrade them with profile context
  const [starters, setStarters] = useState<string[]>(activePersona.defaultStarters)

  // Close persona dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (personaRef.current && !personaRef.current.contains(e.target as Node)) {
        setPersonaOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // When persona changes, show its built-in starters immediately, then fetch personalized ones
  useEffect(() => {
    setStarters(getPersona(personaId).defaultStarters)
    fetch('/api/starters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, personaId }),
    })
      .then(r => r.json())
      .then(({ starters: s }) => { if (s && Array.isArray(s) && s.length > 0) setStarters(s) })
      .catch(() => {/* keep persona defaults */})
  }, [user.id, personaId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function selectPersona(id: string) {
    setPersonaId(id)
    localStorage.setItem(PERSONA_STORAGE_KEY, id)
    setPersonaOpen(false)
    setMessages([])
  }

  async function send(text: string) {
    if (!text.trim() || loading) return

    const userMsg: Message = { role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          history: messages.map(m => ({ role: m.role, content: m.content })),
          userId: user.id,
          personaId,
        }),
      })

      if (!res.ok) throw new Error('Failed to get response')

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') break
          try {
            const { text: chunk } = JSON.parse(payload)
            setMessages(prev => {
              const copy = [...prev]
              copy[copy.length - 1] = {
                role: 'assistant',
                content: copy[copy.length - 1].content + chunk,
              }
              return copy
            })
          } catch { /* ignore parse errors */ }
        }
      }
    } catch {
      setMessages(prev => {
        const copy = [...prev]
        copy[copy.length - 1] = {
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
        }
        return copy
      })
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">

      {/* Header */}
      <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
            <span className="text-amber-400 text-sm font-bold">M</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white leading-none">Mucker Advisor</h1>
            <p className="text-xs text-white/40 mt-0.5">{activePersona.tagline}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Persona selector */}
          <div ref={personaRef} className="relative">
            <button
              onClick={() => setPersonaOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all"
            >
              <span>{activePersona.icon}</span>
              <span className="hidden sm:inline">{activePersona.name}</span>
              <span className="text-white/30">▾</span>
            </button>

            {personaOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-[#111118] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="px-3 pt-3 pb-2">
                  <p className="text-[10px] text-white/30 uppercase tracking-widest">Choose your advisor</p>
                </div>
                {PERSONAS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => selectPersona(p.id)}
                    className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors ${
                      p.id === personaId
                        ? 'bg-amber-500/10'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <span className="text-lg leading-none mt-0.5">{p.icon}</span>
                    <div>
                      <p className={`text-sm font-medium leading-none ${p.id === personaId ? 'text-amber-400' : 'text-white/80'}`}>
                        {p.name}
                      </p>
                      <p className="text-xs text-white/35 mt-1 leading-snug">{p.tagline}</p>
                    </div>
                    {p.id === personaId && (
                      <span className="ml-auto text-amber-400 text-xs mt-0.5">✓</span>
                    )}
                  </button>
                ))}
                <div className="px-3 py-2 border-t border-white/5">
                  <p className="text-[10px] text-white/20">Switching advisor resets the conversation</p>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onProfile}
            className="text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all"
          >
            My Company
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all hidden sm:block"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">

          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4 text-3xl">
                {activePersona.icon === 'M'
                  ? <span className="text-amber-400 text-2xl font-bold">M</span>
                  : activePersona.icon}
              </div>
              <h2 className="text-xl font-semibold text-white mb-1">{activePersona.name}</h2>
              <p className="text-white/40 text-sm mb-8 max-w-sm mx-auto">{activePersona.tagline}</p>
              <div className="flex flex-col gap-2">
                {starters.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left text-sm text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl px-4 py-3 transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5 text-sm">
                  {activePersona.icon === 'M'
                    ? <span className="text-amber-400 text-xs font-bold">M</span>
                    : activePersona.icon}
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-amber-500/15 border border-amber-500/20 text-white'
                    : 'bg-white/5 border border-white/10 text-white/90'
                }`}
              >
                {msg.content}
                {msg.role === 'assistant' && msg.content === '' && loading && (
                  <span className="inline-flex gap-1 items-center">
                    <span className="w-1 h-1 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-white/10 px-4 py-4">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What's on your mind?"
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 focus:border-amber-500/40 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none resize-none transition-colors"
            style={{ minHeight: '44px', maxHeight: '120px' }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="shrink-0 w-10 h-10 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-white/10 disabled:text-white/20 text-black font-bold text-lg transition-all flex items-center justify-center"
          >
            ↑
          </button>
        </div>
        <p className="text-center text-white/20 text-[10px] mt-2">
          Grounded in Mucker Capital content · Not financial or legal advice
        </p>
      </div>

    </div>
  )
}
