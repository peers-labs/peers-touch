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
        assertEquals(1, entries.size)
        assertFalse(entries.keys.single().contains(logicalKey))
        assertFalse((entries.values.single() as String).contains(secretValue))

        storage.remove(logicalKey)
        assertNull(storage.get(logicalKey))
        assertTrue(storage.rawTestEntries().isEmpty())
    }

    @Test
    fun repeatedWriteUsesFreshRandomIv() {
        storage.set("session.refresh", "same-value")
        val firstRecord = storage.rawTestEntries().values.single() as String

        storage.set("session.refresh", "same-value")
        val secondRecord = storage.rawTestEntries().values.single() as String

        assertNotEquals(firstRecord, secondRecord)
        assertEquals("same-value", storage.get("session.refresh"))
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
