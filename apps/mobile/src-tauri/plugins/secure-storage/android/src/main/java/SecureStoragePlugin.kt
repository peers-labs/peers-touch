package com.peers.touch.mobile.securestorage

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.security.KeyStore
import java.security.MessageDigest
import java.security.UnrecoverableKeyException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray

private const val PREFERENCES_NAME = "peers_touch_secure_storage"
private const val INVENTORY_PREFERENCE_KEY = "__peers_touch_secure_storage_inventory_v1"
private const val INVENTORY_LOGICAL_KEY = "peers-touch.mobile.secure-storage.inventory.v1"
private const val MASTER_KEY_ALIAS = "com.peers.touch.mobile.secure-storage.master.v1"
private const val ANDROID_KEY_STORE = "AndroidKeyStore"
private const val AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding"
private const val IV_SIZE_BYTES = 12
private const val TAG_SIZE_BYTES = 16
private const val TAG_SIZE_BITS = TAG_SIZE_BYTES * 8
private const val AES_KEY_SIZE_BITS = 256
private const val MAX_KEY_LENGTH = 256
private const val MAX_VALUE_SIZE_BYTES = 1024 * 1024
private const val MAX_RECORD_COUNT = 4096

@InvokeArg
class SetArgs {
    lateinit var key: String
    lateinit var value: String
}

@InvokeArg
class KeyArgs {
    lateinit var key: String
}

@InvokeArg
class ListArgs {
    lateinit var prefix: String
}

@TauriPlugin
class SecureStoragePlugin(private val activity: Activity) : Plugin(activity) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "peers-secure-storage").apply {
            isDaemon = true
        }
    }
    private val storage = SecureStorageEngine(activity.applicationContext)

    @Command
    fun set(invoke: Invoke) {
        executor.execute {
            execute(invoke, "set") {
                val args = invoke.parseArgs(SetArgs::class.java)
                storage.set(args.key, args.value)
                invoke.resolve()
            }
        }
    }

    @Command
    fun get(invoke: Invoke) {
        executor.execute {
            execute(invoke, "get") {
                val args = invoke.parseArgs(KeyArgs::class.java)
                val response = JSObject()
                response.put("value", storage.get(args.key))
                invoke.resolve(response)
            }
        }
    }

    @Command
    fun remove(invoke: Invoke) {
        executor.execute {
            execute(invoke, "remove") {
                val args = invoke.parseArgs(KeyArgs::class.java)
                storage.remove(args.key)
                invoke.resolve()
            }
        }
    }

    @Command
    fun list(invoke: Invoke) {
        executor.execute {
            execute(invoke, "list") {
                val args = invoke.parseArgs(ListArgs::class.java)
                val response = JSObject()
                response.put("keys", JSONArray(storage.list(args.prefix)))
                invoke.resolve(response)
            }
        }
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun execute(invoke: Invoke, operation: String, action: () -> Unit) {
        try {
            action()
        } catch (failure: SecureStorageFailure) {
            invoke.reject("$operation failed: ${failure.message}", failure.code)
        } catch (error: Exception) {
            invoke.reject(
                "$operation failed unexpectedly (${error.javaClass.simpleName})",
                "SECURE_STORAGE_FAILED",
            )
        }
    }
}

internal class SecureStorageEngine(
    context: android.content.Context,
    private val preferencesName: String = PREFERENCES_NAME,
    private val keyAlias: String = MASTER_KEY_ALIAS,
) {
    private val applicationId = context.packageName
    private val preferences = context.getSharedPreferences(preferencesName, Activity.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply {
        load(null)
    }

    fun set(logicalKey: String, value: String) {
        validateLogicalKey(logicalKey)
        val plaintext = value.toByteArray(Charsets.UTF_8)
        if (plaintext.size > MAX_VALUE_SIZE_BYTES) {
            plaintext.fill(0)
            throw SecureStorageFailure(
                "SECURE_STORAGE_INVALID_VALUE",
                "value exceeds the secure storage size limit",
            )
        }

        try {
            val preferenceKey = SecureStorageEncoding.preferenceKey(logicalKey)
            val existing = preferences.getString(preferenceKey, null)
            val key = when {
                existing != null -> {
                    val record = decodeStoredRecord(existing)
                    requireExistingKey().also { existingKey ->
                        decrypt(existingKey, logicalKey, record).fill(0)
                    }
                }
                preferences.all.isNotEmpty() -> requireExistingKey()
                else -> getOrCreateInitialKey()
            }

            val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val iv = cipher.iv
            if (iv.size != IV_SIZE_BYTES) {
                throw SecureStorageFailure(
                    "SECURE_STORAGE_CRYPTO_FAILED",
                    "AndroidKeyStore generated an invalid GCM IV",
                )
            }
            cipher.updateAAD(SecureStorageEncoding.aad(applicationId, logicalKey))
            val sealed = cipher.doFinal(plaintext)
            val ciphertext = sealed.copyOfRange(0, sealed.size - TAG_SIZE_BYTES)
            val tag = sealed.copyOfRange(sealed.size - TAG_SIZE_BYTES, sealed.size)
            val record = SecureStorageRecordCodec.encode(
                EncryptedRecord(iv = iv, ciphertext = ciphertext, tag = tag),
            )
            val encoded = Base64.encodeToString(record, Base64.NO_WRAP)
            val inventory = loadInventory(key).apply {
                add(logicalKey)
            }
            val encodedInventory = encodeInventory(key, inventory)

            if (
                !preferences.edit()
                    .putString(preferenceKey, encoded)
                    .putString(INVENTORY_PREFERENCE_KEY, encodedInventory)
                    .commit()
            ) {
                throw SecureStorageFailure(
                    "SECURE_STORAGE_COMMIT_FAILED",
                    "synchronous record and inventory commit did not complete",
                )
            }
        } catch (failure: SecureStorageFailure) {
            throw failure
        } catch (failure: KeyPermanentlyInvalidatedException) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_KEY_INVALIDATED",
                "AndroidKeyStore key is permanently invalidated",
                failure,
            )
        } catch (failure: UnrecoverableKeyException) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_KEY_INVALIDATED",
                "AndroidKeyStore key cannot be recovered",
                failure,
            )
        } catch (failure: Exception) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_CRYPTO_FAILED",
                "encryption failed",
                failure,
            )
        } finally {
            plaintext.fill(0)
        }
    }

    fun get(logicalKey: String): String? {
        validateLogicalKey(logicalKey)
        val encoded = preferences.getString(
            SecureStorageEncoding.preferenceKey(logicalKey),
            null,
        ) ?: return null

        val plaintext = decrypt(requireExistingKey(), logicalKey, decodeStoredRecord(encoded))
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(plaintext))
                .toString()
        } catch (failure: Exception) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_CORRUPT",
                "decrypted value is not valid UTF-8",
                failure,
            )
        } finally {
            plaintext.fill(0)
        }
    }

    fun remove(logicalKey: String) {
        validateLogicalKey(logicalKey)
        val preferenceKey = SecureStorageEncoding.preferenceKey(logicalKey)
        val encoded = preferences.getString(preferenceKey, null)
        val hasInventory = preferences.contains(INVENTORY_PREFERENCE_KEY)
        if (encoded == null && !hasInventory) return

        val key = requireExistingKey()
        if (encoded != null) {
            val record = decodeStoredRecord(encoded)
            decrypt(key, logicalKey, record).fill(0)
        }
        val inventory = loadInventory(key).apply {
            remove(logicalKey)
        }
        val editor = preferences.edit().remove(preferenceKey)
        if (inventory.isEmpty()) {
            editor.remove(INVENTORY_PREFERENCE_KEY)
        } else {
            editor.putString(INVENTORY_PREFERENCE_KEY, encodeInventory(key, inventory))
        }
        if (!editor.commit()) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_COMMIT_FAILED",
                "synchronous record and inventory removal did not complete",
            )
        }
    }

    fun list(prefix: String): List<String> {
        validateLogicalKey(prefix)
        if (!preferences.contains(INVENTORY_PREFERENCE_KEY)) return emptyList()
        return loadInventory(requireExistingKey())
            .filter { logicalKey -> logicalKey.startsWith(prefix) }
            .sorted()
    }

    private fun loadInventory(key: SecretKey): MutableSet<String> {
        val encoded = preferences.getString(INVENTORY_PREFERENCE_KEY, null)
            ?: return linkedSetOf()
        val plaintext = decrypt(
            key,
            INVENTORY_LOGICAL_KEY,
            decodeStoredRecord(encoded),
        )
        return try {
            val array = JSONArray(plaintext.toString(Charsets.UTF_8))
            if (array.length() > MAX_RECORD_COUNT) {
                throw SecureStorageFailure(
                    "SECURE_STORAGE_CORRUPT",
                    "record inventory exceeds the supported limit",
                )
            }
            buildSet {
                for (index in 0 until array.length()) {
                    val logicalKey = array.optString(index, "")
                    validateLogicalKey(logicalKey)
                    add(logicalKey)
                }
            }.toMutableSet()
        } catch (failure: SecureStorageFailure) {
            throw failure
        } catch (failure: Exception) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_CORRUPT",
                "record inventory is malformed",
                failure,
            )
        } finally {
            plaintext.fill(0)
        }
    }

    private fun encodeInventory(key: SecretKey, inventory: Set<String>): String {
        if (inventory.size > MAX_RECORD_COUNT) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_INVALID_VALUE",
                "record inventory exceeds the supported limit",
            )
        }
        val plaintext = JSONArray(inventory.sorted()).toString().toByteArray(Charsets.UTF_8)
        return try {
            val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val iv = cipher.iv
            if (iv.size != IV_SIZE_BYTES) {
                throw SecureStorageFailure(
                    "SECURE_STORAGE_CRYPTO_FAILED",
                    "AndroidKeyStore generated an invalid inventory GCM IV",
                )
            }
            cipher.updateAAD(SecureStorageEncoding.aad(applicationId, INVENTORY_LOGICAL_KEY))
            val sealed = cipher.doFinal(plaintext)
            val record = SecureStorageRecordCodec.encode(
                EncryptedRecord(
                    iv = iv,
                    ciphertext = sealed.copyOfRange(0, sealed.size - TAG_SIZE_BYTES),
                    tag = sealed.copyOfRange(sealed.size - TAG_SIZE_BYTES, sealed.size),
                ),
            )
            Base64.encodeToString(record, Base64.NO_WRAP)
        } finally {
            plaintext.fill(0)
        }
    }

    private fun getOrCreateInitialKey(): SecretKey {
        if (keyStore.containsAlias(keyAlias)) {
            return requireExistingKey()
        }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        val parameters = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(AES_KEY_SIZE_BITS)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(false)
            .build()
        generator.init(parameters)
        return generator.generateKey()
    }

    private fun requireExistingKey(): SecretKey {
        if (!keyStore.containsAlias(keyAlias)) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_KEY_MISSING",
                "AndroidKeyStore alias is missing for persisted secure data",
            )
        }
        return keyStore.getKey(keyAlias, null) as? SecretKey
            ?: throw SecureStorageFailure(
                "SECURE_STORAGE_KEY_MISSING",
                "AndroidKeyStore alias does not contain an AES key",
            )
    }

    private fun decrypt(
        key: SecretKey,
        logicalKey: String,
        record: EncryptedRecord,
    ): ByteArray {
        try {
            val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                key,
                GCMParameterSpec(TAG_SIZE_BITS, record.iv),
            )
            cipher.updateAAD(SecureStorageEncoding.aad(applicationId, logicalKey))
            return cipher.doFinal(record.ciphertext + record.tag)
        } catch (failure: AEADBadTagException) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_CORRUPT",
                "record authentication failed",
                failure,
            )
        } catch (failure: KeyPermanentlyInvalidatedException) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_KEY_INVALIDATED",
                "AndroidKeyStore key is permanently invalidated",
                failure,
            )
        } catch (failure: UnrecoverableKeyException) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_KEY_INVALIDATED",
                "AndroidKeyStore key cannot be recovered",
                failure,
            )
        } catch (failure: SecureStorageFailure) {
            throw failure
        } catch (failure: Exception) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_CRYPTO_FAILED",
                "decryption failed",
                failure,
            )
        }
    }

    private fun decodeStoredRecord(encoded: String): EncryptedRecord {
        try {
            val bytes = Base64.decode(encoded, Base64.NO_WRAP)
            if (Base64.encodeToString(bytes, Base64.NO_WRAP) != encoded) {
                throw RecordCorruptionException("record is not canonical base64")
            }
            return SecureStorageRecordCodec.decode(bytes)
        } catch (failure: RecordCorruptionException) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_CORRUPT",
                "stored record is malformed",
                failure,
            )
        } catch (failure: IllegalArgumentException) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_CORRUPT",
                "stored record is not valid base64",
                failure,
            )
        }
    }

    private fun validateLogicalKey(logicalKey: String) {
        if (
            logicalKey.isBlank() ||
            logicalKey.length > MAX_KEY_LENGTH ||
            logicalKey.any {
                !it.isLetterOrDigit() && it != '_' && it != '-' && it != '.'
            }
        ) {
            throw SecureStorageFailure(
                "SECURE_STORAGE_INVALID_KEY",
                "logical key is empty, too long, or contains unsupported characters",
            )
        }
    }

    internal fun clearTestStorage() {
        preferences.edit().clear().commit()
        if (keyStore.containsAlias(keyAlias)) {
            keyStore.deleteEntry(keyAlias)
        }
    }

    internal fun corruptTestRecord(logicalKey: String, encoded: String) {
        preferences.edit()
            .putString(SecureStorageEncoding.preferenceKey(logicalKey), encoded)
            .commit()
    }

    internal fun deleteTestKey() {
        if (keyStore.containsAlias(keyAlias)) {
            keyStore.deleteEntry(keyAlias)
        }
    }

    internal fun rawTestEntries(): Map<String, *> = preferences.all
}

internal data class EncryptedRecord(
    val iv: ByteArray,
    val ciphertext: ByteArray,
    val tag: ByteArray,
)

internal object SecureStorageRecordCodec {
    private val magic = byteArrayOf(0x50, 0x54, 0x53, 0x53)
    private const val VERSION: Byte = 1
    private const val ALGORITHM_AES_256_GCM: Byte = 1
    private const val HEADER_SIZE = 4 + 1 + 1 + 2 + 2 + 4

    fun encode(record: EncryptedRecord): ByteArray {
        require(record.iv.size == IV_SIZE_BYTES)
        require(record.tag.size == TAG_SIZE_BYTES)
        require(record.ciphertext.size <= MAX_VALUE_SIZE_BYTES)

        return ByteBuffer.allocate(
            HEADER_SIZE + record.iv.size + record.ciphertext.size + record.tag.size,
        )
            .order(ByteOrder.BIG_ENDIAN)
            .put(magic)
            .put(VERSION)
            .put(ALGORITHM_AES_256_GCM)
            .putShort(record.iv.size.toShort())
            .putShort(record.tag.size.toShort())
            .putInt(record.ciphertext.size)
            .put(record.iv)
            .put(record.ciphertext)
            .put(record.tag)
            .array()
    }

    fun decode(encoded: ByteArray): EncryptedRecord {
        if (encoded.size < HEADER_SIZE) {
            throw RecordCorruptionException("record header is truncated")
        }

        val buffer = ByteBuffer.wrap(encoded).order(ByteOrder.BIG_ENDIAN)
        val actualMagic = ByteArray(magic.size).also(buffer::get)
        if (!actualMagic.contentEquals(magic)) {
            throw RecordCorruptionException("record magic is invalid")
        }
        if (buffer.get() != VERSION) {
            throw RecordCorruptionException("record version is unsupported")
        }
        if (buffer.get() != ALGORITHM_AES_256_GCM) {
            throw RecordCorruptionException("record algorithm is unsupported")
        }

        val ivSize = buffer.short.toInt() and 0xffff
        val tagSize = buffer.short.toInt() and 0xffff
        val ciphertextSize = buffer.int
        if (
            ivSize != IV_SIZE_BYTES ||
            tagSize != TAG_SIZE_BYTES ||
            ciphertextSize < 0 ||
            ciphertextSize > MAX_VALUE_SIZE_BYTES
        ) {
            throw RecordCorruptionException("record lengths are invalid")
        }

        val expectedRemaining = ivSize + ciphertextSize + tagSize
        if (buffer.remaining() != expectedRemaining) {
            throw RecordCorruptionException("record payload length is invalid")
        }

        val iv = ByteArray(ivSize).also(buffer::get)
        val ciphertext = ByteArray(ciphertextSize).also(buffer::get)
        val tag = ByteArray(tagSize).also(buffer::get)
        return EncryptedRecord(iv = iv, ciphertext = ciphertext, tag = tag)
    }
}

internal object SecureStorageEncoding {
    fun preferenceKey(logicalKey: String): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(logicalKey.toByteArray(Charsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte) }
    }

    fun aad(applicationId: String, logicalKey: String): ByteArray {
        return "$applicationId\u0000$logicalKey".toByteArray(Charsets.UTF_8)
    }
}

internal class RecordCorruptionException(message: String) : Exception(message)

internal class SecureStorageFailure(
    val code: String,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)
