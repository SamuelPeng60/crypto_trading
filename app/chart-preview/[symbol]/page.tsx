import { getDb } from '@/lib/db'
import ChartPreviewClient from './client'

export default async function ChartPreviewPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()

  let initialInPosition = false
  try {
    const db = getDb()
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM positions WHERE symbol = ? AND quantity > 0`
    ).get(upperSymbol) as { cnt: number }
    initialInPosition = row.cnt > 0
  } catch { /* non-critical */ }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#09090b' }}>
      <ChartPreviewClient symbol={upperSymbol} initialInPosition={initialInPosition} />
    </div>
  )
}
