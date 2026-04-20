import { describe, expect, it } from 'vitest'
import type { Showfile } from './showfile.js'
import {
  retornoMixerChannelOrder,
  visibleChannelIdsForMusician,
} from './showfile.js'

function ch(
  id: string,
  extra: Partial<{ captureInputIndex: number }> = {},
) {
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

describe('visibleChannelIdsForMusician', () => {
  it('expande escopo parcial if_* para todas as entradas da interface', () => {
    const sf: Showfile = {
      version: 1,
      name: 't',
      networkProfile: 'auto',
      channels: [
        ch('if_0', { captureInputIndex: 0 }),
        ch('if_1', { captureInputIndex: 1 }),
        ch('if_2', { captureInputIndex: 2 }),
        ch('if_3', { captureInputIndex: 3 }),
      ],
      groups: [],
      musicians: [
        {
          id: 'm1',
          name: 'M1',
          username: 'u1',
          role: 'musician',
          sendGains: { if_0: 1, if_1: 1 },
          mute: false,
          scope: { channelIds: ['if_0', 'if_1'], groupIds: [] },
          eqByChannel: {},
        },
      ],
    }
    const ids = visibleChannelIdsForMusician(sf, sf.musicians[0]!)
    expect(ids).toEqual(['if_0', 'if_1', 'if_2', 'if_3'])
  })

  it('não expande quando o escopo mistura if_* com outros canais', () => {
    const sf: Showfile = {
      version: 1,
      name: 't',
      networkProfile: 'auto',
      channels: [
        ch('if_0'),
        ch('if_1'),
        ch('aux', { captureInputIndex: 0 }),
      ],
      groups: [],
      musicians: [
        {
          id: 'm1',
          name: 'M1',
          username: 'u1',
          role: 'musician',
          sendGains: {},
          mute: false,
          scope: { channelIds: ['if_0', 'aux'], groupIds: [] },
          eqByChannel: {},
        },
      ],
    }
    const ids = visibleChannelIdsForMusician(sf, sf.musicians[0]!)
    expect(ids).toEqual(['if_0', 'aux'])
  })
})

describe('retornoMixerChannelOrder', () => {
  it('inclui todas as if_* mesmo quando o escopo mistura if_* com aux', () => {
    const sf: Showfile = {
      version: 1,
      name: 't',
      networkProfile: 'auto',
      channels: [
        ch('if_0'),
        ch('if_1'),
        ch('if_2'),
        ch('if_3'),
        ch('if_4'),
        ch('aux'),
      ],
      groups: [],
      musicians: [
        {
          id: 'm1',
          name: 'M1',
          username: 'u1',
          role: 'musician',
          sendGains: {},
          mute: false,
          scope: { channelIds: ['if_0', 'if_1', 'aux'], groupIds: [] },
          eqByChannel: {},
        },
      ],
    }
    const ids = retornoMixerChannelOrder(sf, sf.musicians[0]!)
    expect(ids).toEqual(['if_0', 'if_1', 'if_2', 'if_3', 'if_4', 'aux'])
  })
})
