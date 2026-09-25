package com.peers.touch.mobile.platformpermissions

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType as WorkNetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID

private const val ERROR_INVALID_KIND = "PLATFORM_PERMISSION_INVALID_KIND"
private const val ERROR_REQUEST_IN_PROGRESS = "PLATFORM_PERMISSION_REQUEST_IN_PROGRESS"
private const val LIFECYCLE_EVENT = "lifecycle"
private const val NETWORK_EVENT = "network"

@InvokeArg
class PermissionArgs {
    lateinit var kind: String
}

@InvokeArg
class PushArmArgs {
    var lifecycleGeneration: Long = 0
    lateinit var environment: String
}

@InvokeArg
class ScheduledCompletionArgs {
    lateinit var completionId: String
    var success: Boolean = false
}

@InvokeArg
class MediaPickArgs {
    lateinit var requestId: String
    lateinit var surfaceKind: String
    lateinit var capability: String
    var lifecycleGeneration: Long = 0
    var deadlineMs: Long = 0
    var acceptedMediaKinds: List<String> = emptyList()
    var maxItemCount: Int = 0
    var maxTotalBytes: Long = 0
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
    private val networkSequence = AtomicLong(0)
    private var backgrounded = false
    private var networkObservationStarted = false
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var permissionRequestInProgress = false
    private var pushLifecycleGeneration: Long? = null
    private var pushEnvironment: String? = null
    private val pushSequence = AtomicLong(0)
    private val pendingPushCallbacks = mutableListOf<JSObject>()
    private val pendingScheduledCallbacks = mutableListOf<JSObject>()
    private var activeMediaPick: Pair<MediaPickArgs, Invoke>? = null

    init {
        activeInstance = this
        File(activity.cacheDir, "peers-touch-native-picker").deleteRecursively()
    }

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

    @Command
    fun startNetworkObservation(invoke: Invoke) {
        execute(invoke, "start-network-observation") {
            synchronized(this) {
                if (!networkObservationStarted) {
                    val manager = activity.getSystemService(
                        Context.CONNECTIVITY_SERVICE,
                    ) as ConnectivityManager
                    val callback = object : ConnectivityManager.NetworkCallback() {
                        override fun onAvailable(network: Network) {
                            emitCurrentNetworkSignal()
                        }

                        override fun onLost(network: Network) {
                            emitCurrentNetworkSignal()
                        }

                        override fun onCapabilitiesChanged(
                            network: Network,
                            capabilities: NetworkCapabilities,
                        ) {
                            val connected = hasInternetCapability(capabilities)
                            emitNetworkSignal(
                                connected,
                                if (connected) networkType(capabilities) else NetworkType.None,
                            )
                        }
                    }
                    manager.registerDefaultNetworkCallback(callback)
                    connectivityManager = manager
                    networkCallback = callback
                    networkObservationStarted = true
                }
            }
            emitCurrentNetworkSignal(invoke::resolve)
        }
    }

    @Command
    fun armPush(invoke: Invoke) {
        execute(invoke, "arm-push") {
            val args = invoke.parseArgs(PushArmArgs::class.java)
            if (
                args.lifecycleGeneration <= 0
                || (args.environment != "development" && args.environment != "production")
            ) {
                invoke.reject("invalid push arm request", "PLATFORM_PUSH_INVALID_ARM")
                return@execute
            }
            synchronized(this) {
                pushLifecycleGeneration = args.lifecycleGeneration
                pushEnvironment = args.environment
                pendingPushCallbacks.clear()
            }
            val response = JSObject()
            response.put("armed", true)
            invoke.resolve(response)
        }
    }

    @Command
    fun drainPushCallbacks(invoke: Invoke) {
        execute(invoke, "drain-push-callbacks") {
            val callbacks = JSArray()
            synchronized(this) {
                pendingPushCallbacks.forEach(callbacks::put)
                pendingPushCallbacks.clear()
            }
            val response = JSObject()
            response.put("callbacks", callbacks)
            invoke.resolve(response)
        }
    }

    @Command
    fun disarmPush(invoke: Invoke) {
        execute(invoke, "disarm-push") {
            synchronized(this) {
                pushLifecycleGeneration = null
                pushEnvironment = null
                pendingPushCallbacks.clear()
                pendingScheduledCallbacks.clear()
            }
            expireAllScheduled()
            WorkManager.getInstance(activity).apply {
                cancelUniqueWork(SCHEDULE_DEVELOPMENT_IDENTIFIER)
                cancelUniqueWork(SCHEDULE_PRODUCTION_IDENTIFIER)
            }
            invoke.resolve()
        }
    }

    @Command
    fun scheduleReconcile(invoke: Invoke) {
        execute(invoke, "schedule-reconcile") {
            val args = invoke.parseArgs(PushArmArgs::class.java)
            val identifier = scheduledIdentifier(args.environment)
            if (args.lifecycleGeneration <= 0 || identifier == null) {
                invoke.reject("invalid scheduled reconcile request", "PLATFORM_SCHEDULE_INVALID")
                return@execute
            }
            synchronized(this) {
                pushLifecycleGeneration = args.lifecycleGeneration
                pushEnvironment = args.environment
                pendingScheduledCallbacks.clear()
            }
            expireAllScheduled()
            val request = PeriodicWorkRequestBuilder<ReconcileWorker>(
                15,
                TimeUnit.MINUTES,
            )
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(WorkNetworkType.CONNECTED)
                        .build(),
                )
                .setInputData(
                    androidx.work.workDataOf(
                        SCHEDULE_IDENTIFIER_KEY to identifier,
                        SCHEDULE_GENERATION_KEY to args.lifecycleGeneration,
                    ),
                )
                .build()
            val workManager = WorkManager.getInstance(activity)
            val inactiveIdentifier = if (identifier == SCHEDULE_DEVELOPMENT_IDENTIFIER) {
                SCHEDULE_PRODUCTION_IDENTIFIER
            } else {
                SCHEDULE_DEVELOPMENT_IDENTIFIER
            }
            workManager.cancelUniqueWork(inactiveIdentifier)
            workManager.enqueueUniquePeriodicWork(
                identifier,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
            val response = JSObject()
            response.put("identifier", identifier)
            response.put("registered", true)
            invoke.resolve(response)
        }
    }

    @Command
    fun drainScheduledCallbacks(invoke: Invoke) {
        execute(invoke, "drain-scheduled-callbacks") {
            val callbacks = JSArray()
            synchronized(this) {
                pendingScheduledCallbacks.forEach { callbacks.put(it) }
                pendingScheduledCallbacks.clear()
            }
            val response = JSObject()
            response.put("callbacks", callbacks)
            invoke.resolve(response)
        }
    }

    @Command
    fun completeScheduledCallback(invoke: Invoke) {
        execute(invoke, "complete-scheduled-callback") {
            val args = invoke.parseArgs(ScheduledCompletionArgs::class.java)
            completeScheduled(args.completionId, args.success)
            invoke.resolve()
        }
    }

    @Command
    fun pickMedia(invoke: Invoke) {
        execute(invoke, "pick-media") {
            val args = invoke.parseArgs(MediaPickArgs::class.java)
            if (!validMediaPickArgs(args)) {
                resolveMediaPick(invoke, args, "failed", JSArray(), "invalid_request")
                return@execute
            }
            synchronized(this) {
                if (activeMediaPick != null) {
                    resolveMediaPick(invoke, args, "failed", JSArray(), "picker_busy")
                    return@execute
                }
                activeMediaPick = Pair(args, invoke)
            }
            val intent = if (args.capability == "camera") {
                if (!isGranted(Manifest.permission.CAMERA)) {
                    synchronized(this) {
                        activeMediaPick = null
                    }
                    resolveMediaPick(
                        invoke,
                        args,
                        "permission_required",
                        JSArray(),
                        "camera_permission_required",
                    )
                    return@execute
                }
                Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            } else {
                Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, args.maxItemCount > 1)
                    putExtra(Intent.EXTRA_MIME_TYPES, acceptedMimeTypes(args).toTypedArray())
                }
            }
            try {
                startActivityForResult(invoke, intent, "mediaPickCompleted")
                activity.window.decorView.postDelayed(
                    {
                        val expired = synchronized(this) {
                            val active = activeMediaPick
                            if (active?.first?.requestId == args.requestId) {
                                activeMediaPick = null
                                active
                            } else {
                                null
                            }
                        }
                        expired?.let { (expiredArgs, expiredInvoke) ->
                            resolveMediaPick(
                                expiredInvoke,
                                expiredArgs,
                                "expired",
                                JSArray(),
                                null,
                            )
                        }
                    },
                    (args.deadlineMs - System.currentTimeMillis()).coerceAtLeast(0),
                )
            } catch (_: Exception) {
                synchronized(this) {
                    activeMediaPick = null
                }
                resolveMediaPick(
                    invoke,
                    args,
                    "failed",
                    JSArray(),
                    "picker_launch_failed",
                )
            }
        }
    }

    @ActivityCallback
    fun mediaPickCompleted(invoke: Invoke, result: ActivityResult) {
        val args = invoke.parseArgs(MediaPickArgs::class.java)
        val claimed = synchronized(this) {
            if (activeMediaPick?.first?.requestId != args.requestId) {
                false
            } else {
                activeMediaPick = null
                true
            }
        }
        if (!claimed) {
            return
        }
        try {
            if (System.currentTimeMillis() > args.deadlineMs) {
                resolveMediaPick(invoke, args, "expired", JSArray(), null)
                return
            }
            if (result.resultCode != Activity.RESULT_OK || result.data == null) {
                resolveMediaPick(invoke, args, "cancelled", JSArray(), null)
                return
            }
            if (args.capability == "camera") {
                val bitmap = result.data?.extras?.get("data") as? Bitmap
                if (bitmap == null) {
                    resolveMediaPick(invoke, args, "failed", JSArray(), "camera_result_missing")
                    return
                }
                resolveMediaPick(
                    invoke,
                    args,
                    "selected",
                    copyCameraBitmap(args, bitmap),
                    null,
                )
                return
            }
            val uris = mutableListOf<android.net.Uri>()
            result.data?.clipData?.let { clip ->
                for (index in 0 until clip.itemCount) {
                    uris.add(clip.getItemAt(index).uri)
                }
            }
            result.data?.data?.let { uri ->
                if (uris.none { it == uri }) {
                    uris.add(uri)
                }
            }
            if (uris.isEmpty() || uris.size > args.maxItemCount) {
                resolveMediaPick(invoke, args, "failed", JSArray(), "invalid_item_count")
                return
            }
            val items = copyPickedUris(args, uris)
            resolveMediaPick(invoke, args, "selected", items, null)
        } catch (_: Exception) {
            resolveMediaPick(invoke, args, "failed", JSArray(), "native_copy_failed")
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

    override fun onDestroy() {
        synchronized(this) {
            networkCallback?.let { callback ->
                connectivityManager?.unregisterNetworkCallback(callback)
            }
            networkCallback = null
            connectivityManager = null
            networkObservationStarted = false
            pushLifecycleGeneration = null
            pushEnvironment = null
            pendingPushCallbacks.clear()
            pendingScheduledCallbacks.clear()
            activeMediaPick?.let { (args, invoke) ->
                resolveMediaPick(
                    invoke,
                    args,
                    "failed",
                    JSArray(),
                    "picker_teardown",
                )
            }
            activeMediaPick = null
        }
        if (activeInstance === this) {
            activeInstance = null
        }
        super.onDestroy()
    }

    private fun enqueuePushToken(
        fcmToken: String? = null,
        unifiedEndpoint: String? = null,
        unifiedP256dhBase64: String? = null,
        unifiedAuthBase64: String? = null,
    ) {
        val generation: Long
        val environment: String
        val callback: JSObject
        synchronized(this) {
            generation = pushLifecycleGeneration ?: return
            environment = pushEnvironment ?: return
            callback = JSObject()
            callback.put("kind", "token")
            callback.put("platform", "android")
            callback.put("sequence", pushSequence.incrementAndGet())
            callback.put("lifecycleGeneration", generation)
            callback.put("environment", environment)
            fcmToken?.let { callback.put("fcmToken", it) }
            unifiedEndpoint?.let { callback.put("unifiedEndpoint", it) }
            unifiedP256dhBase64?.let { callback.put("unifiedP256dhBase64", it) }
            unifiedAuthBase64?.let { callback.put("unifiedAuthBase64", it) }
            pendingPushCallbacks.add(callback)
        }
        emitPushAvailable(generation)
    }

    private fun enqueuePushWakeup(
        kind: String,
        notificationId: String,
        category: Int,
        targetHint: String,
        issuedAtMs: Long,
        expiresAtMs: Long,
    ) {
        val generation: Long
        synchronized(this) {
            generation = pushLifecycleGeneration ?: return
            val callback = JSObject()
            callback.put("kind", kind)
            callback.put("platform", "android")
            callback.put("sequence", pushSequence.incrementAndGet())
            callback.put("lifecycleGeneration", generation)
            callback.put("notificationId", notificationId)
            callback.put("category", category)
            callback.put("targetHint", targetHint)
            callback.put("issuedAtMs", issuedAtMs)
            callback.put("expiresAtMs", expiresAtMs)
            pendingPushCallbacks.add(callback)
        }
        emitPushAvailable(generation)
    }

    private fun emitPushAvailable(generation: Long) {
        activity.runOnUiThread {
            val payload = JSObject()
            payload.put("lifecycleGeneration", generation)
            synchronized(this) {
                payload.put("pendingCount", pendingPushCallbacks.size)
            }
            trigger(PUSH_AVAILABLE_EVENT, payload)
        }
    }

    private fun enqueueScheduledCallback(
        completionId: String,
        identifier: String,
        sequence: Long,
        generation: Long,
        deadlineMs: Long,
    ) {
        synchronized(this) {
            val callback = JSObject()
            callback.put("completionId", completionId)
            callback.put("identifier", identifier)
            callback.put("platform", "android")
            callback.put("sequence", sequence)
            callback.put("lifecycleGeneration", generation)
            callback.put("deadlineMs", deadlineMs)
            pendingScheduledCallbacks.add(callback)
        }
        activity.runOnUiThread {
            val payload = JSObject()
            payload.put("lifecycleGeneration", generation)
            synchronized(this) {
                payload.put("pendingCount", pendingScheduledCallbacks.size)
            }
            trigger(SCHEDULED_AVAILABLE_EVENT, payload)
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
                return PermissionSnapshot(PermissionStatus.Granted, false)
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

    private fun emitCurrentNetworkSignal(onEmitted: (JSObject) -> Unit = { _ -> }) {
        val capabilities = connectivityManager
            ?.activeNetwork
            ?.let { network -> connectivityManager?.getNetworkCapabilities(network) }
        val connected = capabilities?.let(::hasInternetCapability) == true
        emitNetworkSignal(
            connected = connected,
            type = if (connected && capabilities != null) {
                networkType(capabilities)
            } else {
                NetworkType.None
            },
            onEmitted = onEmitted,
        )
    }

    private fun emitNetworkSignal(
        connected: Boolean,
        type: NetworkType,
        onEmitted: (JSObject) -> Unit = { _ -> },
    ) {
        activity.runOnUiThread {
            val payload = JSObject()
            payload.put("platform", "android")
            payload.put("connected", connected)
            payload.put("networkType", if (connected) type.wireValue else NetworkType.None.wireValue)
            payload.put("sequence", networkSequence.incrementAndGet())
            payload.put("timestampMs", System.currentTimeMillis())
            trigger(NETWORK_EVENT, payload)
            onEmitted(payload)
        }
    }

    private fun networkType(capabilities: NetworkCapabilities): NetworkType {
        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ->
                NetworkType.Wifi
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ->
                NetworkType.Cellular
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ->
                NetworkType.Ethernet
            else -> NetworkType.Unknown
        }
    }

    private fun hasInternetCapability(capabilities: NetworkCapabilities): Boolean {
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
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

    private fun validMediaPickArgs(args: MediaPickArgs): Boolean {
        return args.requestId.isNotBlank()
            && (args.surfaceKind == "chat_attachment" || args.surfaceKind == "moment_media")
            && (
                args.capability == "photo_library"
                    || args.capability == "camera"
                    || args.capability == "document"
                )
            && args.lifecycleGeneration > 0
            && args.deadlineMs > System.currentTimeMillis()
            && args.deadlineMs <= System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(5)
            && args.maxItemCount in 1..10
            && args.maxTotalBytes in 1..(64L * 1024 * 1024)
            && args.acceptedMediaKinds.isNotEmpty()
            && args.acceptedMediaKinds.all { it == "image" || it == "video" || it == "file" }
    }

    private fun acceptedMimeTypes(args: MediaPickArgs): List<String> {
        val result = mutableListOf<String>()
        if ("image" in args.acceptedMediaKinds) result.add("image/*")
        if ("video" in args.acceptedMediaKinds) result.add("video/*")
        if ("file" in args.acceptedMediaKinds) result.add("application/*")
        return result
    }

    private fun copyPickedUris(
        args: MediaPickArgs,
        uris: List<android.net.Uri>,
    ): JSArray {
        val root = File(
            activity.cacheDir,
            "peers-touch-native-picker/${args.requestId}",
        )
        if (!root.mkdirs() && !root.isDirectory) {
            throw IllegalStateException("native picker cache is unavailable")
        }
        val created = mutableListOf<File>()
        val items = JSArray()
        var totalBytes = 0L
        try {
            for (uri in uris) {
                val mimeType = activity.contentResolver.getType(uri)
                    ?: "application/octet-stream"
                val mediaKind = when {
                    mimeType.startsWith("image/") -> "image"
                    mimeType.startsWith("video/") -> "video"
                    else -> "file"
                }
                if (mediaKind !in args.acceptedMediaKinds) {
                    throw IllegalArgumentException("selected media kind is not accepted")
                }
                val destination = File(root, "${UUID.randomUUID()}.stage")
                val digest = MessageDigest.getInstance("SHA-256")
                var copied = 0L
                activity.contentResolver.openInputStream(uri).use { input ->
                    if (input == null) throw IllegalStateException("selected media unavailable")
                    FileOutputStream(destination).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            if (count == 0) continue
                            copied += count
                            totalBytes += count
                            if (totalBytes > args.maxTotalBytes) {
                                throw IllegalArgumentException("selected media exceeds size limit")
                            }
                            digest.update(buffer, 0, count)
                            output.write(buffer, 0, count)
                        }
                        output.fd.sync()
                    }
                }
                if (copied <= 0) throw IllegalArgumentException("selected media is empty")
                created.add(destination)
                val item = JSObject()
                item.put("localPath", destination.absolutePath)
                item.put("mediaKind", mediaKind)
                item.put("mimeType", mimeType)
                item.put("byteLength", copied)
                item.put(
                    "sha256Base64",
                    Base64.encodeToString(digest.digest(), Base64.NO_WRAP),
                )
                items.put(item)
            }
            return items
        } catch (error: Exception) {
            created.forEach(File::delete)
            throw error
        }
    }

    private fun copyCameraBitmap(args: MediaPickArgs, bitmap: Bitmap): JSArray {
        if ("image" !in args.acceptedMediaKinds) {
            throw IllegalArgumentException("camera image is not accepted")
        }
        val root = File(
            activity.cacheDir,
            "peers-touch-native-picker/${args.requestId}",
        )
        if (!root.mkdirs() && !root.isDirectory) {
            throw IllegalStateException("native picker cache is unavailable")
        }
        val destination = File(root, "${UUID.randomUUID()}.stage")
        FileOutputStream(destination).use { output ->
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 95, output)) {
                throw IllegalStateException("camera image encoding failed")
            }
            output.fd.sync()
        }
        val bytes = destination.readBytes()
        if (bytes.isEmpty() || bytes.size.toLong() > args.maxTotalBytes) {
            destination.delete()
            throw IllegalArgumentException("camera image exceeds size limit")
        }
        val item = JSObject()
        item.put("localPath", destination.absolutePath)
        item.put("mediaKind", "image")
        item.put("mimeType", "image/jpeg")
        item.put("byteLength", bytes.size.toLong())
        item.put(
            "sha256Base64",
            Base64.encodeToString(
                MessageDigest.getInstance("SHA-256").digest(bytes),
                Base64.NO_WRAP,
            ),
        )
        return JSArray().apply { put(item) }
    }

    private fun resolveMediaPick(
        invoke: Invoke,
        args: MediaPickArgs,
        outcome: String,
        items: JSArray,
        errorCode: String?,
    ) {
        val response = JSObject()
        response.put("requestId", args.requestId)
        response.put("lifecycleGeneration", args.lifecycleGeneration)
        response.put("outcome", outcome)
        response.put("items", items)
        errorCode?.let { response.put("errorCode", it) }
        invoke.resolve(response)
    }

    companion object {
        private const val PUSH_AVAILABLE_EVENT = "pushAvailable"
        private const val SCHEDULED_AVAILABLE_EVENT = "scheduledAvailable"
        private const val SCHEDULE_DEVELOPMENT_IDENTIFIER =
            "com.peers.touch.mobile.reconcile.v1.development"
        private const val SCHEDULE_PRODUCTION_IDENTIFIER =
            "com.peers.touch.mobile.reconcile.v1.production"
        internal const val SCHEDULE_IDENTIFIER_KEY = "peers_schedule_identifier"
        internal const val SCHEDULE_GENERATION_KEY = "peers_schedule_generation"
        private val scheduledSequence = AtomicLong(0)
        private val scheduledCompletions =
            ConcurrentHashMap<String, ScheduledCompletion>()

        @Volatile
        private var activeInstance: PlatformPermissionsPlugin? = null

        fun ingestFcmToken(token: String) {
            if (token.isNotBlank()) {
                activeInstance?.enqueuePushToken(fcmToken = token)
            }
        }

        fun ingestUnifiedPushEndpoint(
            endpoint: String,
            p256dhBase64: String,
            authBase64: String,
        ) {
            if (endpoint.isNotBlank() && p256dhBase64.isNotBlank() && authBase64.isNotBlank()) {
                activeInstance?.enqueuePushToken(
                    unifiedEndpoint = endpoint,
                    unifiedP256dhBase64 = p256dhBase64,
                    unifiedAuthBase64 = authBase64,
                )
            }
        }

        fun ingestPushReceipt(
            notificationId: String,
            category: Int,
            targetHint: String,
            issuedAtMs: Long,
            expiresAtMs: Long,
            tapped: Boolean,
        ) {
            activeInstance?.enqueuePushWakeup(
                kind = if (tapped) "tap" else "receipt",
                notificationId = notificationId,
                category = category,
                targetHint = targetHint,
                issuedAtMs = issuedAtMs,
                expiresAtMs = expiresAtMs,
            )
        }

        internal fun ingestScheduledCallback(
            identifier: String,
            generation: Long,
        ): ScheduledCallbackHandle? {
            val plugin = activeInstance ?: return null
            val acceptsCallback = synchronized(plugin) {
                val environment = plugin.pushEnvironment
                plugin.pushLifecycleGeneration == generation
                    && environment != null
                    && scheduledIdentifier(environment) == identifier
            }
            if (!acceptsCallback) {
                return null
            }
            val sequence = scheduledSequence.incrementAndGet()
            val completionId = "$identifier:$sequence"
            val completion = ScheduledCompletion()
            scheduledCompletions[completionId] = completion
            plugin.enqueueScheduledCallback(
                completionId = completionId,
                identifier = identifier,
                sequence = sequence,
                generation = generation,
                deadlineMs = System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(25),
            )
            return ScheduledCallbackHandle(completionId, completion)
        }

        private fun completeScheduled(completionId: String, success: Boolean) {
            scheduledCompletions.remove(completionId)?.complete(success)
        }

        internal fun expireScheduled(completionId: String) {
            scheduledCompletions.remove(completionId)?.complete(false)
        }

        private fun expireAllScheduled() {
            for ((completionId, completion) in scheduledCompletions.entries) {
                if (scheduledCompletions.remove(completionId, completion)) {
                    completion.complete(false)
                }
            }
        }

        private fun scheduledIdentifier(environment: String): String? {
            return when (environment) {
                "development" -> SCHEDULE_DEVELOPMENT_IDENTIFIER
                "production" -> SCHEDULE_PRODUCTION_IDENTIFIER
                else -> null
            }
        }
    }
}

internal data class ScheduledCallbackHandle(
    val completionId: String,
    val completion: ScheduledCompletion,
)

internal class ScheduledCompletion {
    private val latch = CountDownLatch(1)
    private val completed = AtomicBoolean(false)

    @Volatile
    private var success = false

    fun complete(value: Boolean) {
        if (!completed.compareAndSet(false, true)) {
            return
        }
        success = value
        latch.countDown()
    }

    fun await(): Boolean? {
        return if (latch.await(25, TimeUnit.SECONDS)) success else null
    }
}

class ReconcileWorker(
    context: Context,
    parameters: WorkerParameters,
) : Worker(context, parameters) {
    override fun doWork(): Result {
        val identifier = inputData.getString(
            PlatformPermissionsPlugin.SCHEDULE_IDENTIFIER_KEY,
        ) ?: return Result.failure()
        val generation = inputData.getLong(
            PlatformPermissionsPlugin.SCHEDULE_GENERATION_KEY,
            0,
        )
        if (generation <= 0) {
            return Result.failure()
        }
        val handle = PlatformPermissionsPlugin.ingestScheduledCallback(
            identifier,
            generation,
        ) ?: return Result.success()
        val completed = handle.completion.await()
        PlatformPermissionsPlugin.expireScheduled(handle.completionId)
        return when (completed) {
            true -> Result.success()
            false, null -> Result.retry()
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

private enum class NetworkType(val wireValue: String) {
    None("none"),
    Wifi("wifi"),
    Cellular("cellular"),
    Ethernet("ethernet"),
    Unknown("unknown"),
}

private data class PermissionSnapshot(
    val status: PermissionStatus,
    val canRequest: Boolean,
)

private class PermissionFailure(
    val code: String,
    message: String,
) : Exception(message)
