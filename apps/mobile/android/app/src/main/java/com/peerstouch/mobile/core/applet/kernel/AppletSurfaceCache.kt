package com.peerstouch.mobile.core.applet.kernel

import android.content.Context
import android.view.View
import android.view.ViewGroup
import com.peerstouch.mobile.core.applet.AppletManager
import com.peerstouch.mobile.core.lynx.LynxViewFactory
import java.io.File

class AppletSurfaceCache(
    private val lynxViewFactory: LynxViewFactory
) : AppletSurfaceController {
    private val surfaces = mutableMapOf<String, View>()

    fun getOrCreate(
        context: Context,
        appletId: String,
        appletManager: AppletManager
    ): View {
        surfaces[appletId]?.let { cached ->
            detach(cached)
            cached.visibility = View.VISIBLE
            return cached
        }

        val session = appletManager.getApplet(appletId)
            ?: throw IllegalStateException("Applet $appletId session not available")
        val loadConfig = session.manifest.load.android
            ?: throw IllegalStateException("Applet ${session.manifest.id} has no android load config")
        val bundleUrl = appletManager.getAppletInfo(appletId)
            ?.let { File(it.path, loadConfig.entry).toURI().toString() }
            ?: loadConfig.entry

        return lynxViewFactory.create(context, bundleUrl, session).also { view ->
            surfaces[appletId] = view
        }
    }

    override fun applySurfaceCommand(command: SurfaceCommand, target: AppletLifecycleTarget) {
        val surface = surfaces[target.appletId] ?: return
        when (command) {
            SurfaceCommand.SHOW -> {
                surface.visibility = View.VISIBLE
            }
            SurfaceCommand.HIDE -> {
                surface.visibility = View.GONE
            }
            SurfaceCommand.DETACH -> {
                detach(surface)
            }
            SurfaceCommand.DESTROY -> {
                detach(surface)
                surfaces.remove(target.appletId)
            }
        }
    }

    fun clear() {
        surfaces.values.forEach(::detach)
        surfaces.clear()
    }

    private fun detach(view: View) {
        (view.parent as? ViewGroup)?.removeView(view)
    }
}
