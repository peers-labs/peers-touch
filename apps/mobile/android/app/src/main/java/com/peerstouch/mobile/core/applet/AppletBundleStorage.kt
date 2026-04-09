package com.peerstouch.mobile.core.applet

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URL

class AppletBundleStorage constructor(
    private val context: Context
) {
    private val gson = Gson()

    private val bundlesDir: File
        get() = File(context.filesDir, BUNDLES_DIR).also { it.mkdirs() }

    fun getBundlePath(appletId: String): File? {
        val dir = File(bundlesDir, appletId)
        return if (dir.exists() && File(dir, MANIFEST_FILE).exists()) dir else null
    }

    suspend fun downloadBundle(appletId: String, url: String): File = withContext(Dispatchers.IO) {
        val targetDir = File(bundlesDir, appletId).also { it.mkdirs() }
        try {
            val connection = URL(url).openConnection()
            connection.getInputStream().use { input ->
                val bundleFile = File(targetDir, "bundle.js")
                bundleFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
            targetDir
        } catch (e: Exception) {
            targetDir.deleteRecursively()
            throw e
        }
    }

    fun deleteBundle(appletId: String) {
        val dir = File(bundlesDir, appletId)
        if (dir.exists()) {
            dir.deleteRecursively()
        }
    }

    @Suppress("UNCHECKED_CAST")
    fun listCachedBundles(): List<AppletManifest> {
        val manifests = mutableListOf<AppletManifest>()
        bundlesDir.listFiles()?.forEach { dir ->
            if (!dir.isDirectory) return@forEach
            val manifestFile = File(dir, MANIFEST_FILE)
            if (!manifestFile.exists()) return@forEach
            try {
                val raw: Map<String, Any?> = gson.fromJson(
                    manifestFile.readText(),
                    object : TypeToken<Map<String, Any?>>() {}.type
                )
                val result = AppletManifestParser.parse(raw, dir.name)
                if (result is ParseResult.Success) {
                    manifests.add(result.value)
                }
            } catch (_: Exception) {
            }
        }
        return manifests
    }

    companion object {
        private const val BUNDLES_DIR = "applet_bundles"
        private const val MANIFEST_FILE = "applet.json"
    }
}
