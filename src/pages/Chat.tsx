import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const STARTERS = [
  "How do I know when I've found product-market fit?",
  "What should my go-to-market look like at pre-seed?",
  "How do I think about hiring my first sales person?",
  "When should I raise my seed round?",
  "How do I prioritize features when resources are tight?",
]

export default function Chat({ user, onProfile }: { user: User; onProfile: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
            <span className="text-amber-400 text-sm font-bold">M</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white leading-none">Mucker Advisor</h1>
            <p className="text-xs text-white/40 mt-0.5">Ask a Mucker partner anything</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/30 hidden sm:block">{user.email}</span>
          <button
            onClick={onProfile}
            className="text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all"
          >
            My Company
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">

          {messages.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-6">
                <span className="text-3xl">🎯</span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">
                What's on your mind, founder?
              </h2>
              <p className="text-white/40 text-sm mb-8 max-w-sm mx-auto">
                Get straight-talk advice grounded in Mucker Capital's investment philosophy and years of founder experience.
              </p>
              <div className="flex flex-col gap-2">
                {STARTERS.map(s => (
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
                <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-amber-400 text-xs font-bold">M</span>
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
            placeholder="Ask a question..."
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
          Grounded in Mucker Capital content · Not financial advice
        </p>
      </div>

    </div>
  )
}
