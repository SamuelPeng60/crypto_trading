'use client'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

/** package.json 的 "1.1.0" → 顯示 "V1.1"；點一下展開 build 當下的 commit */
export default function VersionBadge({ version }: { version: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // chart-preview 是 Telegram 截圖用的頁面，不要把版號拍進圖裡
  if (pathname?.startsWith('/chart-preview')) return null

  const [major, minor] = version.split('.')
  const hash = process.env.NEXT_PUBLIC_COMMIT_HASH ?? 'unknown'
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      title={`commit ${hash}`}
      className="fixed bottom-3 right-12 z-50 select-none rounded-md border border-yellow-500/30 bg-zinc-900/95 px-2 py-1 text-[11px] font-mono text-yellow-400/90 hover:text-yellow-300 hover:border-yellow-500/60"
    >
      V{major}.{minor}{open && <span className="text-zinc-500"> · {hash}</span>}
    </button>
  )
}
