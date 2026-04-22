import { NativeEventEmitter, NativeModules, Platform } from 'react-native'

export type NativeRetornoStats = {
  connected: boolean
  playing: boolean
  profile: 'pro' | 'low' | 'stable' | 'wifi24'
  sampleRateHz: number
  bufferFrames: number
  queuedFrames: number
  drops: number
  underruns: number
  gaps: number
  reconnects: number
  lastError?: string | null
}

type NativeRetornoModuleShape = {
  start(wsUrl: string, latencyProfile: 'pro' | 'low' | 'stable' | 'wifi24'): Promise<void>
  stop(): Promise<void>
  setMasterGain(gain: number): void
  setLatencyProfile(profile: 'pro' | 'low' | 'stable' | 'wifi24'): void
  getCurrentStats(): Promise<NativeRetornoStats>
}

const nativeModule = NativeModules.RetornoAudioModule as NativeRetornoModuleShape | undefined

export const nativeRetornoAudio = {
  isAvailable(): boolean {
    return Platform.OS !== 'web' && Boolean(nativeModule)
  },
  async start(wsUrl: string, latencyProfile: 'pro' | 'low' | 'stable' | 'wifi24') {
    if (!nativeModule) return
    await nativeModule.start(wsUrl, latencyProfile)
  },
  async stop() {
    if (!nativeModule) return
    await nativeModule.stop()
  },
  setMasterGain(gain: number) {
    nativeModule?.setMasterGain(gain)
  },
  setLatencyProfile(profile: 'pro' | 'low' | 'stable' | 'wifi24') {
    nativeModule?.setLatencyProfile(profile)
  },
  async getCurrentStats(): Promise<NativeRetornoStats | null> {
    if (!nativeModule) return null
    return nativeModule.getCurrentStats()
  },
  createEmitter() {
    if (!nativeModule) return null
    return new NativeEventEmitter(NativeModules.RetornoAudioModule)
  },
}
