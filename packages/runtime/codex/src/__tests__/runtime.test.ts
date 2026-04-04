import { describe, expect, it } from 'vitest'
import { applyCodexResultTextFallback } from '../runtime.js'
import type { RuntimeEvent } from '@sena-ai/core'

describe('applyCodexResultTextFallback', () => {
  it('fills empty result text from accumulated assistant text', () => {
    const event: RuntimeEvent = { type: 'result', text: '' }

    expect(applyCodexResultTextFallback(event, 'SENA_E2E_OK')).toEqual({
      type: 'result',
      text: 'SENA_E2E_OK',
    })
  })

  it('does not overwrite non-empty result text', () => {
    const event: RuntimeEvent = { type: 'result', text: 'final answer' }

    expect(applyCodexResultTextFallback(event, 'fallback')).toEqual(event)
  })

  it('does nothing for non-result events', () => {
    const event: RuntimeEvent = { type: 'progress.delta', text: 'S' }

    expect(applyCodexResultTextFallback(event, 'fallback')).toEqual(event)
  })
})
