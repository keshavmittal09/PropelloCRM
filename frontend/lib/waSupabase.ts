import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface WALead {
  id: number
  phone: string
  name: string
  score: number
  label: 'HOT' | 'WARM' | 'COLD'
  intent: string
  message_count: number
  last_message: string
  created_at: string
  updated_at: string
  budget_range: string | null
  location_preference: string | null
  timeline: string | null
  purpose: string | null
  follow_up_sent_at: string | null
  site_visit_offered: boolean
  campaign: string | null
}

export interface WAConversation {
  id: number
  phone: string
  role: 'user' | 'assistant'
  message: string
  score: number | null
  created_at: string
}

// Lazy singleton — created only when first accessed, not at module load time.
// This prevents build failures when env vars are absent during Vercel SSG.
let _client: SupabaseClient | null = null

export function getWASupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_WA_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_WA_SUPABASE_KEY
    if (!url || !key) {
      throw new Error('WhatsApp Supabase env vars (NEXT_PUBLIC_WA_SUPABASE_URL / NEXT_PUBLIC_WA_SUPABASE_KEY) are not configured.')
    }
    _client = createClient(url, key)
  }
  return _client
}
