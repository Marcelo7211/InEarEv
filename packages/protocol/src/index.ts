import type { WifiNetworkProfile } from './showfile.js'
import {
  MVP_MAX_CAPTURE_CHANNELS,
  MVP_MAX_INPUTS,
  MVP_MAX_MUSICIANS,
  MVP_MAX_VISIBLE_FADERS,
  MVP_SAMPLE_RATE_HZ,
  PROTOCOL_VERSION,
} from './constants.js'

export {
  MVP_MAX_CAPTURE_CHANNELS,
  MVP_MAX_INPUTS,
  MVP_MAX_MUSICIANS,
  MVP_MAX_VISIBLE_FADERS,
  MVP_SAMPLE_RATE_HZ,
  PROTOCOL_VERSION,
} from './constants.js'

export type WireRole = 'admin' | 'musician'

export interface ServerHello {
  type: 'server_hello'
  protocolVersion: typeof PROTOCOL_VERSION
  sessionId: string
  sampleRateHz: number
  maxMusicians: number
  maxInputs: number
  maxVisibleFaders: number
  maxCaptureChannels: number
  udpAudioPort: number
  udpControlPort: number
  httpApiPort: number
  networkProfile: WifiNetworkProfile
}

export function serverHello(
  sessionId: string,
  ports: {
    udpAudio: number
    udpControl: number
    http: number
    networkProfile: WifiNetworkProfile
  },
): ServerHello {
  return {
    type: 'server_hello',
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    sampleRateHz: MVP_SAMPLE_RATE_HZ,
    maxMusicians: MVP_MAX_MUSICIANS,
    maxInputs: MVP_MAX_INPUTS,
    maxVisibleFaders: MVP_MAX_VISIBLE_FADERS,
    maxCaptureChannels: MVP_MAX_CAPTURE_CHANNELS,
    udpAudioPort: ports.udpAudio,
    udpControlPort: ports.udpControl,
    httpApiPort: ports.http,
    networkProfile: ports.networkProfile,
  }
}

export * from './wireFrame.js'
export * from './showfile.js'
export * from './mixer.js'
export * from './channelVisuals.js'
