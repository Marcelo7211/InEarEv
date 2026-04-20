export const MVP_SAMPLE_RATE_HZ = 48_000
export const MVP_MAX_MUSICIANS = 8
/** Canais da mesa / showfile e também teto do PCM multi-canal da captura (agregado). */
export const MVP_MAX_INPUTS = 32
export const MVP_MAX_VISIBLE_FADERS = 32
/** Mesmo teto que entradas físicas no fluxo único de captura. */
export const MVP_MAX_CAPTURE_CHANNELS = MVP_MAX_INPUTS
export const PROTOCOL_VERSION = 1 as const
