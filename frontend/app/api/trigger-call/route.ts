import { NextRequest, NextResponse } from 'next/server'

// Vaani Voice AI — trigger an outbound AI call.
// Keep the API key server-side: it is read from env and never sent to the browser.
const VAANI_URL = process.env.VAANI_API_URL || 'https://api.vaanivoice.ai/api/trigger-call/'
const VAANI_API_KEY = process.env.VAANI_API_KEY || ''
const VAANI_AGENT_ID = process.env.VAANI_AGENT_ID || ''

// Normalise an Indian phone number to E.164 (+91XXXXXXXXXX).
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`
  if (raw.trim().startsWith('+') && digits.length >= 11) return `+${digits}`
  return null
}

// POST /api/trigger-call
// Body: { name?: string, phone: string, agent_id?: string }
export async function POST(req: NextRequest) {
  if (!VAANI_API_KEY) {
    return NextResponse.json(
      { error: 'Vaani is not configured — set VAANI_API_KEY in the environment.' },
      { status: 500 },
    )
  }

  let payload: { name?: string; phone?: string; agent_id?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const phone = (payload.phone || '').trim()
  if (!phone) return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })

  const contactNumber = toE164(phone)
  if (!contactNumber) {
    return NextResponse.json({ error: 'Enter a valid 10-digit Indian mobile number' }, { status: 400 })
  }

  const agentId = (payload.agent_id || VAANI_AGENT_ID || '').trim()
  if (!agentId) {
    return NextResponse.json(
      { error: 'No Vaani agent configured — set VAANI_AGENT_ID in the environment.' },
      { status: 500 },
    )
  }

  try {
    const res = await fetch(VAANI_URL, {
      method: 'POST',
      headers: { 'X-API-Key': VAANI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        contact_number: contactNumber,
        ...(payload.name ? { contact_name: payload.name.trim() } : {}),
      }),
    })
    const text = await res.text()
    let data: any = null
    try { data = JSON.parse(text) } catch { /* non-JSON response */ }

    if (!res.ok) {
      const reason = data?.error || data?.message || text || `HTTP ${res.status}`
      return NextResponse.json({ error: `Call failed — ${reason}` }, { status: res.status })
    }

    return NextResponse.json({ success: true, contact_number: contactNumber, vaani: data ?? text })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not reach Vaani' }, { status: 502 })
  }
}
