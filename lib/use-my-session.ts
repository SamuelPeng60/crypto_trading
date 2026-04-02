import { useEffect, useState } from 'react'
import { useAuth } from '@/components/auth-provider'

interface MySession {
  boundSessionId: string | null
  startDate: string | null
  ready: boolean
}

/**
 * Returns the bound session & start_date for the currently logged-in user,
 * matched by participant name === username.
 */
export function useMySession(): MySession {
  const { user, loading } = useAuth()
  const [result, setResult] = useState<MySession>({ boundSessionId: null, startDate: null, ready: false })

  useEffect(() => {
    if (loading) return
    if (!user) { setResult({ boundSessionId: null, startDate: null, ready: true }); return }

    fetch('/api/participants')
      .then(r => r.ok ? r.json() : [])
      .then((participants: { name: string; bound_session_id: string | null; start_date: string }[]) => {
        const me = participants.find(p => p.name === user.username)
        setResult({
          boundSessionId: me?.bound_session_id ?? null,
          startDate: me?.start_date ?? null,
          ready: true,
        })
      })
      .catch(() => setResult({ boundSessionId: null, startDate: null, ready: true }))
  }, [user, loading])

  return result
}
