'use client'
import MobileBottomNav from '@/components/mobile/MobileBottomNav'
import { useEffect, useState } from 'react'

export default function CallAgentLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="min-h-screen bg-[#f8f4ef] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#c86f43]/30 border-t-[#c86f43] rounded-full animate-spin" />
      </div>
    )
  }

  // Render on both phone and desktop. On desktop we center the app in a
  // phone-width column so sales agents can also use it from a computer.
  return (
    <div className="min-h-screen bg-[#e9e2d8] flex justify-center">
      <div className="w-full max-w-lg min-h-screen bg-[#f8f4ef] flex flex-col shadow-sm">
        <main className="flex-1 overflow-auto pb-20">
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </div>
  )
}
