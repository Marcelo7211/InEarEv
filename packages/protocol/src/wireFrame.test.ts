import { describe, expect, it } from 'vitest'
import { decodeAudioFrame, encodeStereoPcmFrame, WIRE_FLAG_MULAW } from './wireFrame.js'

describe('wireFrame', () => {
  it('roundtrips stereo PCM', () => {
    const pcm = new Int16Array([1000, -1000, 2000, -2000])
    const buf = encodeStereoPcmFrame({
      sequence: 7,
      serverTimestampNs: 9_999_888_777n,
      pcmInterleavedS16: pcm,
    })
    const u8 = buf
    const d = decodeAudioFrame(u8)
    expect(d).not.toBeNull()
    expect(d!.sequence).toBe(7)
    expect(d!.serverTimestampNs).toBe(9_999_888_777n)
    expect(d!.samplesPerChannel).toBe(2)
    expect(Array.from(d!.pcmInterleavedS16)).toEqual(Array.from(pcm))
  })

  it('roundtrips mu-law compressed stereo PCM with bounded loss', () => {
    const pcm = new Int16Array([0, 0, 6000, -6000, 14000, -14000, 26000, -26000])
    const buf = encodeStereoPcmFrame({
      sequence: 9,
      serverTimestampNs: 123_456_789n,
      pcmInterleavedS16: pcm,
      codec: 'mulaw_u8',
    })
    const d = decodeAudioFrame(buf)
    expect(d).not.toBeNull()
    expect((d!.flags & WIRE_FLAG_MULAW) !== 0).toBe(true)
    expect(d!.samplesPerChannel).toBe(4)
    for (let i = 0; i < pcm.length; i++) {
      expect(Math.abs(d!.pcmInterleavedS16[i]! - pcm[i]!)).toBeLessThan(5000)
    }
  })
})
