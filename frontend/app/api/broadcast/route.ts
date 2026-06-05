import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

const RAILWAY_URL = process.env.WHATSAPP_CAMPAIGN_URL || 'https://whatsapp-agent-production-3525.up.railway.app/api/send'
const RAILWAY_SECRET = process.env.WHATSAPP_CAMPAIGN_SECRET || ''

function normalise(p: string): string {
  p = p.replace(/[\s\-\+]/g, '')
  return p.length === 10 ? `91${p}` : p
}

export async function POST(req: NextRequest) {
  const { phones, message, variable_name, campaign_tag } = await req.json()

  if (!phones?.length || !message) {
    return NextResponse.json({ error: 'phones and message required' }, { status: 400 })
  }

  const results = await Promise.all(
    phones.map(async (raw: string) => {
      const phone = normalise(raw.trim())
      try {
        const res = await fetch(RAILWAY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': RAILWAY_SECRET },
          body: JSON.stringify({ phone, name: variable_name || phone, message, call_id: randomUUID(), campaign: campaign_tag || 'Broadcast' }),
        })
        return res.ok ? { phone, status: 'sent' } : { phone, status: 'failed', reason: await res.text() }
      } catch (e: any) {
        return { phone, status: 'failed', reason: e?.message || 'Network error' }
      }
    })
  )

  const sent = results.filter(r => r.status === 'sent').length
  const failed = results.filter(r => r.status === 'failed').length
  return NextResponse.json({ total: phones.length, sent, failed, results })
}
