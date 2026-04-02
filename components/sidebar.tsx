'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart2, TrendingUp, FlaskConical, History, Settings, Bitcoin, Trophy, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { href: '/',             label: '總覽',    icon: BarChart2 },
  { href: '/strategies',   label: '策略',    icon: TrendingUp },
  { href: '/performance',  label: '績效',    icon: Trophy },
  { href: '/backtest',     label: '回測',    icon: FlaskConical },
  { href: '/participants', label: '參與者',  icon: Users },
  { href: '/trades',       label: '交易記錄', icon: History },
  { href: '/settings',     label: '設定',    icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="w-56 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col">
      <div className="px-4 py-5 flex items-center gap-2 border-b border-zinc-800">
        <Bitcoin className="text-yellow-400 w-6 h-6" />
        <span className="font-bold text-sm tracking-wide">Crypto Trader</span>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              pathname === href
                ? 'bg-yellow-500/10 text-yellow-400 font-medium'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-zinc-800">
        <p className="text-xs text-zinc-600">v1.0.0 · Paper Mode</p>
      </div>
    </aside>
  )
}
