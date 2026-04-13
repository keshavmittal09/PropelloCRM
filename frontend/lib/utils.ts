import type { LeadScore, LeadStage, LeadSource } from './types'

export function formatCurrency(amount: number | null | undefined): string {
  if (!amount) return '—'
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(0)}L`
  return `₹${amount.toLocaleString('en-IN')}`
}

export function formatBudget(min: number | null, max: number | null): string {
  if (!min && !max) return '—'
  if (!min) return `Up to ${formatCurrency(max)}`
  if (!max) return `From ${formatCurrency(min)}`
  return `${formatCurrency(min)} – ${formatCurrency(max)}`
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

// ─── SCORE STYLING ────────────────────────────────────────────────────────────
export const scoreConfig: Record<LeadScore, { label: string; className: string }> = {
  hot: { label: 'Hot', className: 'bg-red-100 text-red-700 border border-red-200' },
  warm: { label: 'Warm', className: 'bg-amber-100 text-amber-700 border border-amber-200' },
  cold: { label: 'Cold', className: 'bg-blue-100 text-blue-700 border border-blue-200' },
}

// ─── STAGE STYLING ────────────────────────────────────────────────────────────
export const stageConfig: Record<LeadStage, { label: string; color: string }> = {
  new:                   { label: 'New',                 color: '#6366f1' },
  contacted:             { label: 'Contacted',           color: '#8b5cf6' },
  site_visit_scheduled:  { label: 'Visit Scheduled',     color: '#f59e0b' },
  site_visit_done:       { label: 'Visit Done',          color: '#f97316' },
  negotiation:           { label: 'Negotiation',         color: '#06b6d4' },
  won:                   { label: 'Won',                 color: '#10b981' },
  lost:                  { label: 'Lost',                color: '#ef4444' },
  nurture:               { label: 'Nurture',             color: '#94a3b8' },
}

// ─── SOURCE LABELS ────────────────────────────────────────────────────────────
export const sourceLabels: Record<LeadSource, string> = {
  priya_ai:       'Priya AI',
  website:        'Website',
  facebook_ads:   'Facebook Ads',
  google_ads:     'Google Ads',
  '99acres':      '99acres',
  magicbricks:    'MagicBricks',
  walk_in:        'Walk-in',
  referral:       'Referral',
  email_campaign: 'Email',
  campaign:       'Campaign',
  manual:         'Manual',
}

export const sourceColors: Record<string, string> = {
  priya_ai:       'bg-purple-100 text-purple-700',
  website:        'bg-blue-100 text-blue-700',
  facebook_ads:   'bg-indigo-100 text-indigo-700',
  google_ads:     'bg-red-100 text-red-700',
  '99acres':      'bg-orange-100 text-orange-700',
  magicbricks:    'bg-pink-100 text-pink-700',
  walk_in:        'bg-green-100 text-green-700',
  referral:       'bg-teal-100 text-teal-700',
  email_campaign: 'bg-cyan-100 text-cyan-700',
  campaign:       'bg-violet-100 text-violet-700',
  manual:         'bg-gray-100 text-gray-600',
}

// ─── DAYS IN STAGE INDICATOR ─────────────────────────────────────────────────
export function daysInStageColor(days: number): string {
  if (days <= 2) return 'text-emerald-600'
  if (days <= 5) return 'text-amber-600'
  return 'text-red-600'
}

// ─── ACTIVITY ICONS ───────────────────────────────────────────────────────────
export const activityIcons: Record<string, string> = {
  call:           '📞',
  whatsapp:       '💬',
  email:          '✉️',
  site_visit:     '🏠',
  note:           '📝',
  stage_change:   '🔄',
  priya_call:     '🤖',
  property_shown: '🏗️',
  campaign_call:  '📣',
  task_completed: '✅',
  lead_created:   '🆕',
}
