package com.peers.touch.mobile.securestorage

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureStorageInstrumentedTest {
    private lateinit var storage: SecureStorageEngine

    @Before
    fun createIsolatedStorage() {
        val suffix = System.nanoTime().toString()
        storage = SecureStorageEngine(
            context = InstrumentationRegistry.getInstrumentation().targetContext,
            preferencesName = "peers_touch_secure_storage_test_$suffix",
            keyAlias = "com.peers.touch.mobile.secure-storage.test.$suffix",
        )
    }

    @After
    fun removeIsolatedStorage() {
        storage.clearTestStorage()
    }

    @Test
    fun setGetAndRemoveRoundTripUsesOpaquePreferences() {
        val logicalKey = "oauth.attempt"
        val secretValue = "attempt-secret-value"

        storage.set(logicalKey, secretValue)

        assertEquals(secretValue, storage.get(logicalKey))
        val entries = storage.rawTestEntries()
        assertEquals(2, entries.size)
        assertFalse(entries.keys.any { it.contains(logicalKey) })
        assertFalse(entries.values.any { (it as String).contains(secretValue) })
        assertEquals(listOf(logicalKey), storage.list("oauth."))

        storage.remove(logicalKey)
        assertNull(storage.get(logicalKey))
        assertTrue(storage.list("oauth.").isEmpty())
        assertTrue(storage.rawTestEntries().isEmpty())
    }

    @Test
    fun repeatedWriteUsesFreshRandomIv() {
        val logicalKey = "session.refresh"
        val preferenceKey = SecureStorageEncoding.preferenceKey(logicalKey)
        storage.set(logicalKey, "same-value")
        val firstRecord = storage.rawTestEntries()[preferenceKey] as String

        storage.set(logicalKey, "same-value")
        val secondRecord = storage.rawTestEntries()[preferenceKey] as String

        assertNotEquals(firstRecord, secondRecord)
        assertEquals("same-value", storage.get(logicalKey))
    }

    @Test
    fun listReturnsOnlyMatchingLogicalKeysInCanonicalOrder() {
        storage.set("peers-touch.mobile.reliability.scope-dek.v2.z", "z")
        storage.set("oauth.active", "oauth")
        storage.set("peers-touch.mobile.reliability.install-kek.v1", "install")
        storage.set("peers-touch.mobile.reliability.scope-dek.v2.a", "a")

        assertEquals(
            listOf(
                "peers-touch.mobile.reliability.scope-dek.v2.a",
                "peers-touch.mobile.reliability.scope-dek.v2.z",
            ),
            storage.list("peers-touch.mobile.reliability.scope-dek.v2."),
        )
        assertEquals(listOf("oauth.active"), storage.list("oauth."))
    }

    @Test
    fun corruptedRecordFailsClosed() {
        storage.set("oauth.active", "secret")
        storage.corruptTestRecord("oauth.active", "not-base64")

        val failure = captureFailure {
            storage.get("oauth.active")
        }

        assertEquals("SECURE_STORAGE_CORRUPT", failure.code)
    }

    @Test
    fun missingAliasWithPersistedRecordFailsClosed() {
        storage.set("oauth.delivery-key", "private-key")
        storage.deleteTestKey()

        val failure = captureFailure {
            storage.get("oauth.delivery-key")
        }

        assertEquals("SECURE_STORAGE_KEY_MISSING", failure.code)
    }

    private fun captureFailure(action: () -> Unit): SecureStorageFailure {
        try {
            action()
        } catch (failure: SecureStorageFailure) {
            return failure
        }
        throw AssertionError("expected secure storage operation to fail")
    }
}
