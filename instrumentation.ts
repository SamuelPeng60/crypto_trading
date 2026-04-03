/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts. Starts a background engine loop
 * so strategies tick automatically without needing the browser open.
 */
export async function register() {
  // Only run in Node.js runtime (not Edge), and only server-side
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const TICK_INTERVAL_MS = 5 * 60 * 1000 // every 5 minutes

  // Dynamic import avoids bundling issues with better-sqlite3 in edge/client
  const { runAllActiveTick } = await import('./lib/engine')

  let isRunning = false

  const tick = async () => {
    if (isRunning) {
      console.log('[engine] tick skipped — previous tick still running')
      return
    }
    isRunning = true
    try {
      const results = await runAllActiveTick()
      const acted = results.filter(r => r.signal !== 'hold')
      if (acted.length > 0) {
        console.log(`[engine] ${new Date().toISOString()} — ${acted.map(r => `${r.name}: ${r.signal}`).join(', ')}`)
      }
    } catch (e) {
      console.error('[engine] tick error:', e)
    } finally {
      isRunning = false
    }
  }

  // First tick after 10s (let server fully boot), then every 5 min
  setTimeout(() => {
    tick()
    setInterval(tick, TICK_INTERVAL_MS)
  }, 10_000)

  console.log('[engine] background loop started — ticking every 5 min')

  // Start Telegram bot polling (handles /chart commands)
  const { startTelegramPolling } = await import('./lib/telegram-bot')
  setTimeout(() => {
    startTelegramPolling()
  }, 15_000)
}
