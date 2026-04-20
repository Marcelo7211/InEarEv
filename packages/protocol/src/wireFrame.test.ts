import { describe, expect, it } from 'vitest'
import { decodeAudioFrame, encodeStereoPcmFrame } from './wireFrame.js'

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
})
