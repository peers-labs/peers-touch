package com.peerstouch.mobile.core.lynx.bridge

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

class NotificationBridgeModule constructor(
    private val context: Context
) : BridgeModule {

    override val moduleName: String = "notification"

    init {
        createNotificationChannel()
    }

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "show" -> show(
                params["title"] as? String ?: "",
                params["content"] as? String ?: ""
            )
            "cancel" -> cancel(
                (params["id"] as? Number)?.toInt() ?: 0
            )
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    private fun show(title: String, content: String): Map<String, Any> {
        val notificationId = System.currentTimeMillis().toInt()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                return mapOf("id" to notificationId, "shown" to false)
            }
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(content)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        NotificationManagerCompat.from(context).notify(notificationId, notification)
        return mapOf("id" to notificationId, "shown" to true)
    }

    private fun cancel(id: Int) {
        NotificationManagerCompat.from(context).cancel(id)
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
        )
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.createNotificationChannel(channel)
    }

    private companion object {
        const val CHANNEL_ID = "applet_notifications"
        const val CHANNEL_NAME = "Applet Notifications"
    }
}
