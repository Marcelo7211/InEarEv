import { describe, expect, it } from 'vitest'
import type { Showfile } from './showfile.js'
import { syncInterfaceChannels } from './showfile.js'

function ch(id: string, extra: Partial<any> = {}) {
  return {
    id,
    name: id,
    gain: 1,
    pan: 0,
    mute: false,
    eq: { lowDb: 0, midDb: 0, highDb: 0 },
    lockEq: false,
    ...extra,
  }
}

describe('syncInterfaceChannels', () => {
  it('cria if_* e preserva parâmetros por índice', () => {
    const sf: Showfile = {
      version: 1,
      name: 't',
      networkProfile: 'auto',
      channels: [
        ch('if_0', { gain: 2, color: '#ffffff' }),
        ch('if_1', { mute: true }),
      ],
      groups: [{ id: 'g1', name: 'G', channelIds: ['if_0'], gain: 1, mute: false }],
      musicians: [
        {
          id: 'm1',
          name: 'M1',
          username: 'u1',
          role: 'musician',
          sendGains: { if_0: 0.5 },
          sendMutes: { if_0: true },
          mute: false,
          scope: { channelIds: ['if_0'], groupIds: ['g1'] },
          eqByChannel: { if_0: { lowDb: 1, midDb: 0, highDb: -1 } },
        },
      ],
    }

    syncInterfaceChannels(sf, { channelCount: 4, baseName: 'Studio M' })

    expect(sf.channels.map((c) => c.id)).toEqual(['if_0', 'if_1', 'if_2', 'if_3'])
    expect(sf.channels.map((c) => c.captureInputIndex)).toEqual([0, 1, 2, 3])
    expect(sf.channels[0]!.gain).toBe(2)
    expect(sf.channels[1]!.mute).toBe(true)
    expect(sf.channels[2]!.gain).toBe(1)
    expect(sf.groups).toEqual([])

    const m = sf.musicians[0]!
    expect(m.scope.channelIds).toEqual(['if_0', 'if_1', 'if_2', 'if_3'])
    expect(m.scope.groupIds).toEqual([])
    expect(m.sendGains.if_0).toBe(0.5)
    expect(m.sendGains.if_3).toBe(1)
    expect(m.sendMutes?.if_0).toBe(true)
    expect(m.sendMutes?.if_2).toBe(false)
    expect(Object.keys(m.eqByChannel || {})).toEqual(['if_0'])
  })

  it('reduz canalCount e remove if_* fora do range', () => {
    const sf: Showfile = {
      version: 1,
      name: 't',
      networkProfile: 'auto',
      channels: [ch('if_0'), ch('if_1'), ch('if_2')],
      groups: [],
      musicians: [
        {
          id: 'm1',
          name: 'M1',
          username: 'u1',
          role: 'musician',
          sendGains: { if_2: 2 },
          sendMutes: { if_2: true },
          mute: false,
          scope: { channelIds: [], groupIds: [] },
          eqByChannel: { if_2: { lowDb: 0, midDb: 0, highDb: 0 } },
        },
      ],
    }

    syncInterfaceChannels(sf, { channelCount: 1, baseName: 'Webcam' })
    expect(sf.channels.map((c) => c.id)).toEqual(['if_0'])
    const m = sf.musicians[0]!
    expect(m.sendGains).toEqual({ if_0: 1 })
    expect(m.sendMutes).toEqual({ if_0: false })
    expect(m.eqByChannel).toEqual({})
  })
})

