package com.peers.touch.mobile.platformpermissions

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.atomic.AtomicLong

private const val ERROR_INVALID_KIND = "PLATFORM_PERMISSION_INVALID_KIND"
private const val ERROR_REQUEST_IN_PROGRESS = "PLATFORM_PERMISSION_REQUEST_IN_PROGRESS"
private const val LIFECYCLE_EVENT = "lifecycle"

@InvokeArg
class PermissionArgs {
    lateinit var kind: String
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.CAMERA], alias = "camera"),
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
        Permission(
            strings = [Manifest.permission.READ_EXTERNAL_STORAGE],
            alias = "storageLegacy",
        ),
        Permission(strings = [Manifest.permission.READ_MEDIA_IMAGES], alias = "storageMedia"),
        Permission(
            strings = [Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED],
            alias = "storageSelected",
        ),
        Permission(
            strings = [Manifest.permission.POST_NOTIFICATIONS],
            alias = "notifications",
        ),
    ],
)
class PlatformPermissionsPlugin(private val activity: Activity) : Plugin(activity) {
    private val lifecycleSequence = AtomicLong(0)
    private var backgrounded = false
    private var permissionRequestInProgress = false

    @Command
    fun check(invoke: Invoke) {
        execute(invoke, "check") {
            val kind = parseKind(invoke)
            resolvePermission(invoke, permissionSnapshot(kind))
        }
    }

    @Command
    fun request(invoke: Invoke) {
        execute(invoke, "request") {
            val kind = parseKind(invoke)
            val current = permissionSnapshot(kind)
            if (
                current.status == PermissionStatus.Granted
                || current.status == PermissionStatus.Restricted
                || current.status == PermissionStatus.Unsupported
                || !current.canRequest
            ) {
                resolvePermission(invoke, current)
                return@execute
            }

            synchronized(this) {
                if (permissionRequestInProgress) {
                    invoke.reject(
                        "another platform permission request is already active",
                        ERROR_REQUEST_IN_PROGRESS,
                    )
                    return@execute
                }
                permissionRequestInProgress = true
            }

            try {
                requestPermissionForAliases(
                    requestAliases(kind),
                    invoke,
                    "permissionRequestCompleted",
                )
            } catch (error: Exception) {
                synchronized(this) {
                    permissionRequestInProgress = false
                }
                throw error
            }
        }
    }

    @PermissionCallback
    fun permissionRequestCompleted(invoke: Invoke) {
        synchronized(this) {
            permissionRequestInProgress = false
        }
        execute(invoke, "request-result") {
            resolvePermission(invoke, permissionSnapshot(parseKind(invoke)))
        }
    }

    override fun onStop() {
        if (!backgrounded) {
            backgrounded = true
            emitLifecycleSignal(LifecycleState.Background)
        }
    }

    override fun onResume() {
        if (backgrounded) {
            backgrounded = false
            emitLifecycleSignal(LifecycleState.Foreground)
        }
    }

    private fun permissionSnapshot(kind: PermissionKind): PermissionSnapshot {
        return when (kind) {
            PermissionKind.Camera -> permissionSnapshot("camera")
            PermissionKind.Microphone -> permissionSnapshot("microphone")
            PermissionKind.Storage -> storagePermissionSnapshot()
            PermissionKind.Notifications -> {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    PermissionSnapshot(PermissionStatus.Granted, false)
                } else {
                    permissionSnapshot("notifications")
                }
            }
        }
    }

    private fun storagePermissionSnapshot(): PermissionSnapshot {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            if (isGranted(Manifest.permission.READ_MEDIA_IMAGES)) {
                return PermissionSnapshot(PermissionStatus.Granted, false)
            }
            if (isGranted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)) {
                return PermissionSnapshot(PermissionStatus.Restricted, true)
            }
            return permissionSnapshot("storageMedia")
        }

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissionSnapshot("storageMedia")
        } else {
            permissionSnapshot("storageLegacy")
        }
    }

    private fun permissionSnapshot(alias: String): PermissionSnapshot {
        if (!isPermissionDeclared(alias)) {
            return PermissionSnapshot(PermissionStatus.Unsupported, false)
        }

        return when (getPermissionState(alias)) {
            PermissionState.GRANTED ->
                PermissionSnapshot(PermissionStatus.Granted, false)
            PermissionState.PROMPT ->
                PermissionSnapshot(PermissionStatus.NotDetermined, true)
            PermissionState.PROMPT_WITH_RATIONALE ->
                PermissionSnapshot(PermissionStatus.Denied, true)
            PermissionState.DENIED ->
                PermissionSnapshot(PermissionStatus.Denied, false)
            null ->
                PermissionSnapshot(PermissionStatus.Unsupported, false)
        }
    }

    private fun requestAliases(kind: PermissionKind): Array<String> {
        return when (kind) {
            PermissionKind.Camera -> arrayOf("camera")
            PermissionKind.Microphone -> arrayOf("microphone")
            PermissionKind.Storage -> {
                when {
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ->
                        arrayOf("storageMedia", "storageSelected")
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
                        arrayOf("storageMedia")
                    else -> arrayOf("storageLegacy")
                }
            }
            PermissionKind.Notifications -> arrayOf("notifications")
        }
    }

    private fun isGranted(permission: String): Boolean {
        return ActivityCompat.checkSelfPermission(
            activity,
            permission,
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun parseKind(invoke: Invoke): PermissionKind {
        val wireKind = invoke.parseArgs(PermissionArgs::class.java).kind
        return PermissionKind.fromWire(wireKind)
            ?: throw PermissionFailure(
                ERROR_INVALID_KIND,
                "unsupported platform permission kind",
            )
    }

    private fun resolvePermission(invoke: Invoke, snapshot: PermissionSnapshot) {
        val response = JSObject()
        response.put("status", snapshot.status.wireValue)
        response.put("canRequest", snapshot.canRequest)
        invoke.resolve(response)
    }

    private fun emitLifecycleSignal(state: LifecycleState) {
        val payload = JSObject()
        payload.put("platform", "android")
        payload.put("state", state.wireValue)
        payload.put("sequence", lifecycleSequence.incrementAndGet())
        payload.put("timestampMs", System.currentTimeMillis())
        trigger(LIFECYCLE_EVENT, payload)
    }

    private fun execute(invoke: Invoke, operation: String, action: () -> Unit) {
        try {
            action()
        } catch (failure: PermissionFailure) {
            invoke.reject("$operation failed: ${failure.message}", failure.code)
        } catch (error: Exception) {
            invoke.reject(
                "$operation failed unexpectedly (${error.javaClass.simpleName})",
                "PLATFORM_PERMISSION_FAILED",
            )
        }
    }
}

private enum class PermissionKind(val wireValue: String) {
    Camera("camera"),
    Microphone("microphone"),
    Storage("storage"),
    Notifications("notifications");

    companion object {
        fun fromWire(value: String): PermissionKind? {
            return entries.firstOrNull { it.wireValue == value }
        }
    }
}

private enum class PermissionStatus(val wireValue: String) {
    NotDetermined("not_determined"),
    Granted("granted"),
    Denied("denied"),
    Restricted("restricted"),
    Unsupported("unsupported"),
}

private enum class LifecycleState(val wireValue: String) {
    Foreground("foreground"),
    Background("background"),
}

private data class PermissionSnapshot(
    val status: PermissionStatus,
    val canRequest: Boolean,
)

private class PermissionFailure(
    val code: String,
    message: String,
) : Exception(message)
