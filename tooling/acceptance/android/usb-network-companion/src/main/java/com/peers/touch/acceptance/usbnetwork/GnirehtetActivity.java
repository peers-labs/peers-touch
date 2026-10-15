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

import android.app.Activity;
import android.content.Intent;
import android.net.VpnService;
import android.os.Bundle;
import android.util.Log;

import java.net.InetAddress;

/**
 * This (invisible) activity receives the {@link #ACTION_GNIREHTET_START START} and
 * {@link #ACTION_GNIREHTET_STOP} actions from the command line.
 * <p>
 * Recent versions of Android refuse to directly start a {@link android.app.Service Service} or a
 * {@link android.content.BroadcastReceiver BroadcastReceiver}, so actions are always managed by
 * this activity.
 */
public class GnirehtetActivity extends Activity {

    private static final String TAG = GnirehtetActivity.class.getSimpleName();

    public static final String ACTION_GNIREHTET_START = "com.peers.touch.acceptance.usbnetwork.START";
    public static final String ACTION_GNIREHTET_STOP = "com.peers.touch.acceptance.usbnetwork.STOP";

    public static final String EXTRA_DNS_SERVERS = "dnsServers";
    public static final String EXTRA_ROUTES = "routes";

    private static final int VPN_REQUEST_CODE = 0;

    private VpnConfiguration requestedConfig;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    private void handleIntent(Intent intent) {
        String action = intent.getAction();
        Log.d(TAG, "Received request " + action);
        boolean finish = true;
        if (ACTION_GNIREHTET_START.equals(action)) {
            VpnConfiguration config = createConfig(intent);
            if (config != null) {
                finish = startGnirehtet(config);
            } else {
                Log.w(TAG, "Rejecting invalid VPN configuration");
            }
        } else if (ACTION_GNIREHTET_STOP.equals(action)) {
            stopGnirehtet();
        }

        if (finish) {
            finish();
        }
    }

    private static VpnConfiguration createConfig(Intent intent) {
        String[] dnsServers = intent.getStringArrayExtra(EXTRA_DNS_SERVERS);
        String[] routes = intent.getStringArrayExtra(EXTRA_ROUTES);
        if ((dnsServers != null && dnsServers.length != 0)
                || routes == null
                || routes.length != 1) {
            return null;
        }
        CIDR[] parsedRoutes = Net.toCIDRs(routes);
        if (parsedRoutes[0].getPrefixLength() != 32) {
            return null;
        }
        return new VpnConfiguration(new InetAddress[0], parsedRoutes);
    }

    private boolean startGnirehtet(VpnConfiguration config) {
        Intent vpnIntent = VpnService.prepare(this);
        if (vpnIntent == null) {
            Log.d(TAG, "VPN was already authorized");
            // we got the permission, start the service now
            GnirehtetService.start(this, config);
            return true;
        }

        Log.w(TAG, "VPN requires the authorization from the user, requesting...");
        requestAuthorization(vpnIntent, config);
        return false; // do not finish now
    }

    private void stopGnirehtet() {
        GnirehtetService.stop(this);
    }

    private void requestAuthorization(Intent vpnIntent, VpnConfiguration config) {
        this.requestedConfig = config;
        startActivityForResult(vpnIntent, VPN_REQUEST_CODE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == VPN_REQUEST_CODE && resultCode == RESULT_OK) {
            GnirehtetService.start(this, requestedConfig);
        }
        requestedConfig = null;
        finish();
    }
}
