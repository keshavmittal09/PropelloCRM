'use client'
import { useKanbanBoard } from '@/hooks/useQueries'
import Sidebar from '@/components/shared/Sidebar'
import KanbanBoard from '@/components/leads/KanbanBoard'
import { useRouter } from 'next/navigation'

export default function BoardPage() {
  const { data: board, isLoading } = useKanbanBoard()
  const router = useRouter()

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden crm-page-enter">
        <div className="px-8 py-6 border-b border-[#e8ddcf] bg-[#fffaf4] flex items-center justify-between">
          <div>
            <h2 className="text-4xl font-semibold text-[#1f1914] crm-density-title">Sales Pipeline</h2>
            <p className="text-sm text-[#7a7065] mt-0.5">Drag cards to move leads between stages</p>
          </div>
          <button onClick={() => router.push('/leads')}
            className="px-4 py-2 text-sm border border-[#e1d1bd] rounded-xl hover:bg-[#f7ecdf] text-[#6b5f53] transition-colors">
            List view
          </button>
        </div>
        <div className="flex-1 overflow-x-auto p-8">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
            </div>
          ) : board ? (
            <KanbanBoard initialBoard={board} />
          ) : (
            <p className="text-gray-400 text-center mt-20">No leads found</p>
          )}
        </div>
      </main>
    </div>
  )
}
