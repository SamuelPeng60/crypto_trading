'use client'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

/** package.json 的 "1.0.0" → 顯示 "V1.0"；點一下展開 build 當下的 commit */
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
      className="fixed bottom-2 right-3 z-50 select-none text-[11px] text-zinc-600 hover:text-zinc-400 font-mono"
    >
      V{major}.{minor}{open && <span className="text-zinc-500"> · {hash}</span>}
    </button>
  )
}
