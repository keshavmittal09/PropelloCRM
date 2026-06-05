import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

const RAILWAY_URL = process.env.WHATSAPP_CAMPAIGN_URL || 'https://whatsapp-agent-production-3525.up.railway.app/api/send'
const RAILWAY_SECRET = process.env.WHATSAPP_CAMPAIGN_SECRET || ''
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function POST(req: NextRequest) {
  const { campaign_id, message, campaign_tag, token } = await req.json()

  if (!campaign_id || !message) {
    return NextResponse.json({ error: 'campaign_id and message required' }, { status: 400 })
  }

  // Fetch campaign leads from Render backend
  const campaignRes = await fetch(`${BACKEND_URL}/api/campaigns/${campaign_id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!campaignRes.ok) {
    const err = await campaignRes.json().catch(() => ({}))
    return NextResponse.json({ error: err?.detail || 'Campaign not found' }, { status: campaignRes.status })
  }

  const campaign = await campaignRes.json()
  const leads: { contact?: { phone?: string; name?: string } }[] = campaign.leads || []

  if (!leads.length) {
    return NextResponse.json({ error: 'No leads in this campaign' }, { status: 400 })
  }

  const results = await Promise.all(
    leads.map(async (lead) => {
      const phone = lead.contact?.phone
      const name = lead.contact?.name || ''
      if (!phone) return { phone: 'unknown', status: 'skipped', reason: 'no phone' }
      try {
        const res = await fetch(RAILWAY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': RAILWAY_SECRET },
          body: JSON.stringify({ phone, name, message, call_id: randomUUID(), campaign: campaign_tag || campaign.name }),
        })
        return res.ok ? { phone, status: 'sent' } : { phone, status: 'failed', reason: await res.text() }
      } catch (e: any) {
        return { phone, status: 'failed', reason: e?.message || 'Network error' }
      }
    })
  )

  const sent = results.filter(r => r.status === 'sent').length
  const failed = results.filter(r => r.status === 'failed').length
  const skipped = results.filter(r => r.status === 'skipped').length
  return NextResponse.json({ total: leads.length, sent, failed, skipped, results })
}
