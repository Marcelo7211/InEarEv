import { describe, expect, it } from 'vitest'
import { mixMusicianStereoFromMonoSources } from './mixer.js'
import type { Showfile } from './showfile.js'

describe('mixMusicianStereoFromMonoSources com escopo órfão', () => {
  it('mistura todos os canais quando o escopo aponta só para ids inexistentes', () => {
    const sf: Showfile = {
      version: 1,
      name: 't',
      networkProfile: 'auto',
      channels: [
        {
          id: 'if_l',
          name: 'L',
          gain: 1,
          pan: 0,
          mute: false,
          eq: { lowDb: 0, midDb: 0, highDb: 0 },
          lockEq: false,
          sourceTap: 'L',
        },
      ],
      groups: [],
      musicians: [
        {
          id: 'm1',
          name: 'M1',
          username: 'u1',
          role: 'musician',
          sendGains: { if_l: 1 },
          mute: false,
          scope: { channelIds: ['kick_antigo'], groupIds: [] },
          eqByChannel: {},
        },
      ],
    }
    const m = sf.musicians[0]!
    const { l, r } = mixMusicianStereoFromMonoSources(sf, m, { if_l: 1 })
    expect(Math.abs(l) + Math.abs(r)).toBeGreaterThan(0.01)
  })

  it('respeita mute individual por source no retorno do músico', () => {
    const sf: Showfile = {
      version: 1,
      name: 't',
      networkProfile: 'auto',
      channels: [
        {
          id: 'if_0',
          name: 'Kick',
          gain: 1,
          pan: 0,
          mute: false,
          eq: { lowDb: 0, midDb: 0, highDb: 0 },
          lockEq: false,
          captureInputIndex: 0,
        },
      ],
      groups: [],
      musicians: [
        {
          id: 'm1',
          name: 'M1',
          username: 'u1',
          role: 'musician',
          sendGains: { if_0: 1 },
          sendMutes: { if_0: true },
          mute: false,
          scope: { channelIds: ['if_0'], groupIds: [] },
          eqByChannel: {},
        },
      ],
    }
    const m = sf.musicians[0]!
    const { l, r } = mixMusicianStereoFromMonoSources(sf, m, { if_0: 1 })
    expect(l).toBe(0)
    expect(r).toBe(0)
  })

  it('permite multiplicador adicional por source para fades de mute', () => {
    const sf: Showfile = {
      version: 1,
      name: 't',
      networkProfile: 'auto',
      channels: [
        {
          id: 'if_0',
          name: 'Kick',
          gain: 1,
          pan: 0,
          mute: false,
          eq: { lowDb: 0, midDb: 0, highDb: 0 },
          lockEq: false,
          captureInputIndex: 0,
        },
      ],
      groups: [],
      musicians: [
        {
          id: 'm1',
          name: 'M1',
          username: 'u1',
          role: 'musician',
          sendGains: { if_0: 1 },
          sendMutes: { if_0: false },
          mute: false,
          scope: { channelIds: ['if_0'], groupIds: [] },
          eqByChannel: {},
        },
      ],
    }
    const m = sf.musicians[0]!
    const { l, r } = mixMusicianStereoFromMonoSources(
      sf,
      m,
      { if_0: 1 },
      { getSourceGainMultiplier: () => 0.25 },
    )
    expect(Math.abs(l)).toBeGreaterThan(0.01)
    expect(Math.abs(l)).toBeLessThan(0.3)
    expect(Math.abs(r)).toBeGreaterThan(0.01)
    expect(Math.abs(r)).toBeLessThan(0.3)
  })
})
