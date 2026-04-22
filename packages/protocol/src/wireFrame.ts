import { PROTOCOL_VERSION } from './constants.js'

export const WIRE_MAGIC = new Uint8Array([0x49, 0x4e, 0x45, 0x31]) // INE1
export const WIRE_HEADER_BYTES = 32
export const WIRE_FLAG_MULAW = 1 << 0

export type AudioWireCodec = 'pcm_s16' | 'mulaw_u8'

export interface DecodedAudioFrame {
  version: number
  flags: number
  sequence: number
  serverTimestampNs: bigint
  samplesPerChannel: number
  pcmInterleavedS16: Int16Array
}

function readU16BE(buf: Uint8Array, o: number): number {
  return (buf[o]! << 8) | buf[o + 1]!
}

function readU32BE(buf: Uint8Array, o: number): number {
  return (
    (buf[o]! << 24) |
    (buf[o + 1]! << 16) |
    (buf[o + 2]! << 8) |
    buf[o + 3]!
  ) >>> 0
}

function readU64BE(buf: Uint8Array, o: number): bigint {
  const hi = BigInt(readU32BE(buf, o))
  const lo = BigInt(readU32BE(buf, o + 4))
  return (hi << 32n) | lo
}

function writeU16BE(buf: Uint8Array, o: number, v: number) {
  buf[o] = (v >>> 8) & 0xff
  buf[o + 1] = v & 0xff
}

function writeU32BE(buf: Uint8Array, o: number, v: number) {
  buf[o] = (v >>> 24) & 0xff
  buf[o + 1] = (v >>> 16) & 0xff
  buf[o + 2] = (v >>> 8) & 0xff
  buf[o + 3] = v & 0xff
}

function writeU64BE(buf: Uint8Array, o: number, v: bigint) {
  const hi = Number((v >> 32n) & 0xffff_ffffn)
  const lo = Number(v & 0xffff_ffffn)
  writeU32BE(buf, o, hi)
  writeU32BE(buf, o + 4, lo)
}

const MULAW_BIAS = 0x84
const MULAW_CLIP = 32635

function linearToMulawSample(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, sample | 0))
  let sign = 0
  if (s < 0) {
    sign = 0x80
    s = -s
  }
  if (s > MULAW_CLIP) s = MULAW_CLIP
  s += MULAW_BIAS
  let exponent = 7
  for (let expMask = 0x4000; (s & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
  const mantissa = (s >> (exponent + 1)) & 0x0f
  return (~(sign | (exponent << 4) | mantissa)) & 0xff
}

function mulawToLinearSample(byte: number): number {
  const mu = (~byte) & 0xff
  const sign = mu & 0x80
  const exponent = (mu >> 4) & 0x07
  const mantissa = mu & 0x0f
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent
  sample -= MULAW_BIAS
  return sign ? -sample : sample
}

export function encodeStereoPcmFrame(params: {
  sequence: number
  serverTimestampNs: bigint
  pcmInterleavedS16: Int16Array
  flags?: number
  codec?: AudioWireCodec
}): Uint8Array {
  const {
    sequence,
    serverTimestampNs,
    pcmInterleavedS16,
    flags = 0,
    codec = 'pcm_s16',
  } = params
  if (pcmInterleavedS16.length % 2 !== 0) {
    throw new Error('pcmInterleavedS16 length must be even (stereo)')
  }
  const samplesPerChannel = pcmInterleavedS16.length / 2
  if (samplesPerChannel > 65535) throw new Error('frame too large')
  const encodedFlags = codec === 'mulaw_u8' ? flags | WIRE_FLAG_MULAW : flags & ~WIRE_FLAG_MULAW
  const payloadBytes = codec === 'mulaw_u8' ? pcmInterleavedS16.length : pcmInterleavedS16.length * 2
  const total = WIRE_HEADER_BYTES + payloadBytes
  const out = new Uint8Array(total)
  for (let i = 0; i < 4; i++) out[i] = WIRE_MAGIC[i]!
  writeU16BE(out, 4, PROTOCOL_VERSION)
  writeU16BE(out, 6, encodedFlags)
  writeU32BE(out, 8, sequence >>> 0)
  writeU64BE(out, 12, serverTimestampNs)
  writeU16BE(out, 20, samplesPerChannel)
  writeU16BE(out, 22, payloadBytes)
  out.fill(0, 24, WIRE_HEADER_BYTES)
  if (codec === 'mulaw_u8') {
    for (let i = 0; i < pcmInterleavedS16.length; i++) {
      out[WIRE_HEADER_BYTES + i] = linearToMulawSample(pcmInterleavedS16[i]!)
    }
  } else {
    const dv = new DataView(out.buffer, out.byteOffset + WIRE_HEADER_BYTES, payloadBytes)
    for (let i = 0; i < pcmInterleavedS16.length; i++) {
      dv.setInt16(i * 2, pcmInterleavedS16[i]!, true)
    }
  }
  return out
}

export function decodeAudioFrame(buf: Uint8Array): DecodedAudioFrame | null {
  if (buf.length < WIRE_HEADER_BYTES) return null
  for (let i = 0; i < 4; i++) {
    if (buf[i] !== WIRE_MAGIC[i]) return null
  }
  const version = readU16BE(buf, 4)
  const flags = readU16BE(buf, 6)
  const sequence = readU32BE(buf, 8)
  const serverTimestampNs = readU64BE(buf, 12)
  const samplesPerChannel = readU16BE(buf, 20)
  const payloadBytes = readU16BE(buf, 22)
  if (buf.length < WIRE_HEADER_BYTES + payloadBytes) return null
  const usesMulaw = (flags & WIRE_FLAG_MULAW) !== 0
  if (usesMulaw) {
    if (payloadBytes !== samplesPerChannel * 2) return null
  } else if (payloadBytes !== samplesPerChannel * 2 * 2) {
    return null
  }
  const pcm = new Int16Array(samplesPerChannel * 2)
  if (usesMulaw) {
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = mulawToLinearSample(buf[WIRE_HEADER_BYTES + i]!)
    }
  } else {
    const dv = new DataView(buf.buffer, buf.byteOffset + WIRE_HEADER_BYTES, payloadBytes)
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = dv.getInt16(i * 2, true)
    }
  }
  return { version, flags, sequence, serverTimestampNs, samplesPerChannel, pcmInterleavedS16: pcm }
}
