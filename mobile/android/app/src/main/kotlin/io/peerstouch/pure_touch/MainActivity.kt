package io.peerstouch.pure_touch

import android.os.Bundle
import android.os.Environment
import android.os.StatFs
import android.util.Log
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugins.GeneratedPluginRegistrant

class MainActivity : FlutterActivity() {
    private val CHANNEL = "samples.flutter.dev/storage"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        GeneratedPluginRegistrant.registerWith(flutterEngine)
        
        // Register our custom method channel
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "getFreeDiskSpace" -> {
                    try {
                        val freeSpace = getFreeDiskSpace()
                        val response = HashMap<String, Any>()
                        response["freeSpace"] = freeSpace
                        result.success(response)
                    } catch (e: Exception) {
                        result.error("UNAVAILABLE", "Could not get free disk space: ${e.message}", null)
                    }
                }
                else -> {
                    result.notImplemented()
                }
            }
        }
    }

    private fun getFreeDiskSpace(): Long {
        try {
            // Try to get the app's internal storage directory first
            val internalPath = applicationContext.filesDir.path
            val stat = StatFs(internalPath)
            val blockSize = stat.blockSizeLong
            val availableBlocks = stat.availableBlocksLong
            val freeSpace = availableBlocks * blockSize
            
            // Log the free space for debugging
            Log.d("PhotoController", "Free space: ${freeSpace / (1024 * 1024)} MB")
            
            return freeSpace
        } catch (e: Exception) {
            e.printStackTrace()
            // Try alternative method if the first one fails
            try {
                val externalPath = applicationContext.getExternalFilesDir(null)?.path
                if (externalPath != null) {
                    val stat = StatFs(externalPath)
                    val blockSize = stat.blockSizeLong
                    val availableBlocks = stat.availableBlocksLong
                    return availableBlocks * blockSize
                }
            } catch (e2: Exception) {
                e2.printStackTrace()
            }
            
            return 500 * 1024 * 1024 // Default to 500MB if there's an error
        }
    }
}
