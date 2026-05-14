import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Auth from './pages/Auth'
import Chat from './pages/Chat'
import Profile from './pages/Profile'

type View = 'chat' | 'profile'

export default function App() {
  const [user, setUser]     = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView]     = useState<View>('chat')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
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

  if (!user) return <Auth />

  if (view === 'profile') {
    return <Profile user={user} onBack={() => setView('chat')} />
  }

  return <Chat user={user} onProfile={() => setView('profile')} />
}
