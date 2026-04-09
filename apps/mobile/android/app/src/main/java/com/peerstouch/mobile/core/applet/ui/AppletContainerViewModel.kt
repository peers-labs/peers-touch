package com.peerstouch.mobile.core.applet.ui

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.core.applet.AppletManager
import com.peerstouch.mobile.core.lynx.LynxViewFactory
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class AppletContainerViewModel @Inject constructor(
    val appletManager: AppletManager,
    val lynxViewFactory: LynxViewFactory
) : ViewModel()
