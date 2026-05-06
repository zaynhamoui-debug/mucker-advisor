import { useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'login' | 'signup' | 'reset'

export default function Auth() {
  const [mode, setMode]       = useState<Mode>('login')
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [notice, setNotice]   = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setNotice('Check your email for a confirmation link.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset`,
        })
        if (error) throw error
        setNotice('Password reset email sent — check your inbox.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center px-4">

      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
          <span className="text-amber-400 text-2xl font-bold">M</span>
        </div>
        <h1 className="text-white text-xl font-semibold">Mucker Advisor</h1>
        <p className="text-white/40 text-sm mt-1">Founder advice, anytime</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-6">

        {/* Tab switcher */}
        {mode !== 'reset' && (
          <div className="flex gap-1 bg-white/5 rounded-xl p-1 mb-6">
            {(['login', 'signup'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); setNotice(null) }}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  mode === m
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Sign up'}
              </button>
            ))}
          </div>
        )}

        {mode === 'reset' && (
          <div className="mb-6">
            <h2 className="text-white text-sm font-semibold">Reset password</h2>
            <p className="text-white/40 text-xs mt-1">We'll send a reset link to your email</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-white/40 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full bg-white/5 border border-white/10 focus:border-amber-500/40 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none transition-colors"
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <label className="block text-xs text-white/40 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                minLength={6}
                className="w-full bg-white/5 border border-white/10 focus:border-amber-500/40 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none transition-colors"
              />
            </div>
          )}

          {error && (
            <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {notice && (
            <p className="text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-white/10 disabled:text-white/20 text-black font-semibold rounded-xl py-2.5 text-sm transition-all mt-1"
          >
            {loading ? '...' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </button>
        </form>

        {/* Footer links */}
        <div className="mt-4 text-center">
          {mode === 'login' && (
            <button
              onClick={() => { setMode('reset'); setError(null); setNotice(null) }}
              className="text-xs text-white/30 hover:text-white/60 transition-colors"
            >
              Forgot password?
            </button>
          )}
          {mode === 'reset' && (
            <button
              onClick={() => { setMode('login'); setError(null); setNotice(null) }}
              className="text-xs text-white/30 hover:text-white/60 transition-colors"
            >
              ← Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
