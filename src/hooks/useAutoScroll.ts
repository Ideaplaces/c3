'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

export function useAutoScroll(dependency: unknown) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const checkScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return

    const threshold = 100
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    setIsAtBottom(atBottom)
    setShowScrollButton(!atBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  // Auto-scroll when new content arrives and user is at bottom
  useEffect(() => {
    if (isAtBottom) {
      const el = containerRef.current
      if (el) {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [dependency, isAtBottom])

  // Attach scroll listener
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    el.addEventListener('scroll', checkScroll)
    return () => el.removeEventListener('scroll', checkScroll)
  }, [checkScroll])

  return {
    containerRef,
    showScrollButton,
    scrollToBottom,
  }
}
