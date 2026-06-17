import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'

const RAILWAY_URL = process.env.WHATSAPP_CAMPAIGN_URL || 'https://whatsapp-agent-production-3525.up.railway.app/api/send'
const RAILWAY_SECRET = process.env.WHATSAPP_CAMPAIGN_SECRET || ''
const WA_URL = process.env.NEXT_PUBLIC_WA_SUPABASE_URL || ''
// Prefer a service-role key for uploads (bypasses storage RLS). Fall back to the publishable/anon key.
const WA_SERVICE_KEY = process.env.WA_SUPABASE_SERVICE_KEY || ''
const WA_ANON_KEY = process.env.NEXT_PUBLIC_WA_SUPABASE_KEY || ''
const WA_UPLOAD_KEY = WA_SERVICE_KEY || WA_ANON_KEY
const WA_BUCKET = process.env.WA_SUPABASE_BUCKET || 'media'

function normalise(p: string): string {
  p = p.replace(/[\s\-\+]/g, '')
  return p.length === 10 ? `91${p}` : p
}

type UploadResult = { url: string | null; error: string | null }

async function uploadToSupabase(fileBytes: Uint8Array, fileName: string, mimeType: string): Promise<UploadResult> {
  if (!WA_URL || !WA_UPLOAD_KEY) {
    return { url: null, error: 'Supabase env vars not configured (NEXT_PUBLIC_WA_SUPABASE_URL / key)' }
  }
  try {
    const sb = createClient(WA_URL, WA_UPLOAD_KEY)
    const ext = (fileName.split('.').pop() || 'bin').toLowerCase()
    const path = `broadcasts/${randomUUID()}.${ext}`
    const { error } = await sb.storage.from(WA_BUCKET).upload(path, fileBytes, { contentType: mimeType, upsert: true })
    if (error) {
      return { url: null, error: `Supabase upload to bucket "${WA_BUCKET}": ${error.message}` }
    }
    // Public bucket → public URL (no expiry). This is the URL WhatsApp/Railway downloads.
    const { data: pub } = sb.storage.from(WA_BUCKET).getPublicUrl(path)
    if (pub?.publicUrl) return { url: pub.publicUrl, error: null }
    // Private bucket fallback → 24h signed URL
    const { data: signed } = await sb.storage.from(WA_BUCKET).createSignedUrl(path, 86400)
    if (signed?.signedUrl) return { url: signed.signedUrl, error: null }
    return { url: null, error: 'Upload succeeded but could not generate a URL' }
  } catch (e: any) {
    return { url: null, error: `Supabase exception: ${e?.message ?? 'unknown'}` }
  }
}

// Fallback: upload to 0x0.st — free public host. Requires a real User-Agent or it returns 403.
async function uploadToPublicHost(fileBytes: Uint8Array, fileName: string, mimeType: string): Promise<UploadResult> {
  try {
    const blob = new Blob([Buffer.from(fileBytes)], { type: mimeType })
    const form = new FormData()
    form.append('file', blob, fileName)
    const res = await fetch('https://0x0.st', {
      method: 'POST',
      body: form,
      headers: { 'User-Agent': 'PropelloCRM/1.0 (+https://propello.in)' },
    })
    const text = (await res.text()).trim()
    if (!res.ok) return { url: null, error: `0x0.st HTTP ${res.status}: ${text.slice(0, 120)}` }
    return text.startsWith('http') ? { url: text, error: null } : { url: null, error: `0x0.st unexpected response: ${text.slice(0, 120)}` }
  } catch (e: any) {
    return { url: null, error: `0x0.st exception: ${e?.message ?? 'unknown'}` }
  }
}

async function uploadToStorage(fileBytes: Uint8Array, fileName: string, mimeType: string): Promise<UploadResult> {
  const primary = await uploadToSupabase(fileBytes, fileName, mimeType)
  if (primary.url) return primary
  const fallback = await uploadToPublicHost(fileBytes, fileName, mimeType)
  if (fallback.url) return fallback
  // Both failed — surface both reasons
  return { url: null, error: `${primary.error} | fallback: ${fallback.error}` }
}

async function sendWA(phone: string, message: string, mediaUrl?: string): Promise<{ status: string; reason?: string }> {
  phone = normalise(phone)
  try {
    const body: Record<string, unknown> = { phone, name: phone, message, call_id: randomUUID(), campaign: 'Manual' }
    if (mediaUrl) body.media_url = mediaUrl
    const res = await fetch(RAILWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': RAILWAY_SECRET },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) return { status: 'failed', reason: text }
    try {
      const json = JSON.parse(text)
      if (json.error || json.success === false || json.status === 'error') {
        return { status: 'failed', reason: json.error ?? json.message ?? text }
      }
    } catch { /* plain text 200 — treat as success */ }
    return { status: 'sent' }
  } catch (e: any) {
    return { status: 'failed', reason: e?.message }
  }
}

// POST /api/wa-media
// Accepts multipart/form-data:
//   phones: comma-separated phone numbers
//   message: text (optional if file present)
//   file: file attachment (optional)
//   campaign: tag (optional)
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const rawPhones = (form.get('phones') as string | null) ?? ''
  const message = (form.get('message') as string | null) ?? ''
  const file = form.get('file') as File | null

  const phones = rawPhones.split(',').map(p => p.trim()).filter(Boolean)
  if (!phones.length) return NextResponse.json({ error: 'phones required' }, { status: 400 })
  if (!message && !file) return NextResponse.json({ error: 'message or file required' }, { status: 400 })

  let mediaUrl: string | null = null

  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await uploadToStorage(bytes, file.name, file.type)
    if (!result.url) {
      // Do NOT send a broken "(upload failed)" message to the customer.
      // Return the real error so the agent can see and fix it.
      console.error('[wa-media] file upload failed:', result.error)
      return NextResponse.json(
        { error: `File upload failed — ${result.error}`, sent: 0, failed: phones.length },
        { status: 502 },
      )
    }
    mediaUrl = result.url
  }

  // Embed the URL in the message text too, so it's tappable even if native media delivery is unsupported.
  const fileLabel = file ? `\n\n📎 *${file.name}*` : ''
  const fileLink = mediaUrl ? `\n${mediaUrl}` : ''
  const finalMessage = (message + fileLabel + fileLink).trim() || '📎'

  const results = await Promise.all(
    phones.map(async (phone) => {
      const r = await sendWA(phone, finalMessage, mediaUrl ?? undefined)
      return { phone, ...r }
    })
  )

  const sent = results.filter(r => r.status === 'sent').length
  return NextResponse.json({ total: phones.length, sent, failed: phones.length - sent, results, mediaUrl })
}
