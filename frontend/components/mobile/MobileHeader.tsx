'use client'
import { useRouter } from 'next/navigation'
import { ReactNode } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'

interface Props {
  title: string
  subtitle?: string
  showBack?: boolean
  rightElement?: ReactNode
  onBack?: () => void
}

export function MobileHeader({ title, subtitle, showBack = true, rightElement, onBack }: Props) {
  const router = useRouter()
  const isMobile = useIsMobile()

  if (!isMobile) return null

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-[#e8ddcf] px-4 pt-4 pb-3">
      <div className="flex items-center gap-3">
        {showBack && (
          <button
            onClick={onBack ?? (() => router.back())}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7b7166] hover:bg-[#f0e8de] transition-colors flex-shrink-0"
          >
            ←
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-[#1f1914] truncate">{title}</h1>
          {subtitle && <p className="text-xs text-[#8f8378] truncate">{subtitle}</p>}
        </div>
        {rightElement && <div className="flex-shrink-0">{rightElement}</div>}
      </div>
    </div>
  )
}
