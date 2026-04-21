package com.inear.android.audio

/**
 * Binary retorno frames (same as [packages/protocol/src/wireFrame.ts]).
 */
object Ine1Decoder {
    const val HEADER_BYTES = 32
    private val MAGIC = byteArrayOf(0x49, 0x4e, 0x45, 0x31) // INE1

    data class Frame(
        val version: Int,
        val flags: Int,
        val sequence: Int,
        val serverTimestampNs: Long,
        val samplesPerChannel: Int,
        val pcmInterleavedS16: ShortArray,
    )

    fun tryDecode(buf: ByteArray, offset: Int, length: Int): Frame? {
        if (length < HEADER_BYTES) return null
        for (i in 0..3) {
            if (buf[offset + i] != MAGIC[i]) return null
        }
        val version = readU16BE(buf, offset + 4)
        val flags = readU16BE(buf, offset + 6)
        val sequence = readU32BE(buf, offset + 8)
        val serverTs = readU64BE(buf, offset + 12)
        val samplesPerChannel = readU16BE(buf, offset + 20)
        val payloadBytes = readU16BE(buf, offset + 22)
        if (length < HEADER_BYTES + payloadBytes) return null
        if (payloadBytes != samplesPerChannel * 2 * 2) return null
        val pcm = ShortArray(samplesPerChannel * 2)
        var p = offset + HEADER_BYTES
        var i = 0
        while (i < pcm.size) {
            val s = (buf[p].toInt() and 0xff) or (buf[p + 1].toInt() shl 8)
            pcm[i] = s.toShort()
            p += 2
            i++
        }
        return Frame(version, flags, sequence, serverTs, samplesPerChannel, pcm)
    }

    private fun readU16BE(buf: ByteArray, o: Int): Int =
        ((buf[o].toInt() and 0xff) shl 8) or (buf[o + 1].toInt() and 0xff)

    private fun readU32BE(buf: ByteArray, o: Int): Int =
        ((buf[o].toLong() and 0xff) shl 24 or
            (buf[o + 1].toLong() and 0xff) shl 16 or
            (buf[o + 2].toLong() and 0xff) shl 8 or
            (buf[o + 3].toLong() and 0xff)).toInt()

    private fun readU64BE(buf: ByteArray, o: Int): Long {
        val hi = readU32BE(buf, o).toLong() and 0xffff_ffffL
        val lo = readU32BE(buf, o + 4).toLong() and 0xffff_ffffL
        return (hi shl 32) or lo
    }
}
