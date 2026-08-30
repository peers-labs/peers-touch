package com.peers.touch.mobile.securestorage

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class SecureStorageRecordCodecTest {
    @Test
    fun recordRoundTripPreservesIvCiphertextAndTag() {
        val record = EncryptedRecord(
            iv = ByteArray(12) { index -> index.toByte() },
            ciphertext = byteArrayOf(4, 8, 15, 16, 23, 42),
            tag = ByteArray(16) { index -> (index + 32).toByte() },
        )

        val decoded = SecureStorageRecordCodec.decode(SecureStorageRecordCodec.encode(record))

        assertArrayEquals(record.iv, decoded.iv)
        assertArrayEquals(record.ciphertext, decoded.ciphertext)
        assertArrayEquals(record.tag, decoded.tag)
    }

    @Test
    fun unsupportedRecordVersionFailsClosed() {
        val record = EncryptedRecord(
            iv = ByteArray(12),
            ciphertext = byteArrayOf(1),
            tag = ByteArray(16),
        )
        val encoded = SecureStorageRecordCodec.encode(record)
        encoded[4] = 2

        assertThrows(RecordCorruptionException::class.java) {
            SecureStorageRecordCodec.decode(encoded)
        }
    }

    @Test
    fun trailingRecordBytesFailClosed() {
        val record = EncryptedRecord(
            iv = ByteArray(12),
            ciphertext = byteArrayOf(1),
            tag = ByteArray(16),
        )
        val encoded = SecureStorageRecordCodec.encode(record) + byteArrayOf(0)

        assertThrows(RecordCorruptionException::class.java) {
            SecureStorageRecordCodec.decode(encoded)
        }
    }

    @Test
    fun preferenceKeyIsStableSha256WithoutLogicalKeyDisclosure() {
        val logicalKey = "oauth.active"
        val preferenceKey = SecureStorageEncoding.preferenceKey(logicalKey)

        assertEquals(
            "3be1369c244fe338473756a0a37e4c4806e033a9e9d0b877eb1fd364c900bae3",
            preferenceKey,
        )
        assertFalse(preferenceKey.contains(logicalKey))
    }

    @Test
    fun aadBindsApplicationAndLogicalKeyUnambiguously() {
        assertArrayEquals(
            "com.peers.touch.mobile\u0000oauth.active".toByteArray(Charsets.UTF_8),
            SecureStorageEncoding.aad("com.peers.touch.mobile", "oauth.active"),
        )
    }
}
