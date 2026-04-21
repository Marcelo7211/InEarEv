package com.inear.android.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class Ine1DecoderTest {

    @Test
    fun rejectsTooShort() {
        assertNull(Ine1Decoder.tryDecode(ByteArray(10), 0, 10))
    }

    @Test
    fun decodesMinimalStereoFrame() {
        val buf = ByteArray(Ine1Decoder.HEADER_BYTES + 8)
        buf[0] = 0x49
        buf[1] = 0x4e
        buf[2] = 0x45
        buf[3] = 0x31
        buf[4] = 0
        buf[5] = 1
        buf[6] = 0
        buf[7] = 0
        buf[8] = 0
        buf[9] = 0
        buf[10] = 0
        buf[11] = 0x2a
        for (i in 12..19) buf[i] = 0
        buf[20] = 0
        buf[21] = 2
        buf[22] = 0
        buf[23] = 8
        var p = Ine1Decoder.HEADER_BYTES
        fun le16(v: Short) {
            buf[p++] = (v.toInt() and 0xff).toByte()
            buf[p++] = ((v.toInt() shr 8) and 0xff).toByte()
        }
        le16(1000)
        le16(-1000)
        le16(500)
        le16(500)
        val f = Ine1Decoder.tryDecode(buf, 0, buf.size)
        assertNotNull(f)
        assertEquals(2, f!!.samplesPerChannel)
        assertEquals(42, f.sequence)
        assertEquals(4, f.pcmInterleavedS16.size)
        assertEquals(1000, f.pcmInterleavedS16[0].toInt())
        assertEquals(-1000, f.pcmInterleavedS16[1].toInt())
    }
}
