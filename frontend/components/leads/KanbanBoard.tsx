'use client'
import { useState, useCallback } from 'react'
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import type { Lead, KanbanBoard as KanbanBoardType, LeadStage } from '@/lib/types'
import { stageConfig, formatBudget } from '@/lib/utils'
import { ScoreBadge, SourceTag, DaysInStage } from '@/components/shared/Badges'
import { useUpdateStage } from '@/hooks/useQueries'
import LostReasonModal from '@/components/leads/LeadComponents'

const STAGES: LeadStage[] = ['new', 'contacted', 'site_visit_scheduled', 'site_visit_done', 'negotiation', 'won', 'lost']

function LeadCard({ lead, isDragging = false }: { lead: Lead; isDragging?: boolean }) {
  const router = useRouter()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSortDragging } = useSortable({ id: lead.id })

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isSortDragging ? 0.4 : 1 }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`crm-surface crm-density-tight rounded-2xl p-4 cursor-grab active:cursor-grabbing select-none ${isDragging ? 'shadow-[0_8px_30px_rgb(0,0,0,0.12)] rotate-[2deg] ring-1 ring-gray-900/5' : 'border border-[#e7dccf] hover:shadow-md hover:border-[#d8c4ad]'} transition-all duration-200`}
      onClick={() => !isDragging && router.push(`/leads/${lead.id}`)}>
      {/* Score + days */}
      <div className="flex items-center justify-between mb-3">
        <ScoreBadge score={lead.lead_score} />
        <DaysInStage days={lead.days_in_stage} />
      </div>
      {/* Name */}
      <p className="font-semibold text-[#2b241e] text-[15px] leading-tight tracking-tight">{lead.contact?.name ?? '—'}</p>
      <p className="text-[13px] text-[#8a7d6f] mt-0.5 tracking-wide">{lead.contact?.phone}</p>
      {/* Budget */}
      {(lead.budget_min || lead.budget_max) && (
        <p className="text-[13px] text-[#2b241e] mt-2 font-medium tracking-wide">{formatBudget(lead.budget_min, lead.budget_max)}</p>
      )}
      {lead.campaign_id && (
        <p className="text-[11px] inline-flex items-center px-2 py-0.5 rounded-full bg-[#efe3d7] text-[#6a4a33] mt-2">
          📣 Campaign
        </p>
      )}
      {lead.location_preference && (
        <p className="text-[12px] text-[#8a7d6f] mt-0.5 truncate">{lead.location_preference}</p>
      )}
      {/* Source */}
      <div className="mt-4 flex items-center justify-between pt-3 border-t border-[#eee4d8]">
        <SourceTag source={lead.source} />
        {lead.assigned_agent && (
          <span className="text-[11px] font-medium uppercase tracking-widest text-gray-400">{lead.assigned_agent.name.split(' ')[0]}</span>
        )}
      </div>
    </div>
  )
}

function KanbanColumn({ stage, leads }: { stage: LeadStage; leads: Lead[] }) {
  const cfg = stageConfig[stage]
  return (
    <div className="flex-shrink-0 w-72 bg-[linear-gradient(180deg,#fffaf4_0%,#f8f1e8_100%)] rounded-3xl p-2.5 min-h-[500px] border border-[#e8ddcf]">
      <div className="flex items-center gap-2 mb-4 px-2 pt-2">
        <div className="w-2 h-2 rounded-full shadow-inner" style={{ backgroundColor: cfg.color }} />
        <span className="text-[14px] font-semibold tracking-wide text-[#2b241e]">{cfg.label}</span>
        <span className="ml-auto bg-white shadow-sm ring-1 ring-black/5 text-[#796d60] text-[11px] font-bold px-2 py-0.5 rounded-full">{leads.length}</span>
      </div>
      <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 min-h-[80px] crm-stagger">
          {leads.map(lead => <LeadCard key={lead.id} lead={lead} />)}
        </div>
      </SortableContext>
    </div>
  )
}

export default function KanbanBoard({ initialBoard }: { initialBoard: KanbanBoardType }) {
  const [board, setBoard] = useState(initialBoard)
  const [dragging, setDragging] = useState<Lead | null>(null)
  const [lostModal, setLostModal] = useState<{ leadId: string; targetStage: string } | null>(null)
  const { mutateAsync: updateStage } = useUpdateStage()

  const findLead = useCallback((id: string): [Lead, LeadStage] | null => {
    for (const stage of STAGES) {
      const found = board[stage]?.find(l => l.id === id)
      if (found) return [found, stage]
    }
    return null
  }, [board])

  const onDragStart = useCallback(({ active }: DragStartEvent) => {
    const result = findLead(active.id as string)
    if (result) setDragging(result[0])
  }, [findLead])

  const onDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    setDragging(null)
    if (!over) return

    const result = findLead(active.id as string)
    if (!result) return
    const [lead, fromStage] = result

    // Determine target column
    const targetStage = (STAGES.includes(over.id as LeadStage) ? over.id : findLead(over.id as string)?.[1]) as LeadStage
    if (!targetStage || targetStage === fromStage) return

    if (targetStage === 'lost') {
      setLostModal({ leadId: lead.id, targetStage })
      return
    }

    // Optimistic update
    setBoard(prev => {
      const next = { ...prev }
      next[fromStage] = prev[fromStage].filter(l => l.id !== lead.id)
      next[targetStage] = [{ ...lead, stage: targetStage, days_in_stage: 0 }, ...prev[targetStage]]
      return next
    })

    try {
      await updateStage({ id: lead.id, stage: targetStage })
      toast.success(`Moved to ${stageConfig[targetStage].label}`)
    } catch {
      setBoard(initialBoard)
      toast.error('Failed to update stage')
    }
  }, [findLead, updateStage, initialBoard])

  const handleLostConfirm = async (lost_reason: string) => {
    if (!lostModal) return
    const result = findLead(lostModal.leadId)
    if (!result) return
    const [lead, fromStage] = result

    setBoard(prev => {
      const next = { ...prev }
      next[fromStage] = prev[fromStage].filter(l => l.id !== lead.id)
      next.lost = [{ ...lead, stage: 'lost', days_in_stage: 0 }, ...prev.lost]
      return next
    })

    try {
      await updateStage({ id: lostModal.leadId, stage: 'lost', lost_reason })
      toast.success('Lead marked as lost')
    } catch {
      setBoard(initialBoard)
      toast.error('Failed to update')
    }
    setLostModal(null)
  }

  return (
    <>
      <DndContext collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-6 pt-2 px-1 crm-fade-up">
          {STAGES.map(stage => (
            <KanbanColumn key={stage} stage={stage} leads={board[stage] ?? []} />
          ))}
        </div>
        <DragOverlay>
          {dragging && <LeadCard lead={dragging} isDragging />}
        </DragOverlay>
      </DndContext>
      {lostModal && (
        <LostReasonModal
          onConfirm={handleLostConfirm}
          onCancel={() => setLostModal(null)}
        />
      )}
    </>
  )
}
