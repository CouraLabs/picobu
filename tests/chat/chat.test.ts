import { describe, expect, test } from 'bun:test'
import { drainInbound, emitInbound, subscribeInbound } from '../../src/integrations/whatsapp/bus.ts'
import { isPhoneAllowed, normalizedAllowList, normalizePhone, phoneToJid } from '../../src/integrations/whatsapp/phone.ts'

describe('inbound bus', () => {
  test('delivers to every subscriber', () => {
    const seenA: string[] = []
    const seenB: string[] = []
    const offA = subscribeInbound((e) => seenA.push(e.text))
    const offB = subscribeInbound((e) => seenB.push(e.text))
    emitInbound({ source: 'whatsapp', title: 't', text: 'hello' })
    expect(seenA).toEqual(['hello'])
    expect(seenB).toEqual(['hello'])
    offA()
    offB()
  })
  test('queues while nobody listens then drains once', () => {
    emitInbound({ source: 'whatsapp', title: 'q', text: 'queued' })
    const seen: string[] = []
    const off = subscribeInbound((e) => seen.push(e.text))
    expect(seen).toEqual(['queued'])
    off()
  })
})

describe('phone', () => {
  test('returns empty for non string', () => {
    expect(normalizePhone(undefined)).toBe('')
    expect(normalizePhone(123)).toBe('')
    expect(normalizePhone(null)).toBe('')
  })
  test('strips formatting', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('15551234567')
    expect(phoneToJid('+55 11 9')).toBe('55119@s.whatsapp.net')
  })
  test('allow list dedupes and matches', () => {
    expect(normalizedAllowList(['+1-555', '1555'])).toEqual(['1555'])
    expect(isPhoneAllowed('+1 (555)', ['1555'])).toBe(true)
    expect(isPhoneAllowed('999', ['1555'])).toBe(false)
  })
  test('drainInbound handles empty queue', () => {
    expect(() => drainInbound(() => {})).not.toThrow()
  })
})
