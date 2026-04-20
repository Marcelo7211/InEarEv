import { PROTOCOL_VERSION } from './constants.js'

export const WIRE_MAGIC = new Uint8Array([0x49, 0x4e, 0x45, 0x31]) // INE1
export const WIRE_HEADER_BYTES = 32

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

export function encodeStereoPcmFrame(params: {
  sequence: number
  serverTimestampNs: bigint
  pcmInterleavedS16: Int16Array
  flags?: number
}): Uint8Array {
  const { sequence, serverTimestampNs, pcmInterleavedS16, flags = 0 } = params
  if (pcmInterleavedS16.length % 2 !== 0) {
    throw new Error('pcmInterleavedS16 length must be even (stereo)')
  }
  const samplesPerChannel = pcmInterleavedS16.length / 2
  if (samplesPerChannel > 65535) throw new Error('frame too large')
  const payloadBytes = pcmInterleavedS16.length * 2
  const total = WIRE_HEADER_BYTES + payloadBytes
  const out = new Uint8Array(total)
  for (let i = 0; i < 4; i++) out[i] = WIRE_MAGIC[i]!
  writeU16BE(out, 4, PROTOCOL_VERSION)
  writeU16BE(out, 6, flags)
  writeU32BE(out, 8, sequence >>> 0)
  writeU64BE(out, 12, serverTimestampNs)
  writeU16BE(out, 20, samplesPerChannel)
  writeU16BE(out, 22, payloadBytes)
  out.fill(0, 24, WIRE_HEADER_BYTES)
  const dv = new DataView(out.buffer, out.byteOffset + WIRE_HEADER_BYTES, payloadBytes)
  for (let i = 0; i < pcmInterleavedS16.length; i++) {
    dv.setInt16(i * 2, pcmInterleavedS16[i]!, true)
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
  if (payloadBytes !== samplesPerChannel * 2 * 2) return null
  const pcm = new Int16Array(samplesPerChannel * 2)
  const dv = new DataView(buf.buffer, buf.byteOffset + WIRE_HEADER_BYTES, payloadBytes)
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = dv.getInt16(i * 2, true)
  }
  return { version, flags, sequence, serverTimestampNs, samplesPerChannel, pcmInterleavedS16: pcm }
}
