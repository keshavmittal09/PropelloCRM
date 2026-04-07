'use client'

import { useEffect, useState } from 'react'

type UiDensity = 'elegant' | 'minimal'

const STORAGE_KEY = 'propello_ui_density'

function applyDensityToDom(density: UiDensity) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-density', density)
}

export function useUiDensity() {
  const [density, setDensity] = useState<UiDensity>('elegant')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const persisted = localStorage.getItem(STORAGE_KEY)
    const resolved = persisted === 'minimal' ? 'minimal' : 'elegant'
    setDensity(resolved)
    applyDensityToDom(resolved)
  }, [])

  const updateDensity = (next: UiDensity) => {
    setDensity(next)
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, next)
    }
    applyDensityToDom(next)
  }

  return {
    density,
    setDensity: updateDensity,
    isMinimal: density === 'minimal',
  }
}
