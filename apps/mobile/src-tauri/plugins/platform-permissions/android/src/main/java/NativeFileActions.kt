package com.peers.touch.mobile.platformpermissions

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

class ChatFileProvider : FileProvider()

@InvokeArg
class NativeFileActionArgs {
    lateinit var requestId: String
    lateinit var kind: String
    lateinit var localPath: String
    lateinit var mimeType: String
    var deadlineMs: Long = 0
}

@InvokeArg
class NativeFileActionCancellationArgs {
    lateinit var requestId: String
}

private data class FileAction(
    val args: NativeFileActionArgs,
    val invoke: Invoke,
    val file: File,
    val cancelled: AtomicBoolean = AtomicBoolean(false),
)

/** Platform presentation over Rust-owned disposable files, never Chat cache. */
class NativeFileActions(
    private val activity: Activity,
    private val onExportFinished: () -> Unit,
) {
    private var active: FileAction? = null
    private val handler = Handler(Looper.getMainLooper())
    private var timeout: Runnable? = null
    private val cancellations = mutableMapOf<String, Long>()
    private var cancelledAllAt = 0L

    fun ownsExportPresentation(): Boolean = synchronized(this) {
        active?.let {
            it.args.kind == "save_copy" && !it.cancelled.get() &&
                System.currentTimeMillis() < it.args.deadlineMs
        } ?: false
    }

    fun execute(invoke: Invoke, launchExport: (Intent) -> Unit) {
        val args = invoke.parseArgs(NativeFileActionArgs::class.java)
        val now = System.currentTimeMillis()
        cancellations.entries.removeAll { it.value + 300_000 <= now }
        if (cancellations.containsKey(args.requestId) ||
            args.deadlineMs <= cancelledAllAt + 300_000) {
            resolve(invoke, args.requestId, "cancelled", "file_action_stale")
            return
        }
        val root = File(activity.cacheDir, "peers-touch-file-handoff").canonicalFile
        val file = File(args.localPath).canonicalFile
        if (args.deadlineMs <= now || args.deadlineMs - now > 300_000 ||
            !file.isFile || !file.path.startsWith(root.path + File.separator) ||
            args.kind !in listOf("preview", "open_external", "save_copy")) {
            resolve(invoke, args.requestId, "failed", "file_action_invalid")
            return
        }
        if (args.kind == "preview") {
            resolve(invoke, args.requestId, "unavailable", "file_preview_unavailable")
            return
        }
        synchronized(this) {
            if (active != null) {
                resolve(invoke, args.requestId, "unavailable", "file_presentation_busy")
                return
            }
            active = FileAction(args, invoke, file)
        }
        timeout = Runnable { cancel(args.requestId, "file_action_expired") }
        handler.postDelayed(timeout!!, args.deadlineMs - now)
        val mime = args.mimeType.substringBefore(';').trim().lowercase().let {
            if (it.isEmpty() || it == "application/octet-stream") {
                MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase())
                    ?: "application/octet-stream"
            } else when (it) {
                "audio/m4a", "audio/x-m4a" -> "audio/mp4"
                "audio/x-wav" -> "audio/wav"
                else -> it
            }
        }
        try {
            if (args.kind == "save_copy") {
                launchExport(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mime
                    putExtra(Intent.EXTRA_TITLE, file.name)
                })
            } else {
                val uri = FileProvider.getUriForFile(
                    activity, "${activity.packageName}.chatfiles", file,
                )
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mime)
                    clipData = ClipData.newRawUri(file.name, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                if (intent.resolveActivity(activity.packageManager) == null) {
                    finish("unavailable", "file_application_unavailable")
                } else {
                    activity.startActivity(intent)
                    finish("completed", null)
                }
            }
        } catch (_: Exception) {
            finish("unavailable", "file_application_unavailable")
        }
    }

    fun exported(requestId: String, result: ActivityResult) {
        val action = synchronized(this) { active }
        if (action == null || action.args.requestId != requestId) {
            // ACTION_CREATE_DOCUMENT may return after Rust revoked the action.
            // Remove only the new document created by this owned picker.
            if (result.resultCode == Activity.RESULT_OK) {
                result.data?.data?.let { uri ->
                    Thread {
                        try { DocumentsContract.deleteDocument(activity.contentResolver, uri) } catch (_: Exception) {}
                    }.start()
                }
            }
            return
        }
        if (result.resultCode != Activity.RESULT_OK || result.data?.data == null) {
            finish("cancelled", null)
            return
        }
        val uri = result.data!!.data!!
        Thread {
            try {
                action.file.inputStream().use { source ->
                    val output = activity.contentResolver.openOutputStream(uri, "w")
                        ?: throw IllegalStateException("export unavailable")
                    output.use { target ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            if (action.cancelled.get() || System.currentTimeMillis() > action.args.deadlineMs) {
                                throw InterruptedException()
                            }
                            val count = source.read(buffer)
                            if (count < 0) break
                            target.write(buffer, 0, count)
                        }
                        target.flush()
                    }
                }
                if (action.cancelled.get() || System.currentTimeMillis() > action.args.deadlineMs) {
                    throw InterruptedException()
                }
                handler.post {
                    if (action.cancelled.get()) {
                        Thread {
                            try { DocumentsContract.deleteDocument(activity.contentResolver, uri) } catch (_: Exception) {}
                        }.start()
                    } else {
                        finishFor(action, "completed", null)
                    }
                }
            } catch (_: InterruptedException) {
                try { DocumentsContract.deleteDocument(activity.contentResolver, uri) } catch (_: Exception) {}
                handler.post { finishFor(action, "cancelled", null) }
            } catch (_: Exception) {
                try { DocumentsContract.deleteDocument(activity.contentResolver, uri) } catch (_: Exception) {}
                handler.post { finishFor(action, "failed", "file_export_failed") }
            }
        }.start()
    }

    fun cancel(requestId: String, reason: String? = null) {
        val now = System.currentTimeMillis()
        cancellations.entries.removeAll { it.value + 300_000 <= now }
        if (requestId.isEmpty() ||
            (!cancellations.containsKey(requestId) && cancellations.size >= 256)) {
            // All retained cancellations precede this issuance watermark.
            // Compact them without rejecting newly issued actions.
            cancelledAllAt = now
            cancellations.clear()
        } else {
            cancellations[requestId] = now
        }
        val action = synchronized(this) {
            active?.takeIf { requestId.isEmpty() || it.args.requestId == requestId }
        } ?: return
        action.cancelled.set(true)
        finishFor(action, "cancelled", reason)
    }

    private fun finishFor(action: FileAction, state: String, reason: String?) {
        synchronized(this) {
            if (active !== action) return
            finish(state, reason)
        }
    }

    private fun finish(state: String, reason: String?) {
        val action = synchronized(this) { active.also { active = null } } ?: return
        timeout?.let { handler.removeCallbacks(it) }
        timeout = null
        resolve(action.invoke, action.args.requestId, state, reason)
        if (action.args.kind == "save_copy") onExportFinished()
    }

    private fun resolve(invoke: Invoke, requestId: String, state: String, reason: String?) {
        invoke.resolve(JSObject().apply {
            put("requestId", requestId)
            put("state", state)
            put("reason", reason)
        })
    }
}
