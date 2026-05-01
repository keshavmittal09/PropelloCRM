'use client'
import { TasksPageContent } from '@/components/pages/PageContents'
import { useAuthStore } from '@/store/useAuthStore'
import { useIsMobile } from '@/hooks/useIsMobile'
import MobileTasksPage from '@/components/mobile/MobileTasksPage'

export default function TasksPage() {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <MobileTasksPage title="Tasks" showBack={false} />
  }

  return <TasksPageContent />
}