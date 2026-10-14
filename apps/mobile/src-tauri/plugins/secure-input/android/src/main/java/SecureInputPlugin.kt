package com.peers.touch.mobile.secureinput

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.WindowManager
import android.widget.EditText
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.nio.charset.CodingErrorAction

private const val ACCEPTANCE_SECRET_FILE_ENVIRONMENT =
    "PEERS_TOUCH_ACCEPTANCE_RECOVERY_SECRET_FILE"
private const val PRIVATE_SOCIAL_RECOVERY_PURPOSE = "private_social_recovery"
private const val ACTOR_IDENTITY_RECOVERY_PURPOSE = "actor_identity_recovery"
private const val MAXIMUM_SECRET_BYTES = 1024
private const val AUTOFILL_ACCESSIBILITY_ID = "peers-touch.secure-input.autofill"

@InvokeArg
class SecretInputArgs {
    lateinit var requestId: String
    lateinit var purpose: String
    var lifecycleGeneration: Long = 0
    var deadlineMs: Long = 0
    var acceptanceAutofillAllowed: Boolean = false
}

private data class ActiveSecretInput(
    val args: SecretInputArgs,
    val invoke: Invoke,
    val dialog: AlertDialog,
    val field: EditText,
    val deadline: Runnable,
    val secureFlagAdded: Boolean,
)

@TauriPlugin
class SecureInputPlugin(private val activity: Activity) : Plugin(activity) {
    private val handler = Handler(Looper.getMainLooper())
    private var activeInput: ActiveSecretInput? = null

    @Command
    fun requestSecret(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(SecretInputArgs::class.java)
        } catch (_: Exception) {
            invoke.reject(
                "invalid native secure-input request",
                "SECURE_INPUT_INVALID_REQUEST",
            )
            return
        }
        if (
            args.requestId.trim().isEmpty()
            || (
                args.purpose != PRIVATE_SOCIAL_RECOVERY_PURPOSE
                    && args.purpose != ACTOR_IDENTITY_RECOVERY_PURPOSE
                )
            || args.lifecycleGeneration <= 0
            || args.deadlineMs < 1_000
            || args.deadlineMs > 300_000
        ) {
            invoke.reject(
                "invalid native secure-input request",
                "SECURE_INPUT_INVALID_REQUEST",
            )
            return
        }
        activity.runOnUiThread {
            present(args, invoke)
        }
    }

    private fun present(args: SecretInputArgs, invoke: Invoke) {
        if (activeInput != null) {
            resolve(
                invoke,
                args,
                outcome = "busy",
                errorCode = "SECURE_INPUT_BUSY",
            )
            return
        }

        val field = EditText(activity).apply {
            hint = activity.getString(R.string.secure_input_recovery_placeholder)
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_VARIATION_PASSWORD or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE
            isSingleLine = false
            minLines = 3
            importantForAutofill = EditText.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            contentDescription = activity.getString(R.string.secure_input_recovery_placeholder)
        }
        val acceptanceAutofillAvailable = args.acceptanceAutofillAllowed &&
            !System.getenv(ACCEPTANCE_SECRET_FILE_ENVIRONMENT).isNullOrBlank()
        val actorIdentityRecovery =
            args.purpose == ACTOR_IDENTITY_RECOVERY_PURPOSE
        val builder = AlertDialog.Builder(activity)
            .setTitle(
                if (actorIdentityRecovery) {
                    R.string.secure_input_actor_identity_recovery_title
                } else {
                    R.string.secure_input_recovery_title
                },
            )
            .setMessage(
                if (actorIdentityRecovery) {
                    R.string.secure_input_actor_identity_recovery_message
                } else {
                    R.string.secure_input_recovery_message
                },
            )
            .setView(field)
            .setNegativeButton(R.string.secure_input_cancel, null)
            .setPositiveButton(R.string.secure_input_recover, null)
        if (acceptanceAutofillAvailable) {
            builder.setNeutralButton(R.string.secure_input_acceptance_autofill, null)
        }
        val dialog = builder.create()
        val flagAlreadySet =
            activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
        if (!flagAlreadySet) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        val deadline = Runnable {
            complete(
                outcome = "expired",
                errorCode = "SECURE_INPUT_EXPIRED",
            )
        }
        activeInput = ActiveSecretInput(
            args = args,
            invoke = invoke,
            dialog = dialog,
            field = field,
            deadline = deadline,
            secureFlagAdded = !flagAlreadySet,
        )
        dialog.setOnCancelListener {
            complete(outcome = "cancelled")
        }
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener {
                complete(outcome = "cancelled")
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                complete(
                    outcome = "submitted",
                    secret = field.text?.toString().orEmpty(),
                )
            }
            if (acceptanceAutofillAvailable) {
                dialog.getButton(AlertDialog.BUTTON_NEUTRAL).apply {
                    contentDescription = AUTOFILL_ACCESSIBILITY_ID
                    setOnClickListener {
                        consumeAcceptanceSecret()?.let { secret ->
                            field.setText(secret)
                            field.setSelection(field.text?.length ?: 0)
                        }
                    }
                }
            }
        }
        dialog.show()
        handler.postDelayed(deadline, args.deadlineMs)
    }

    private fun complete(
        outcome: String,
        secret: String? = null,
        errorCode: String? = null,
    ) {
        val active = activeInput ?: return
        activeInput = null
        handler.removeCallbacks(active.deadline)
        active.field.text?.clear()
        active.dialog.dismiss()
        if (active.secureFlagAdded) {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        resolve(
            active.invoke,
            active.args,
            outcome = outcome,
            secret = secret,
            errorCode = errorCode,
        )
    }

    private fun consumeAcceptanceSecret(): String? {
        val path = System.getenv(ACCEPTANCE_SECRET_FILE_ENVIRONMENT)
            ?.takeIf { it.isNotBlank() }
            ?: return null
        val file = File(path)
        var bytes: ByteArray? = null
        return try {
            val loaded = file.readBytes()
            bytes = loaded
            if (loaded.isEmpty() || loaded.size > MAXIMUM_SECRET_BYTES) {
                null
            } else {
                val decoder = Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                decoder.decode(java.nio.ByteBuffer.wrap(loaded)).toString()
                    .takeIf { it.isNotBlank() }
            }
        } catch (_: Exception) {
            null
        } finally {
            file.delete()
            bytes?.fill(0)
        }
    }

    private fun resolve(
        invoke: Invoke,
        args: SecretInputArgs,
        outcome: String,
        secret: String? = null,
        errorCode: String? = null,
    ) {
        val response = JSObject()
        response.put("requestId", args.requestId)
        response.put("lifecycleGeneration", args.lifecycleGeneration)
        response.put("outcome", outcome)
        if (secret != null) response.put("secret", secret)
        if (errorCode != null) response.put("errorCode", errorCode)
        invoke.resolve(response)
    }

    override fun onDestroy() {
        activity.runOnUiThread {
            complete(
                outcome = "platform_failure",
                errorCode = "SECURE_INPUT_PLATFORM_DESTROYED",
            )
        }
        super.onDestroy()
    }
}
