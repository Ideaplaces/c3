'use client'

import { useState, useCallback, useRef } from 'react'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

export interface AccumulatedBlock {
  type: 'text' | 'thinking' | 'tool_use'
  content: string
  toolName?: string
  toolInput?: string
  toolId?: string
  complete: boolean
}

export interface StreamState {
  blocks: AccumulatedBlock[]
  messageComplete: boolean
}

export function useStreamAccumulator() {
  const [state, setState] = useState<StreamState>({ blocks: [], messageComplete: false })
  const blocksRef = useRef<AccumulatedBlock[]>([])

  const processEvent = useCallback((event: BetaRawMessageStreamEvent) => {
    switch (event.type) {
      case 'message_start': {
        blocksRef.current = []
        setState({ blocks: [], messageComplete: false })
        break
      }

      case 'content_block_start': {
        const block: AccumulatedBlock = {
          type: 'text',
          content: '',
          complete: false,
        }

        if (event.content_block.type === 'thinking') {
          block.type = 'thinking'
          block.content = event.content_block.thinking || ''
        } else if (event.content_block.type === 'tool_use') {
          block.type = 'tool_use'
          block.toolName = event.content_block.name
          block.toolId = event.content_block.id
          block.toolInput = ''
        } else if (event.content_block.type === 'text') {
          block.content = event.content_block.text || ''
        }

        blocksRef.current = [...blocksRef.current, block]
        setState({ blocks: blocksRef.current, messageComplete: false })
        break
      }

      case 'content_block_delta': {
        const blocks = [...blocksRef.current]
        const lastBlock = blocks[blocks.length - 1]
        if (!lastBlock) break

        if (event.delta.type === 'text_delta') {
          lastBlock.content += event.delta.text
        } else if (event.delta.type === 'thinking_delta') {
          lastBlock.content += event.delta.thinking
        } else if (event.delta.type === 'input_json_delta') {
          lastBlock.toolInput = (lastBlock.toolInput || '') + event.delta.partial_json
        }

        blocksRef.current = blocks
        setState({ blocks: [...blocks], messageComplete: false })
        break
      }

      case 'content_block_stop': {
        const blocks = [...blocksRef.current]
        const lastBlock = blocks[blocks.length - 1]
        if (lastBlock) {
          lastBlock.complete = true
        }
        blocksRef.current = blocks
        setState({ blocks: [...blocks], messageComplete: false })
        break
      }

      case 'message_stop': {
        setState((prev) => ({ ...prev, messageComplete: true }))
        break
      }
    }
  }, [])

  const reset = useCallback(() => {
    blocksRef.current = []
    setState({ blocks: [], messageComplete: false })
  }, [])

  return { state, processEvent, reset }
}
