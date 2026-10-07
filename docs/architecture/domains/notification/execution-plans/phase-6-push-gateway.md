# Execution Plan — Phase 6: Push Gateway

> Implements the Push Gateway for delivering notifications to offline devices via Web Push, UnifiedPush, APNs, and FCM channels.

---

## 1. Objective

- Implement device registration API (register/unregister/list push devices)
- Build PushGateway with pluggable channel architecture
- Implement Web Push (VAPID) channel for Desktop
- Implement UnifiedPush channel for Android
- Implement APNs channel for iOS (optional, config-gated)
- Implement FCM channel for Android (optional, config-gated)
- Integrate push dispatch into the notification production pipeline
- Implement RFC 8291 payload encryption for Web Push / UnifiedPush
- Add VAPID key auto-generation on first Station boot
- Add polling fallback for platforms without push channel

---

## 2. Dependency

- Phase 1 completed (Proto + domain model)
- Phase 2 completed (Storage + SubServer skeleton)
- Phase 3 completed (Delivery + EventSystem integration)
- Phase 4 completed (Client presentation basics)

---

## 3. Architectural Context

This phase implements the **Push Gateway** portion of the Delivery Architecture (Architecture §7.4–§7.10).

Key architectural constraints:

- **Station as push gateway** (§3.3): Each Station runs its own push delivery. No centralized relay.
- **Minimal push payload** (§7.7): Push carries wake-up signal + preview text only. Full content fetched from Station.
- **Privacy by default** (§3.3): RFC 8291 encryption for Web Push and UnifiedPush. Push servers cannot read content.
- **Multi-device strategy** (§7.5): v1 uses actor-level online check — push is skipped when any SSE connection is active. Future evolution targets per-platform awareness.
- **Graceful degradation** (§7.10): Missing channels are silently skipped. Polling fallback for platforms without push.

---

## 4. Tasks — Station (Go)

### 4.1 Proto Extension: Push Device Model

**File**: `model/domain/notification/notification.proto`

Push-related proto definitions are already included in the Phase 1 proto file (Architecture §4.2). Verify they are present:

- `PushChannelType` enum
- `PushDevice` message
- `RegisterPushDeviceRequest/Response`
- `UnregisterPushDeviceRequest/Response`
- `ListPushDevicesRequest/Response`

If Phase 1 did not include these (depending on implementation order), add them now and run `./model/build.sh`.

### 4.2 Database: push_devices Table

**File**: `apps/station/app/subserver/notification/push/device_repo.go`

GORM model as specified in Architecture §6.1:

```go
type PushDeviceModel struct {
    ID           uint64    `gorm:"primaryKey;autoIncrement:false"`
    ActorID      string    `gorm:"size:255;not null;index:idx_push_dev_actor"`
    Channel      int32     `gorm:"not null"`
    Endpoint     string    `gorm:"type:text"`
    P256dhKey    string    `gorm:"size:255"`
    AuthSecret   string    `gorm:"size:255"`
    DeviceToken  string    `gorm:"size:255"`
    FCMToken     string    `gorm:"size:255"`
    DeviceName   string    `gorm:"size:255"`
    Platform     string    `gorm:"size:32"`
    CreatedAt    time.Time `gorm:"not null"`
    LastActiveAt *time.Time
}

func (*PushDeviceModel) TableName() string { return "push_devices" }
```

Repository interface:

```go
type DeviceRepository interface {
    Create(ctx context.Context, device *PushDeviceModel) error
    Delete(ctx context.Context, actorID string, deviceID uint64) error
    ListByActor(ctx context.Context, actorID string) ([]*PushDeviceModel, error)
    FindByEndpoint(ctx context.Context, actorID string, endpoint string) (*PushDeviceModel, error)
    FindByToken(ctx context.Context, actorID string, token string) (*PushDeviceModel, error)
    UpdateLastActive(ctx context.Context, deviceID uint64) error
    DeleteByID(ctx context.Context, deviceID uint64) error
}
```

AutoMigrate in `subserver.Init()`.

### 4.3 PushChannel Interface

**File**: `apps/station/app/subserver/notification/push/channel.go`

```go
type PushPayload struct {
    Type           string `json:"t"`
    NotificationID string `json:"nid"`
    Category       int32  `json:"cat"`
    Title          string `json:"title"`
    Body           string `json:"body"`
    Timestamp      int64  `json:"ts"`
}

type PushChannel interface {
    Type() PushChannelType
    Send(ctx context.Context, device *PushDeviceModel, payload *PushPayload) error
    Available() bool
}

type PushChannelType = int32

const (
    PushChannelWebPush     PushChannelType = 1
    PushChannelUnifiedPush PushChannelType = 2
    PushChannelAPNs        PushChannelType = 3
    PushChannelFCM         PushChannelType = 4
)
```

### 4.4 Web Push Channel (VAPID)

**File**: `apps/station/app/subserver/notification/push/channel_webpush.go`

Go library: `github.com/SherClockHolmes/webpush-go`

```go
type WebPushChannel struct {
    vapidPublicKey  string
    vapidPrivateKey string
    vapidSubject    string
}

func (c *WebPushChannel) Type() PushChannelType { return PushChannelWebPush }
func (c *WebPushChannel) Available() bool        { return c.vapidPublicKey != "" }

func (c *WebPushChannel) Send(ctx context.Context, device *PushDeviceModel, payload *PushPayload) error {
    data, _ := json.Marshal(payload)
    sub := &webpush.Subscription{
        Endpoint: device.Endpoint,
        Keys: webpush.Keys{
            P256dh: device.P256dhKey,
            Auth:   device.AuthSecret,
        },
    }
    resp, err := webpush.SendNotification(data, sub, &webpush.Options{
        Subscriber:      c.vapidSubject,
        VAPIDPublicKey:  c.vapidPublicKey,
        VAPIDPrivateKey: c.vapidPrivateKey,
        TTL:             3600,
        Urgency:         webpush.UrgencyHigh,
    })
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode == 410 {
        return ErrDeviceGone
    }
    return nil
}
```

VAPID key auto-generation:

- On Station init, check config for `push.vapid.public_key`
- If empty, check DB for stored VAPID keys (`settings` table, key=`vapid_keys`)
- If not in DB, generate new key pair via `webpush.GenerateVAPIDKeys()`, store in DB
- Load keys into `WebPushChannel`

### 4.5 UnifiedPush Channel

**File**: `apps/station/app/subserver/notification/push/channel_unifiedpush.go`

UnifiedPush is Web Push compatible — Station sends an HTTP POST to the device's registered endpoint URL. The payload is encrypted using RFC 8291 (same as Web Push).

```go
type UnifiedPushChannel struct {
    httpClient *http.Client
}

func (c *UnifiedPushChannel) Type() PushChannelType { return PushChannelUnifiedPush }
func (c *UnifiedPushChannel) Available() bool        { return true }

func (c *UnifiedPushChannel) Send(ctx context.Context, device *PushDeviceModel, payload *PushPayload) error {
    data, _ := json.Marshal(payload)

    body := data
    if device.P256dhKey != "" && device.AuthSecret != "" {
        encrypted, err := encryptRFC8291(data, device.P256dhKey, device.AuthSecret)
        if err != nil {
            return err
        }
        body = encrypted
    }

    req, _ := http.NewRequestWithContext(ctx, http.MethodPost, device.Endpoint, bytes.NewReader(body))
    req.Header.Set("Content-Type", "application/octet-stream")
    req.Header.Set("TTL", "3600")

    resp, err := c.httpClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode == 410 {
        return ErrDeviceGone
    }
    return nil
}
```

### 4.6 APNs Channel (Optional)

**File**: `apps/station/app/subserver/notification/push/channel_apns.go`

Go library: `github.com/sideshow/apns2`

Gated: only initialized if `push.apns.enabled = true` in Station config.

```go
type APNsChannel struct {
    client   *apns2.Client
    bundleID string
    enabled  bool
}

func (c *APNsChannel) Type() PushChannelType { return PushChannelAPNs }
func (c *APNsChannel) Available() bool        { return c.enabled }

func (c *APNsChannel) Send(ctx context.Context, device *PushDeviceModel, payload *PushPayload) error {
    notification := &apns2.Notification{
        DeviceToken: device.DeviceToken,
        Topic:       c.bundleID,
        Payload: apnsPayload.NewPayload().
            AlertTitle(payload.Title).
            AlertBody(payload.Body).
            Sound("default").
            MutableContent().
            Custom("nid", payload.NotificationID).
            Custom("cat", payload.Category),
    }
    resp, err := c.client.PushWithContext(ctx, notification)
    if err != nil {
        return err
    }
    if resp.StatusCode == 410 {
        return ErrDeviceGone
    }
    return nil
}
```

### 4.7 FCM Channel (Optional)

**File**: `apps/station/app/subserver/notification/push/channel_fcm.go`

Go library: `firebase.google.com/go/v4/messaging`

Gated: only initialized if `push.fcm.enabled = true` in Station config.

```go
type FCMChannel struct {
    client  *messaging.Client
    enabled bool
}

func (c *FCMChannel) Type() PushChannelType { return PushChannelFCM }
func (c *FCMChannel) Available() bool        { return c.enabled }

func (c *FCMChannel) Send(ctx context.Context, device *PushDeviceModel, payload *PushPayload) error {
    msg := &messaging.Message{
        Token: device.FCMToken,
        Data: map[string]string{
            "t":     payload.Type,
            "nid":   payload.NotificationID,
            "cat":   fmt.Sprintf("%d", payload.Category),
            "title": payload.Title,
            "body":  payload.Body,
        },
        Android: &messaging.AndroidConfig{
            Priority: "high",
        },
    }
    _, err := c.client.Send(ctx, msg)
    if messaging.IsRegistrationTokenNotRegistered(err) {
        return ErrDeviceGone
    }
    return err
}
```

### 4.8 PushGateway Orchestrator

**File**: `apps/station/app/subserver/notification/push/gateway.go`

```go
var ErrDeviceGone = errors.New("push: device gone")

type PushGateway struct {
    channels   map[PushChannelType]PushChannel
    deviceRepo DeviceRepository
    hub        *event.ConnectionHub
    prefRepo   PreferenceRepository
}

func (g *PushGateway) Dispatch(ctx context.Context, recipientID string, notif *Notification) error {
    // v1: actor-level online check (Architecture §7.5)
    if g.hub.IsActorOnline(recipientID) {
        return nil
    }

    pref, _ := g.prefRepo.GetByActorAndCategory(ctx, recipientID, notif.Category)
    if pref != nil && !pref.PushEnabled {
        return nil
    }

    devices, err := g.deviceRepo.ListByActor(ctx, recipientID)
    if err != nil {
        return err
    }

    payload := &PushPayload{
        Type:           "notification.push",
        NotificationID: notif.ID,
        Category:       notif.Category,
        Title:          truncate(notif.Title, 64),
        Body:           truncate(notif.Body, 80),
        Timestamp:      notif.CreatedAt.Unix(),
    }

    var lastErr error
    for _, device := range devices {
        ch, ok := g.channels[device.Channel]
        if !ok || !ch.Available() {
            continue
        }
        if err := ch.Send(ctx, device, payload); err != nil {
            if errors.Is(err, ErrDeviceGone) {
                _ = g.deviceRepo.DeleteByID(ctx, device.ID)
                continue
            }
            lastErr = err
            continue
        }
        _ = g.deviceRepo.UpdateLastActive(ctx, device.ID)
    }
    return lastErr
}
```

### 4.9 Integrate Push into Notification Production Pipeline

**File**: `apps/station/app/subserver/notification/application/service.go`

Modify the existing `Produce` method to call push gateway after SSE event publish (Architecture §5.5, step 9):

```go
func (s *Service) Produce(ctx context.Context, params ProduceParams) error {
    // ... existing: validate, check pref, rate limit, dedup, persist, update counter ...
    // ... existing: publish SSE event ...

    // Push dispatch (async, non-blocking)
    if s.pushGateway != nil {
        go func() {
            pushCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
            defer cancel()
            _ = s.pushGateway.Dispatch(pushCtx, params.RecipientID, notification)
        }()
    }

    return nil
}
```

Push dispatch is:
- **Async**: runs in a goroutine, does not block the production pipeline
- **Fire-and-forget**: push failures are logged but do not fail the notification creation
- **Timeout**: 10-second context to prevent hanging on slow push endpoints

### 4.10 Handler: Push Device Management API

**File**: `apps/station/app/subserver/notification/handler.go`

Add routes as specified in Architecture §5.7:

```go
server.NewTypedHandler("push-register", "/notification/push/register", server.POST,
    s.handlePushRegister, logIDWrapper, s.jwtWrapper),
server.NewTypedHandler("push-unregister", "/notification/push/unregister", server.POST,
    s.handlePushUnregister, logIDWrapper, s.jwtWrapper),
server.NewTypedHandler("push-devices", "/notification/push/devices", server.GET,
    s.handlePushDevices, logIDWrapper, s.jwtWrapper),
server.NewTypedHandler("push-vapid-key", "/notification/push/vapid-key", server.GET,
    s.handleGetVAPIDKey, logIDWrapper),
```

The `push-register` handler performs upsert — if the same endpoint/token is already registered, return existing device.

The `push-vapid-key` handler has **no auth** (public endpoint) — Desktop needs to fetch the VAPID public key before authentication to subscribe to Web Push.

### 4.11 Station Config Extension

**File**: `apps/station/frame/core/config/` (relevant config file)

Add push configuration section as specified in Architecture §7.9:

```go
type PushConfig struct {
    VAPID VAPIDConfig `yaml:"vapid"`
    APNs  APNsConfig  `yaml:"apns"`
    FCM   FCMConfig   `yaml:"fcm"`
}

type VAPIDConfig struct {
    PublicKey  string `yaml:"public_key" env:"PUSH_VAPID_PUBLIC_KEY"`
    PrivateKey string `yaml:"private_key" env:"PUSH_VAPID_PRIVATE_KEY"`
    Subject    string `yaml:"subject" env:"PUSH_VAPID_SUBJECT"`
}

type APNsConfig struct {
    Enabled    bool   `yaml:"enabled" env:"PUSH_APNS_ENABLED"`
    KeyFile    string `yaml:"key_file" env:"PUSH_APNS_KEY_FILE"`
    KeyID      string `yaml:"key_id" env:"PUSH_APNS_KEY_ID"`
    TeamID     string `yaml:"team_id" env:"PUSH_APNS_TEAM_ID"`
    BundleID   string `yaml:"bundle_id" env:"PUSH_APNS_BUNDLE_ID"`
    Production bool   `yaml:"production" env:"PUSH_APNS_PRODUCTION"`
}

type FCMConfig struct {
    Enabled         bool   `yaml:"enabled" env:"PUSH_FCM_ENABLED"`
    CredentialsFile string `yaml:"credentials_file" env:"PUSH_FCM_CREDENTIALS_FILE"`
}
```

---

## 5. Tasks — Desktop (Tauri + React/TS)

### 5.1 Service Worker

**File**: `apps/desktop/public/sw.js`

```javascript
self.addEventListener("push", (event) => {
  const payload = event.data?.json();
  if (!payload) return;

  event.waitUntil(
    self.registration.showNotification(payload.title || "Peers-Touch", {
      body: payload.body || "",
      tag: payload.nid,
      data: { nid: payload.nid, cat: payload.cat },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      if (clientList.length > 0) {
        clientList[0].focus();
        clientList[0].postMessage({
          type: "notification-click",
          nid: event.notification.data?.nid,
        });
      } else {
        clients.openWindow("/");
      }
    })
  );
});
```

### 5.2 Push Subscription Module

**File**: `apps/desktop/src/kernel/notification/push.ts`

```typescript
async function subscribeToPush(stationUrl: string, token: string): Promise<void> {
  const vapidKeyResp = await fetch(`${stationUrl}/notification/push/vapid-key`);
  const { publicKey } = await vapidKeyResp.json();

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch(`${stationUrl}/notification/push/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: 1,
      endpoint: subscription.endpoint,
      p256dh_key: arrayBufferToBase64(subscription.getKey("p256dh")!),
      auth_secret: arrayBufferToBase64(subscription.getKey("auth")!),
      platform: "desktop",
    }),
  });
}
```

### 5.3 Initialization

Register Service Worker and subscribe to push on app startup (after authentication):

```typescript
if ("serviceWorker" in navigator && "PushManager" in window) {
  subscribeToPush(stationUrl, authToken);
}
```

---

## 6. Tasks — Android (Kotlin)

### 6.1 Add UnifiedPush Dependency

**File**: `apps/mobile/android/app/build.gradle.kts`

```kotlin
implementation("org.unifiedpush.android:connector:2.4.0")
```

### 6.2 UnifiedPush Receiver

**File**: `apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/push/PushReceiver.kt`

```kotlin
class PushReceiver : MessagingReceiver() {
    override fun onNewEndpoint(context: Context, endpoint: String, instance: String) {
        val stationApi = Container.get<StationApi>()
        CoroutineScope(Dispatchers.IO).launch {
            stationApi.registerPushDevice(
                channel = PushChannelType.UNIFIED_PUSH,
                endpoint = endpoint,
                platform = "android"
            )
        }
    }

    override fun onMessage(context: Context, message: ByteArray, instance: String) {
        val payload = PushPayload.fromBytes(message)
        showLocalNotification(context, payload)
    }

    override fun onUnregistered(context: Context, instance: String) {
        val stationApi = Container.get<StationApi>()
        CoroutineScope(Dispatchers.IO).launch {
            stationApi.unregisterCurrentDevice()
        }
    }
}
```

### 6.3 Register Receiver in Manifest

**File**: `apps/mobile/android/app/src/main/AndroidManifest.xml`

```xml
<receiver
    android:name=".core.push.PushReceiver"
    android:exported="true">
    <intent-filter>
        <action android:name="org.unifiedpush.android.connector.MESSAGE" />
        <action android:name="org.unifiedpush.android.connector.UNREGISTERED" />
        <action android:name="org.unifiedpush.android.connector.NEW_ENDPOINT" />
        <action android:name="org.unifiedpush.android.connector.REGISTRATION_FAILED" />
    </intent-filter>
</receiver>
```

### 6.4 Registration Trigger

In the login flow, after successful authentication:

```kotlin
UnifiedPush.registerApp(context)
```

If no distributor is installed, show a user-friendly message suggesting to install ntfy from F-Droid or Play Store.

---

## 7. Tasks — iOS (Swift)

### 7.1 APNs Registration

**File**: `apps/mobile/ios/PeersTouch/App/AppDelegate.swift`

```swift
func application(_ application: UIApplication,
                 didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    requestNotificationPermission()
    return true
}

private func requestNotificationPermission() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
        if granted {
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }
}

func application(_ application: UIApplication,
                 didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
    Task {
        try? await Container.shared.stationApi.registerPushDevice(
            channel: .apns,
            deviceToken: token,
            platform: "ios"
        )
    }
}
```

### 7.2 Remote Notification Handling

```swift
extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        return [.banner, .badge, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let userInfo = response.notification.request.content.userInfo
        if let nid = userInfo["nid"] as? String {
            Container.shared.router.navigate(to: .notification(id: nid))
        }
    }
}
```

### 7.3 Background Fetch Fallback

For when APNs is not configured by the Station owner:

**File**: `apps/mobile/ios/PeersTouch/Info.plist` or `project.yml`

```xml
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
    <string>remote-notification</string>
</array>
```

---

## 8. Tasks — Android Polling Fallback

### 8.1 WorkManager Periodic Sync

For when no UnifiedPush distributor is installed:

**File**: `apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/push/PollWorker.kt`

```kotlin
class PollWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val stationApi = Container.get<StationApi>()
        val notifications = stationApi.pullNotifications()
        for (notif in notifications) {
            showLocalNotification(applicationContext, notif)
        }
        return Result.success()
    }
}

fun schedulePollWorker(context: Context) {
    val request = PeriodicWorkRequestBuilder<PollWorker>(15, TimeUnit.MINUTES)
        .setConstraints(
            Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
        )
        .build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(
        "notification_poll",
        ExistingPeriodicWorkPolicy.KEEP,
        request
    )
}
```

---

## 9. Verification

1. `./model/build.sh` succeeds (if push proto was added in this phase)
2. `cd apps/station && go build ./...` succeeds
3. `cd apps/station && go test ./...` passes
4. `POST /notification/push/register` creates a device record in `push_devices` table
5. `GET /notification/push/devices` returns registered devices for authenticated user
6. `POST /notification/push/unregister` removes the specified device
7. `GET /notification/push/vapid-key` returns the VAPID public key (no auth required)
8. VAPID keys are auto-generated on first boot and persisted across restarts
9. Notification production triggers push dispatch when recipient is offline (no SSE)
10. Push is skipped when recipient has active SSE connection (v1 actor-level check)
11. Push 410 response triggers automatic device cleanup
12. `push_enabled` preference is respected — disabling skips push for that category
13. Web Push (Desktop): Service Worker receives push and shows system notification
14. UnifiedPush (Android): PushReceiver receives message via distributor
15. APNs (iOS): Remote notification arrives when Station has APNs configured
16. Polling fallback: WorkManager/BGAppRefreshTask fetches notifications periodically

---

## 10. Go Dependencies

| Library | Purpose | Import |
|---------|---------|--------|
| `webpush-go` | Web Push / VAPID signing + RFC 8291 encryption | `github.com/SherClockHolmes/webpush-go` |
| `apns2` | APNs HTTP/2 client | `github.com/sideshow/apns2` |
| `firebase-admin-go` | FCM HTTP v1 API | `firebase.google.com/go/v4` |

Only `webpush-go` is always imported. `apns2` and `firebase-admin-go` are imported behind build tags or config checks — they are not required dependencies.

---

## 11. Deliverables

| Deliverable | Description |
|-------------|-------------|
| Push device proto (if not in Phase 1) | `PushChannelType`, `PushDevice`, register/unregister/list messages |
| `push_devices` table | GORM model + migration |
| PushGateway | Orchestrator with pluggable channel dispatch |
| WebPushChannel | VAPID-based Web Push with auto-key generation |
| UnifiedPushChannel | HTTP POST to distributor endpoint with RFC 8291 encryption |
| APNsChannel | HTTP/2 APNs client (optional, config-gated) |
| FCMChannel | Firebase Admin SDK client (optional, config-gated) |
| Push device management API | 4 endpoints: register, unregister, list, vapid-key |
| Desktop Service Worker | `sw.js` for push event + notification click handling |
| Desktop push subscription | Subscribe to Web Push and register with Station |
| Android PushReceiver | UnifiedPush BroadcastReceiver |
| iOS APNs registration | Complete AppDelegate device token flow |
| Polling fallback | Android WorkManager + iOS Background App Refresh |
| Production pipeline integration | Async push dispatch in `Produce()` |

---

## 12. Completion

After this phase, the full notification system is operational:

1. Proto-First domain model (Phase 1)
2. Persistent storage with transactional counter (Phase 2)
3. Real-time delivery via EventSystem SSE (Phase 3)
4. Cross-platform client presentation with locale-aware rendering and sound (Phase 4)
5. User preference control with rate limiting (Phase 5)
6. Push Gateway with multi-channel delivery and graceful degradation (Phase 6)
