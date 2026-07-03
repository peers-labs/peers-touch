package com.peerstouch.mobile.core.applet.ui

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.core.applet.AppletManager
import com.peerstouch.mobile.core.applet.kernel.AppletSurfaceCache
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class AppletContainerViewModel @Inject constructor(
    val appletManager: AppletManager,
    val appletSurfaceCache: AppletSurfaceCache
) : ViewModel()
