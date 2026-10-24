package com.peers.touch.mobile.platformpermissions

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
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
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID

private const val ERROR_INVALID_KIND = "PLATFORM_PERMISSION_INVALID_KIND"
private const val ERROR_REQUEST_IN_PROGRESS = "PLATFORM_PERMISSION_REQUEST_IN_PROGRESS"
private const val LIFECYCLE_EVENT = "lifecycle"
private const val NETWORK_EVENT = "network"
private const val PUSH_INTENT_MARKER = "peers_push_tap"
private const val PUSH_NOTIFICATION_ID = "notification_id"
private const val PUSH_CATEGORY = "category"
private const val PUSH_TARGET_HINT = "target_hint"
private const val PUSH_ISSUED_AT_MS = "issued_at_ms"
private const val PUSH_EXPIRES_AT_MS = "expires_at_ms"
private const val PUSH_NOTIFICATION_CHANNEL = "peers-touch-activity"

private fun validScopeToken(value: String): Boolean =
    value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' }

@InvokeArg
class PermissionArgs {
    lateinit var kind: String
}

@InvokeArg
class CapabilityObservationArgs {
    lateinit var capability: String
}

@InvokeArg
class SystemActionArgs {
    lateinit var kind: String
    var text: String? = null
    var url: String? = null
}

@InvokeArg
class PushArmArgs {
    var lifecycleGeneration: Long = 0
    lateinit var environment: String
    lateinit var scopeToken: String
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

private data class ActiveMediaPick(
    val args: MediaPickArgs,
    val invoke: Invoke,
    val captureUri: Uri? = null,
    val captureFile: File? = null,
)

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
    private var activeMediaPick: ActiveMediaPick? = null

    init {
        activeInstance = this
        File(activity.cacheDir, "peers-touch-native-picker").deleteRecursively()
    }

    override fun load(webView: WebView) {
        super.load(webView)
        ingestNotificationTap(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        ingestNotificationTap(intent)
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
    fun observeCapability(invoke: Invoke) {
        execute(invoke, "observe-capability") {
            val capability = invoke.parseArgs(
                CapabilityObservationArgs::class.java,
            ).capability
            val (state, source, detail) = capabilityObservation(capability)
            val response = JSObject()
            response.put("state", state)
            response.put("source", source)
            response.put("detail", detail)
            response.put("timestampMs", System.currentTimeMillis())
            invoke.resolve(response)
        }
    }

    @Command
    fun executeSystemAction(invoke: Invoke) {
        execute(invoke, "execute-system-action") {
            val args = invoke.parseArgs(SystemActionArgs::class.java)
            activity.runOnUiThread {
                try {
                    when (args.kind) {
                        "open_app_settings" -> {
                            val intent = Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:${activity.packageName}"),
                            )
                            resolveActivityAction(invoke, intent)
                        }
                        "open_external_url" -> {
                            val uri = args.url?.let(Uri::parse)
                            if (uri == null || uri.scheme !in setOf("http", "https")) {
                                resolveSystemAction(
                                    invoke,
                                    "failed",
                                    "invalid_external_url",
                                )
                            } else {
                                resolveActivityAction(
                                    invoke,
                                    Intent(Intent.ACTION_VIEW, uri),
                                )
                            }
                        }
                        "share" -> {
                            val text = args.text?.takeIf { it.isNotBlank() }
                            if (text == null) {
                                resolveSystemAction(
                                    invoke,
                                    "failed",
                                    "share_text_missing",
                                )
                            } else {
                                val body = buildString {
                                    append(text)
                                    args.url?.takeIf { it.isNotBlank() }?.let {
                                        append('\n')
                                        append(it)
                                    }
                                }
                                val share = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, body)
                                }
                                resolveActivityAction(
                                    invoke,
                                    Intent.createChooser(share, null),
                                )
                            }
                        }
                        "return_to_system" -> {
                            activity.finishAfterTransition()
                            resolveSystemAction(invoke, "completed", null)
                        }
                        else -> resolveSystemAction(
                            invoke,
                            "unavailable",
                            "unsupported_system_action",
                        )
                    }
                } catch (_: Exception) {
                    resolveSystemAction(
                        invoke,
                        "failed",
                        "system_action_failed",
                    )
                }
            }
        }
    }

    @Command
    fun observeLifecycle(invoke: Invoke) {
        activity.runOnUiThread {
            execute(invoke, "observe-lifecycle") {
                val owner = activity as? LifecycleOwner
                    ?: throw IllegalStateException("activity lifecycle is unavailable")
                val state = if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                    LifecycleState.Foreground
                } else {
                    LifecycleState.Background
                }
                invoke.resolve(makeLifecycleSignal(state))
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
                || !validScopeToken(args.scopeToken)
            ) {
                invoke.reject("invalid push arm request", "PLATFORM_PUSH_INVALID_ARM")
                return@execute
            }
            synchronized(this) {
                pushLifecycleGeneration = args.lifecycleGeneration
                pushEnvironment = args.environment
            }
            AndroidHostHandoff.arm(
                activity,
                args.lifecycleGeneration,
                args.environment,
                args.scopeToken,
            )
            val providerAvailable = FirebaseApp.getApps(activity).isNotEmpty()
            if (providerAvailable) {
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    if (task.isSuccessful && !task.result.isNullOrBlank()) {
                        ingestFcmToken(activity, task.result)
                    } else {
                        ingestPushRegistrationFailure(
                            activity,
                            "fcm_token_unavailable",
                        )
                    }
                }
            } else {
                synchronized(this) {
                    pushLifecycleGeneration = null
                    pushEnvironment = null
                }
                AndroidHostHandoff.disarm(activity)
            }
            val response = JSObject()
            response.put("armed", providerAvailable)
            invoke.resolve(response)
        }
    }

    @Command
    fun drainPushCallbacks(invoke: Invoke) {
        execute(invoke, "drain-push-callbacks") {
            val callbacks = JSArray()
            AndroidHostHandoff.drainPush(activity).forEach(callbacks::put)
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
            }
            AndroidHostHandoff.disarm(activity)
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
            if (
                args.lifecycleGeneration <= 0
                || identifier == null
                || !validScopeToken(args.scopeToken)
            ) {
                invoke.reject("invalid scheduled reconcile request", "PLATFORM_SCHEDULE_INVALID")
                return@execute
            }
            synchronized(this) {
                pushLifecycleGeneration = args.lifecycleGeneration
                pushEnvironment = args.environment
            }
            AndroidHostHandoff.arm(
                activity,
                args.lifecycleGeneration,
                args.environment,
                args.scopeToken,
            )
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
                        SCHEDULE_SCOPE_TOKEN_KEY to args.scopeToken,
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
            if (
                AndroidHostHandoff.materializeScheduledWake(
                    activity,
                    identifier,
                    args.lifecycleGeneration,
                    args.scopeToken,
                )
            ) {
                emitScheduledAvailable(args.lifecycleGeneration)
            }
        }
    }

    @Command
    fun drainScheduledCallbacks(invoke: Invoke) {
        execute(invoke, "drain-scheduled-callbacks") {
            val callbacks = JSArray()
            AndroidHostHandoff.drainScheduled(activity).forEach(callbacks::put)
            val response = JSObject()
            response.put("callbacks", callbacks)
            invoke.resolve(response)
        }
    }

    @Command
    fun completeScheduledCallback(invoke: Invoke) {
        execute(invoke, "complete-scheduled-callback") {
            val args = invoke.parseArgs(ScheduledCompletionArgs::class.java)
            if (args.completionId.isBlank()) {
                invoke.reject(
                    "invalid scheduled completion",
                    "PLATFORM_SCHEDULE_INVALID_COMPLETION",
                )
                return@execute
            }
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
            }
            val capture = if (args.capability == "camera") {
                if (!isGranted(Manifest.permission.CAMERA)) {
                    resolveMediaPick(
                        invoke,
                        args,
                        "permission_required",
                        JSArray(),
                        "camera_permission_required",
                    )
                    return@execute
                }
                createCameraCapture(args)
            } else {
                Triple(
                    Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, args.maxItemCount > 1)
                        putExtra(
                            Intent.EXTRA_MIME_TYPES,
                            acceptedMimeTypes(args).toTypedArray(),
                        )
                    },
                    null,
                    null,
                )
            }
            synchronized(this) {
                activeMediaPick = ActiveMediaPick(
                    args = args,
                    invoke = invoke,
                    captureUri = capture.second,
                    captureFile = capture.third,
                )
            }
            try {
                startActivityForResult(invoke, capture.first, "mediaPickCompleted")
                activity.window.decorView.postDelayed(
                    {
                        val expired = synchronized(this) {
                            val active = activeMediaPick
                            if (active?.args?.requestId == args.requestId) {
                                activeMediaPick = null
                                active
                            } else {
                                null
                            }
                        }
                        expired?.let { active ->
                            active.captureFile?.delete()
                            resolveMediaPick(
                                active.invoke,
                                active.args,
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
        val active = synchronized(this) {
            val current = activeMediaPick
            activeMediaPick = null
            current
        } ?: return
        val args = active.args
        try {
            if (System.currentTimeMillis() > args.deadlineMs) {
                active.captureFile?.delete()
                resolveMediaPick(invoke, args, "expired", JSArray(), null)
                return
            }
            if (result.resultCode != Activity.RESULT_OK) {
                active.captureFile?.delete()
                resolveMediaPick(invoke, args, "cancelled", JSArray(), null)
                return
            }
            if (args.capability == "camera") {
                val captureUri = active.captureUri
                if (captureUri == null) {
                    active.captureFile?.delete()
                    resolveMediaPick(invoke, args, "failed", JSArray(), "camera_result_missing")
                    return
                }
                val items = copyPickedUris(args, listOf(captureUri))
                active.captureFile?.delete()
                resolveMediaPick(
                    invoke,
                    args,
                    "selected",
                    items,
                    null,
                )
                return
            }
            if (result.data == null) {
                resolveMediaPick(invoke, args, "cancelled", JSArray(), null)
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
            active.captureFile?.delete()
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
            activeMediaPick?.let { active ->
                active.captureFile?.delete()
                resolveMediaPick(
                    active.invoke,
                    active.args,
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

    private fun emitPushAvailable(generation: Long) {
        activity.runOnUiThread {
            val payload = JSObject()
            payload.put("lifecycleGeneration", generation)
            payload.put(
                "pendingCount",
                AndroidHostHandoff.pushCount(activity),
            )
            trigger(PUSH_AVAILABLE_EVENT, payload)
        }
    }

    private fun emitScheduledAvailable(generation: Long) {
        activity.runOnUiThread {
            val payload = JSObject()
            payload.put("lifecycleGeneration", generation)
            payload.put(
                "pendingCount",
                AndroidHostHandoff.scheduledCount(activity),
            )
            trigger(SCHEDULED_AVAILABLE_EVENT, payload)
        }
    }

    private fun ingestNotificationTap(intent: Intent?) {
        if (intent?.getBooleanExtra(PUSH_INTENT_MARKER, false) != true) {
            return
        }
        intent.removeExtra(PUSH_INTENT_MARKER)
        ingestPushReceipt(
            activity,
            notificationId = intent.getStringExtra(PUSH_NOTIFICATION_ID).orEmpty(),
            category = intent.getIntExtra(PUSH_CATEGORY, 0),
            targetHint = intent.getStringExtra(PUSH_TARGET_HINT).orEmpty(),
            issuedAtMs = intent.getLongExtra(PUSH_ISSUED_AT_MS, 0),
            expiresAtMs = intent.getLongExtra(PUSH_EXPIRES_AT_MS, 0),
            tapped = true,
        )
    }

    private fun capabilityObservation(
        capability: String,
    ): Triple<String, String, String?> {
        return when (capability) {
            "camera" -> {
                if (!activity.packageManager.hasSystemFeature(
                        PackageManager.FEATURE_CAMERA_ANY,
                    )
                ) {
                    Triple("unavailable", "android.package-manager", "camera-hardware-missing")
                } else {
                    permissionCapability(
                        permissionSnapshot(PermissionKind.Camera),
                        "android.permission.camera",
                    )
                }
            }
            "microphone" -> permissionCapability(
                permissionSnapshot(PermissionKind.Microphone),
                "android.permission.microphone",
            )
            "photo-library" -> activityCapability(
                Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "image/*" },
                "android.storage-access-framework",
            )
            "document-picker" -> activityCapability(
                Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "application/pdf" },
                "android.storage-access-framework",
            )
            "notifications" -> {
                if (!NotificationManagerCompat.from(activity).areNotificationsEnabled()) {
                    Triple("denied", "android.notification-manager", "notifications-disabled")
                } else {
                    permissionCapability(
                        permissionSnapshot(PermissionKind.Notifications),
                        "android.permission.notifications",
                    )
                }
            }
            "push" -> {
                when {
                    FirebaseApp.getApps(activity).isEmpty() -> Triple(
                        "unavailable",
                        "android.firebase",
                        "provider-config-missing",
                    )
                    !NotificationManagerCompat.from(activity).areNotificationsEnabled() -> Triple(
                        "denied",
                        "android.firebase",
                        "notifications-disabled",
                    )
                    else -> Triple("available", "android.firebase", null)
                }
            }
            "background-execution" -> {
                try {
                    WorkManager.getInstance(activity)
                    Triple("available", "android.work-manager", null)
                } catch (_: Exception) {
                    Triple("unavailable", "android.work-manager", "work-manager-unavailable")
                }
            }
            "system-settings" -> activityCapability(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:${activity.packageName}"),
                ),
                "android.settings",
            )
            "share" -> activityCapability(
                Intent(Intent.ACTION_SEND).apply { type = "text/plain" },
                "android.intent",
            )
            else -> Triple("unsupported", "android.platform-host", "unknown-capability")
        }
    }

    private fun permissionCapability(
        snapshot: PermissionSnapshot,
        source: String,
    ): Triple<String, String, String?> {
        return when (snapshot.status) {
            PermissionStatus.Granted -> Triple("available", source, null)
            PermissionStatus.NotDetermined -> Triple(
                "unknown",
                source,
                "permission-not-determined",
            )
            PermissionStatus.Denied -> Triple("denied", source, "permission-denied")
            PermissionStatus.Restricted -> Triple(
                "restricted",
                source,
                "permission-restricted",
            )
            PermissionStatus.Unsupported -> Triple(
                "unsupported",
                source,
                "permission-unsupported",
            )
        }
    }

    private fun activityCapability(
        intent: Intent,
        source: String,
    ): Triple<String, String, String?> {
        return if (intent.resolveActivity(activity.packageManager) == null) {
            Triple("unavailable", source, "activity-handler-missing")
        } else {
            Triple("available", source, null)
        }
    }

    private fun resolveActivityAction(invoke: Invoke, intent: Intent) {
        if (intent.resolveActivity(activity.packageManager) == null) {
            resolveSystemAction(invoke, "unavailable", "activity-handler-missing")
            return
        }
        activity.startActivity(intent)
        resolveSystemAction(invoke, "completed", null)
    }

    private fun resolveSystemAction(
        invoke: Invoke,
        state: String,
        reason: String?,
    ) {
        val response = JSObject()
        response.put("state", state)
        reason?.let { response.put("reason", it) }
        invoke.resolve(response)
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

    private fun makeLifecycleSignal(state: LifecycleState): JSObject {
        val payload = JSObject()
        payload.put("platform", "android")
        payload.put("state", state.wireValue)
        payload.put("sequence", lifecycleSequence.incrementAndGet())
        payload.put("timestampMs", System.currentTimeMillis())
        return payload
    }

    private fun emitLifecycleSignal(state: LifecycleState) {
        trigger(LIFECYCLE_EVENT, makeLifecycleSignal(state))
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
        if ("file" in args.acceptedMediaKinds) {
            result.addAll(
                listOf(
                    "application/pdf",
                    "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "text/plain",
                ),
            )
        }
        return result
    }

    private fun createCameraCapture(args: MediaPickArgs): Triple<Intent, Uri, File> {
        val captureVideo =
            "video" in args.acceptedMediaKinds && "image" !in args.acceptedMediaKinds
        val root = File(
            activity.cacheDir,
            "peers-touch-native-picker/${args.requestId}",
        )
        if (!root.mkdirs() && !root.isDirectory) {
            throw IllegalStateException("native picker cache is unavailable")
        }
        val destination = File(
            root,
            if (captureVideo) "capture-${UUID.randomUUID()}.mp4"
            else "capture-${UUID.randomUUID()}.jpg",
        )
        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.fileprovider",
            destination,
        )
        val intent = Intent(
            if (captureVideo) MediaStore.ACTION_VIDEO_CAPTURE
            else MediaStore.ACTION_IMAGE_CAPTURE,
        ).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            clipData = ClipData.newRawUri("peers-touch-capture", uri)
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                    or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        }
        return Triple(intent, uri, destination)
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
        internal const val SCHEDULE_SCOPE_TOKEN_KEY = "peers_schedule_scope_token"

        @Volatile
        private var activeInstance: PlatformPermissionsPlugin? = null

        fun ingestFcmToken(context: Context, token: String) {
            if (token.isBlank()) return
            val generation = AndroidHostHandoff.enqueuePush(
                context,
                "token",
            ) { callback, scope ->
                callback.put("environment", scope.environment)
                callback.put("fcmToken", token)
            } ?: return
            activeInstance?.emitPushAvailable(generation)
        }

        fun ingestUnifiedPushEndpoint(
            context: Context,
            endpoint: String,
            p256dhBase64: String,
            authBase64: String,
        ) {
            if (endpoint.isNotBlank() && p256dhBase64.isNotBlank() && authBase64.isNotBlank()) {
                val generation = AndroidHostHandoff.enqueuePush(
                    context,
                    "token",
                ) { callback, scope ->
                    callback.put("environment", scope.environment)
                    callback.put("unifiedEndpoint", endpoint)
                    callback.put("unifiedP256dhBase64", p256dhBase64)
                    callback.put("unifiedAuthBase64", authBase64)
                } ?: return
                activeInstance?.emitPushAvailable(generation)
            }
        }

        fun ingestPushRegistrationFailure(context: Context, errorCode: String) {
            if (errorCode.isBlank()) return
            val generation = AndroidHostHandoff.enqueuePush(
                context,
                "registration_failed",
            ) { callback, scope ->
                callback.put("environment", scope.environment)
                callback.put("errorCode", errorCode)
            } ?: return
            activeInstance?.emitPushAvailable(generation)
        }

        fun ingestPushReceipt(
            context: Context,
            notificationId: String,
            category: Int,
            targetHint: String,
            issuedAtMs: Long,
            expiresAtMs: Long,
            tapped: Boolean,
        ) {
            if (
                notificationId.isBlank()
                || category !in 1..4
                || targetHint.isBlank()
                || issuedAtMs <= 0
                || expiresAtMs <= issuedAtMs
            ) {
                return
            }
            val generation = AndroidHostHandoff.enqueuePush(
                context,
                if (tapped) "tap" else "receipt",
            ) { callback, _ ->
                callback.put("notificationId", notificationId)
                callback.put("category", category)
                callback.put("targetHint", targetHint)
                callback.put("issuedAtMs", issuedAtMs)
                callback.put("expiresAtMs", expiresAtMs)
            } ?: return
            activeInstance?.emitPushAvailable(generation)
        }

        internal fun ingestScheduledCallback(
            context: Context,
            identifier: String,
            generation: Long,
            scopeToken: String,
        ): Boolean {
            val accepted = AndroidHostHandoff.enqueueScheduled(
                context = context,
                identifier = identifier,
                generation = generation,
                scopeToken = scopeToken,
            )
            if (
                accepted
                && activeInstance != null
                && AndroidHostHandoff.materializeScheduledWake(
                    context,
                    identifier,
                    generation,
                    scopeToken,
                )
            ) {
                activeInstance?.emitScheduledAvailable(generation)
            }
            return accepted
        }

        internal fun scheduledIdentifier(environment: String): String? {
            return when (environment) {
                "development" -> SCHEDULE_DEVELOPMENT_IDENTIFIER
                "production" -> SCHEDULE_PRODUCTION_IDENTIFIER
                else -> null
            }
        }
    }
}

private data class AndroidPushScope(
    val generation: Long,
    val environment: String,
    val scopeToken: String,
)

private object AndroidHostHandoff {
    private const val STORE = "peers-touch-platform-host-v1"
    private const val GENERATION = "push_generation"
    private const val ENVIRONMENT = "push_environment"
    private const val SCOPE_TOKEN = "push_scope_token"
    private const val PUSH_SEQUENCE = "push_sequence"
    private const val SCHEDULE_SEQUENCE = "schedule_sequence"
    private const val PUSH_CALLBACKS = "push_callbacks"
    private const val SCHEDULED_CALLBACKS = "scheduled_callbacks"
    private const val PENDING_SCHEDULED_WAKE = "pending_scheduled_wake"
    private const val MAX_CALLBACKS = 64
    private val lock = Any()

    fun arm(
        context: Context,
        generation: Long,
        environment: String,
        scopeToken: String,
    ) {
        synchronized(lock) {
            val preferences = preferences(context)
            val sameScope =
                preferences.getString(SCOPE_TOKEN, null) == scopeToken
                    && preferences.getString(ENVIRONMENT, null) == environment
            val pushCallbacks = if (sameScope) {
                rebindGeneration(readArray(preferences, PUSH_CALLBACKS), generation)
            } else {
                JSONArray()
            }
            val scheduledCallbacks = if (sameScope) {
                rebindGeneration(
                    readArray(preferences, SCHEDULED_CALLBACKS),
                    generation,
                )
            } else {
                JSONArray()
            }
            preferences.edit().apply {
                putLong(GENERATION, generation)
                putString(ENVIRONMENT, environment)
                putString(SCOPE_TOKEN, scopeToken)
                putString(PUSH_CALLBACKS, pushCallbacks.toString())
                putString(SCHEDULED_CALLBACKS, scheduledCallbacks.toString())
                if (!sameScope) {
                    putLong(PUSH_SEQUENCE, 0)
                    putLong(SCHEDULE_SEQUENCE, 0)
                    putBoolean(PENDING_SCHEDULED_WAKE, false)
                }
            }.commit()
        }
    }

    fun disarm(context: Context) {
        synchronized(lock) {
            preferences(context).edit()
                .remove(GENERATION)
                .remove(ENVIRONMENT)
                .remove(SCOPE_TOKEN)
                .remove(PUSH_SEQUENCE)
                .remove(SCHEDULE_SEQUENCE)
                .remove(PUSH_CALLBACKS)
                .remove(SCHEDULED_CALLBACKS)
                .remove(PENDING_SCHEDULED_WAKE)
                .commit()
        }
    }

    fun enqueuePush(
        context: Context,
        kind: String,
        configure: (JSObject, AndroidPushScope) -> Unit,
    ): Long? {
        synchronized(lock) {
            val preferences = preferences(context)
            val scope = scope(preferences) ?: return null
            val sequence = preferences.getLong(PUSH_SEQUENCE, 0) + 1
            val callback = JSObject()
            callback.put("kind", kind)
            callback.put("platform", "android")
            callback.put("sequence", sequence)
            callback.put("lifecycleGeneration", scope.generation)
            configure(callback, scope)
            val callbacks = readArray(preferences, PUSH_CALLBACKS)
            appendBounded(callbacks, JSONObject(callback.toString()))
            preferences.edit()
                .putLong(PUSH_SEQUENCE, sequence)
                .putString(PUSH_CALLBACKS, callbacks.toString())
                .commit()
            return scope.generation
        }
    }

    fun enqueueScheduled(
        context: Context,
        identifier: String,
        generation: Long,
        scopeToken: String,
    ): Boolean {
        synchronized(lock) {
            val preferences = preferences(context)
            val scope = scope(preferences) ?: return false
            if (
                scope.generation != generation
                || scope.scopeToken != scopeToken
                || PlatformPermissionsPlugin.scheduledIdentifier(scope.environment) != identifier
            ) {
                return false
            }
            preferences.edit().putBoolean(PENDING_SCHEDULED_WAKE, true).commit()
            return true
        }
    }

    fun materializeScheduledWake(
        context: Context,
        identifier: String,
        generation: Long,
        scopeToken: String,
    ): Boolean {
        synchronized(lock) {
            val preferences = preferences(context)
            val scope = scope(preferences) ?: return false
            if (
                !preferences.getBoolean(PENDING_SCHEDULED_WAKE, false)
                || scope.generation != generation
                || scope.scopeToken != scopeToken
                || PlatformPermissionsPlugin.scheduledIdentifier(scope.environment) != identifier
            ) {
                return false
            }
            val sequence = preferences.getLong(SCHEDULE_SEQUENCE, 0) + 1
            val callback = JSONObject()
                .put("completionId", "$identifier:$sequence")
                .put("identifier", identifier)
                .put("platform", "android")
                .put("sequence", sequence)
                .put("lifecycleGeneration", generation)
                .put(
                    "deadlineMs",
                    System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(25),
                )
            val callbacks = readArray(preferences, SCHEDULED_CALLBACKS)
            appendBounded(callbacks, callback)
            preferences.edit()
                .putBoolean(PENDING_SCHEDULED_WAKE, false)
                .putLong(SCHEDULE_SEQUENCE, sequence)
                .putString(SCHEDULED_CALLBACKS, callbacks.toString())
                .commit()
            return true
        }
    }

    fun drainPush(context: Context): List<JSObject> =
        drain(context, PUSH_CALLBACKS)

    fun drainScheduled(context: Context): List<JSObject> =
        drain(context, SCHEDULED_CALLBACKS)

    fun pushCount(context: Context): Int = count(context, PUSH_CALLBACKS)

    fun scheduledCount(context: Context): Int =
        count(context, SCHEDULED_CALLBACKS)

    private fun drain(context: Context, key: String): List<JSObject> {
        synchronized(lock) {
            val preferences = preferences(context)
            val callbacks = readArray(preferences, key)
            preferences.edit().putString(key, "[]").commit()
            return (0 until callbacks.length()).mapNotNull { index ->
                callbacks.optJSONObject(index)?.let {
                    JSObject(it.toString())
                }
            }
        }
    }

    private fun count(context: Context, key: String): Int {
        synchronized(lock) {
            return readArray(preferences(context), key).length()
        }
    }

    private fun scope(
        preferences: android.content.SharedPreferences,
    ): AndroidPushScope? {
        val generation = preferences.getLong(GENERATION, 0)
        val environment = preferences.getString(ENVIRONMENT, null)
            ?: return null
        val scopeToken = preferences.getString(SCOPE_TOKEN, null)
            ?: return null
        if (
            generation <= 0
            || environment !in setOf("development", "production")
            || !validScopeToken(scopeToken)
        ) {
            return null
        }
        return AndroidPushScope(generation, environment, scopeToken)
    }

    private fun readArray(
        preferences: android.content.SharedPreferences,
        key: String,
    ): JSONArray {
        return try {
            JSONArray(preferences.getString(key, "[]"))
        } catch (_: Exception) {
            JSONArray()
        }
    }

    private fun appendBounded(array: JSONArray, value: JSONObject) {
        if (array.length() >= MAX_CALLBACKS) {
            array.remove(0)
        }
        array.put(value)
    }

    private fun rebindGeneration(
        callbacks: JSONArray,
        generation: Long,
    ): JSONArray {
        for (index in 0 until callbacks.length()) {
            callbacks.optJSONObject(index)?.put(
                "lifecycleGeneration",
                generation,
            )
        }
        return callbacks
    }

    private fun preferences(context: Context) =
        context.applicationContext.getSharedPreferences(
            STORE,
            Context.MODE_PRIVATE,
        )
}

class PeersFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PlatformPermissionsPlugin.ingestFcmToken(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val notificationId = data[PUSH_NOTIFICATION_ID].orEmpty()
        val category = data[PUSH_CATEGORY]?.toIntOrNull() ?: 0
        val targetHint = data[PUSH_TARGET_HINT].orEmpty()
        val issuedAtMs = data[PUSH_ISSUED_AT_MS]?.toLongOrNull() ?: 0
        val expiresAtMs = data[PUSH_EXPIRES_AT_MS]?.toLongOrNull() ?: 0
        PlatformPermissionsPlugin.ingestPushReceipt(
            applicationContext,
            notificationId,
            category,
            targetHint,
            issuedAtMs,
            expiresAtMs,
            tapped = false,
        )
        showNotification(
            notificationId,
            category,
            targetHint,
            issuedAtMs,
            expiresAtMs,
        )
    }

    private fun showNotification(
        notificationId: String,
        category: Int,
        targetHint: String,
        issuedAtMs: Long,
        expiresAtMs: Long,
    ) {
        if (
            notificationId.isBlank()
            || category !in 1..4
            || targetHint.isBlank()
            || issuedAtMs <= 0
            || expiresAtMs <= System.currentTimeMillis()
            || !NotificationManagerCompat.from(this).areNotificationsEnabled()
        ) {
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    PUSH_NOTIFICATION_CHANNEL,
                    "Peers activity",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ),
            )
        }
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: return
        launchIntent.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(PUSH_INTENT_MARKER, true)
            putExtra(PUSH_NOTIFICATION_ID, notificationId)
            putExtra(PUSH_CATEGORY, category)
            putExtra(PUSH_TARGET_HINT, targetHint)
            putExtra(PUSH_ISSUED_AT_MS, issuedAtMs)
            putExtra(PUSH_EXPIRES_AT_MS, expiresAtMs)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            notificationId.hashCode(),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val icon = applicationInfo.icon.takeIf { it != 0 }
            ?: android.R.drawable.ic_dialog_info
        val notification = NotificationCompat.Builder(
            this,
            PUSH_NOTIFICATION_CHANNEL,
        )
            .setSmallIcon(icon)
            .setContentTitle("Peers")
            .setContentText("New activity")
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()
        NotificationManagerCompat.from(this)
            .notify(notificationId.hashCode(), notification)
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
        val scopeToken = inputData.getString(
            PlatformPermissionsPlugin.SCHEDULE_SCOPE_TOKEN_KEY,
        ).orEmpty()
        if (generation <= 0 || !validScopeToken(scopeToken)) {
            return Result.failure()
        }
        PlatformPermissionsPlugin.ingestScheduledCallback(
            applicationContext,
            identifier,
            generation,
            scopeToken,
        )
        return Result.success()
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
