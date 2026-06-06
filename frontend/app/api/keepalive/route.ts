import { NextResponse } from 'next/server'

const BACKEND = process.env.NEXT_PUBLIC_API_URL || 'https://propellocrm.onrender.com'

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/health`, { cache: 'no-store' })
    return NextResponse.json({ ok: res.ok, status: res.status })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
