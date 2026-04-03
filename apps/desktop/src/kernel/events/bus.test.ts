import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EVENT } from './catalog'
import { eventBus } from './bus'
import { eventDebugBuffer } from './debug'

class TestWindow extends EventTarget {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    super.addEventListener(type, listener)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    super.removeEventListener(type, listener)
  }

  dispatchEvent(event: Event): boolean {
    return super.dispatchEvent(event)
  }
}

const originalWindow = (globalThis as any).window
const originalCustomEvent = (globalThis as any).CustomEvent

describe('event bus', () => {
  beforeEach(() => {
    ;(globalThis as any).window = new TestWindow()
    if (typeof (globalThis as any).CustomEvent === 'undefined') {
      ;(globalThis as any).CustomEvent = class<T = unknown> extends Event {
        detail: T

        constructor(type: string, init?: CustomEventInit<T>) {
          super(type)
          this.detail = init?.detail as T
        }
      }
    }
    eventDebugBuffer.clear()
  })

  afterEach(() => {
    ;(globalThis as any).window = originalWindow
    ;(globalThis as any).CustomEvent = originalCustomEvent
  })

  it('supports publish and subscribe with EVENT constants', () => {
    let triggered = false
    const off = eventBus.subscribe(EVENT.AUTH_IDENTITY_CHANGED, () => {
      triggered = true
    })
    eventBus.publish(EVENT.AUTH_IDENTITY_CHANGED)
    off()
    expect(triggered).toBe(true)
  })

  it('supports once', () => {
    let count = 0
    eventBus.once(EVENT.AGENT_BUILDER_STREAM_ENDED, () => {
      count += 1
    })
    eventBus.publish(EVENT.AGENT_BUILDER_STREAM_ENDED)
    eventBus.publish(EVENT.AGENT_BUILDER_STREAM_ENDED)
    expect(count).toBe(1)
  })

  it('supports subscribeMany', () => {
    const types: string[] = []
    const off = eventBus.subscribeMany(
      [EVENT.AUTH_IDENTITY_CHANGED, EVENT.OAUTH_CONNECTIONS_CHANGED],
      (event) => {
        types.push(event.type)
      },
    )
    eventBus.publish(EVENT.AUTH_IDENTITY_CHANGED)
    eventBus.publish(EVENT.OAUTH_CONNECTIONS_CHANGED)
    off()
    expect(types).toEqual([EVENT.AUTH_IDENTITY_CHANGED, EVENT.OAUTH_CONNECTIONS_CHANGED])
  })

  it('records debug events', () => {
    eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'settings', id: 'account' })
    const records = eventDebugBuffer.list()
    expect(records.length).toBeGreaterThan(0)
    expect(records[records.length - 1].type).toBe(EVENT.NAVIGATION_REQUESTED)
  })
})
