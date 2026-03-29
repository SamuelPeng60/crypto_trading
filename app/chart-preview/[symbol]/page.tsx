import ChartPreviewClient from './client'

export default async function ChartPreviewPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#09090b' }}>
      <ChartPreviewClient symbol={symbol.toUpperCase()} />
    </div>
  )
}
