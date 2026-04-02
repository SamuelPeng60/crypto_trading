import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PREFIXES = ['/login', '/api/auth/login']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Static assets — always pass
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/chart-preview')
  ) return NextResponse.next()

  // Public routes — always pass
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return NextResponse.next()

  // All other routes require a session cookie
  const token = req.cookies.get('ct_session')?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
