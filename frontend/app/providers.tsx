'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useState } from 'react'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 5 * 60 * 1000,        // data stays fresh 5 minutes
        gcTime: 15 * 60 * 1000,           // keep in cache 15 minutes
        refetchOnWindowFocus: false,       // don't refetch when switching tabs
        refetchOnReconnect: false,         // don't refetch on network reconnect
      },
    },
  }))
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
    </QueryClientProvider>
  )
}
