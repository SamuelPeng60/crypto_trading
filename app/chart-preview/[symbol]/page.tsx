import { getDb } from '@/lib/db'
import ChartPreviewClient from './client'

interface OrderRow {
  side: 'buy' | 'sell'
  filled_price: number | null
  created_at: string
  status: string
}

export default async function ChartPreviewPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()

  let initialInPosition = false
  let initialOrders: OrderRow[] = []
  try {
    const db = getDb()
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM positions WHERE symbol = ? AND quantity > 0`
    ).get(upperSymbol) as { cnt: number }
    initialInPosition = row.cnt > 0

    initialOrders = db.prepare(
      `SELECT side, filled_price, created_at, status FROM orders
       WHERE symbol = ? AND filled_price IS NOT NULL AND status != 'pending'
       ORDER BY created_at DESC LIMIT 500`
    ).all(upperSymbol) as OrderRow[]
  } catch { /* non-critical */ }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#09090b' }}>
      <ChartPreviewClient symbol={upperSymbol} initialInPosition={initialInPosition} initialOrders={initialOrders} />
    </div>
  )
}
