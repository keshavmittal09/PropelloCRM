'use client'
import MobileBottomNav from '@/components/mobile/MobileBottomNav'
import { useEffect, useState } from 'react'

export default function CallAgentLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    setMounted(true)
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  if (!mounted) {
    return (
      <div className="min-h-screen bg-[#f8f4ef] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#c86f43]/30 border-t-[#c86f43] rounded-full animate-spin" />
      </div>
    )
  }

  if (!isMobile) {
    // On desktop, show a centered message for call_agent mobile routes
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8f4ef] p-8">
        <p className="text-4xl mb-4">📱</p>
        <p className="text-xl font-semibold text-[#1f1914]">Mobile view</p>
        <p className="text-sm text-[#8f8378] mt-2 text-center">This page is optimized for mobile.<br />Please view on a phone or resize your browser.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f8f4ef] flex flex-col">
      <main className="flex-1 overflow-auto pb-20">
        {children}
      </main>
      <MobileBottomNav />
    </div>
  )
}
