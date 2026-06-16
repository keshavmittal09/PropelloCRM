import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'

const RAILWAY_URL = process.env.WHATSAPP_CAMPAIGN_URL || 'https://whatsapp-agent-production-3525.up.railway.app/api/send'
const RAILWAY_SECRET = process.env.WHATSAPP_CAMPAIGN_SECRET || ''
const WA_URL = process.env.NEXT_PUBLIC_WA_SUPABASE_URL!
const WA_KEY = process.env.NEXT_PUBLIC_WA_SUPABASE_KEY!

function normalise(p: string): string {
  p = p.replace(/[\s\-\+]/g, '')
  return p.length === 10 ? `91${p}` : p
}

async function uploadToStorage(fileBytes: Uint8Array, fileName: string, mimeType: string): Promise<string | null> {
  try {
    const sb = createClient(WA_URL, WA_KEY)
    const ext = fileName.split('.').pop() ?? 'bin'
    const path = `broadcasts/${randomUUID()}.${ext}`
    const { error } = await sb.storage.from('media').upload(path, fileBytes, { contentType: mimeType, upsert: false })
    if (error) return null
    // Use a signed URL (valid 24h) so WhatsApp can download the file
    // regardless of whether the bucket is public or private
    const { data: signed } = await sb.storage.from('media').createSignedUrl(path, 86400)
    if (signed?.signedUrl) return signed.signedUrl
    // Fallback to public URL if signing fails
    const { data: pub } = sb.storage.from('media').getPublicUrl(path)
    return pub.publicUrl
  } catch {
    return null
  }
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
  const campaign = (form.get('campaign') as string | null) ?? 'Broadcast'
  const file = form.get('file') as File | null

  const phones = rawPhones.split(',').map(p => p.trim()).filter(Boolean)
  if (!phones.length) return NextResponse.json({ error: 'phones required' }, { status: 400 })
  if (!message && !file) return NextResponse.json({ error: 'message or file required' }, { status: 400 })

  let mediaUrl: string | null = null
  let fileNote = ''

  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    mediaUrl = await uploadToStorage(bytes, file.name, file.type)
    // If storage upload fails, append the filename as a note in the message
    if (!mediaUrl) {
      fileNote = `\n\n📎 Attachment: ${file.name}`
    }
  }

  const finalMessage = message + fileNote

  const results = await Promise.all(
    phones.map(async (phone) => {
      const r = await sendWA(phone, finalMessage || '📎', mediaUrl ?? undefined)
      return { phone, ...r }
    })
  )

  const sent = results.filter(r => r.status === 'sent').length
  return NextResponse.json({ total: phones.length, sent, failed: phones.length - sent, results, mediaUrl })
}
