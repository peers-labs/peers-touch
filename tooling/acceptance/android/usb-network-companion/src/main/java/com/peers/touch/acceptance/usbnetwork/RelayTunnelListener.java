/*
 * Copyright (C) 2017 Genymobile
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.peers.touch.acceptance.usbnetwork;

import android.os.Handler;

/**
 * Convenient wrapper to dispatch events to the given {@link Handler}.
 */
public class RelayTunnelListener {

    static final int MSG_RELAY_TUNNEL_CONNECTED = 0;
    static final int MSG_RELAY_TUNNEL_DISCONNECTED = 1;

    private final Handler handler;

    public RelayTunnelListener(Handler handler) {
        this.handler = handler;
    }

    public void notifyRelayTunnelConnected() {
        handler.sendEmptyMessage(MSG_RELAY_TUNNEL_CONNECTED);
    }

    public void notifyRelayTunnelDisconnected() {
        handler.sendEmptyMessage(MSG_RELAY_TUNNEL_DISCONNECTED);
    }
}
