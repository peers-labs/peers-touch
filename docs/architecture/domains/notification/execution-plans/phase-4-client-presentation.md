# Execution Plan — Phase 4: Client Presentation

> Implements the Desktop and Mobile client-side notification handling, including SSE event processing, state management, UI components, sound playback, and content rendering.

---

## 1. Objective

- Desktop: Handle `notification.*` SSE events in the kernel event system
- Desktop: Extend GlobalContext NotificationSlice with real notification data
- Desktop: Implement locale-aware notification content rendering
- Desktop: Implement sound playback with category mapping and preference control
- Desktop: Build notification UI components (bell icon, panel, grouped list)
- Mobile: Extend notification bridges for category-based notifications with custom sound
- Mobile: Implement badge count synchronization

---

## 2. Dependency

- Phase 1 completed (Proto + domain model)
- Phase 2 completed (Storage + SubServer + API endpoints)
- Phase 3 completed (Delivery + SSE events flowing)

---

## 3. Architectural Context

This phase implements the **Client Presentation Boundary** (Architecture §8).

Key architectural constraints from §3.3 and §8:

- **Client-side presentation ownership**: Station provides structured data (`type`, `actor_id`, `target_type`, `target_id`) and fallback text (`title`, `body`). Client owns rendering, locale, sound, and badge management.
- **Content rendering** (§8.2): Rich clients render locale-aware display text from structured references. The server-generated `title`/`body` are fallback/preview text only.
- **Sound is a client concern** (§8.5): Station carries the `sound_enabled` preference flag and the `soundEnabled` hint in the SSE payload; actual audio playback is handled by each platform's native API.

---

## 4. Tasks — Desktop

### 4.1 Add Event Types to Catalog

**File**: `apps/desktop/src/kernel/events/catalog.ts`

```typescript
NOTIFICATION_CREATED = "notification.created"
NOTIFICATION_READ = "notification.read"
NOTIFICATION_DELETED = "notification.deleted"
NOTIFICATION_COUNT_UPDATED = "notification.count.updated"
```

### 4.2 Extend NotificationSlice Types

**File**: `apps/desktop/src/kernel/global-context/types.ts`

```typescript
enum NotificationCategory {
  SOCIAL = 1,
  CHAT = 2,
  SYSTEM = 3,
  TASK = 4,
}

enum NotificationStatus {
  UNREAD = 1,
  READ = 2,
  ARCHIVED = 3,
}

interface NotificationItem {
  id: string;
  recipientId: string;
  actorId: string;
  type: number;
  category: NotificationCategory;
  status: NotificationStatus;
  targetType: string;
  targetId: string;
  title: string;
  body?: string;
  groupKey?: string;
  createdAt: string;
  readAt?: string;
}

interface UnreadCounts {
  total: number;
  byCategory: Record<NotificationCategory, number>;
}

interface NotificationSlice {
  notifications: NotificationItem[];
  unreadCounts: UnreadCounts;
  isLoading: boolean;
  selectedCategory: NotificationCategory | null;
  pushNotification: (item: NotificationItem) => void;
  removeNotification: (id: string) => void;
  markAsRead: (ids: string[]) => void;
  markAllAsRead: (category?: NotificationCategory) => void;
  updateUnreadCounts: (counts: UnreadCounts) => void;
  setSelectedCategory: (category: NotificationCategory | null) => void;
  fetchNotifications: (category?: NotificationCategory) => Promise<void>;
}
```

### 4.3 Implement NotificationSlice Store

**File**: `apps/desktop/src/kernel/global-context/store.ts`

Extend the Zustand store with notification state management:

- `pushNotification`: Called when `notification.created` SSE event arrives
- `markAsRead`: Updates local state + calls API `POST /notification/read`
- `markAllAsRead`: Updates local state + calls API `POST /notification/read-all`
- `updateUnreadCounts`: Called when `notification.count.updated` SSE event arrives
- `fetchNotifications`: Calls `GET /notification/list` on initial load

### 4.4 Content Rendering Module

**New file**: `apps/desktop/src/kernel/notification/content.ts`

Implements the content rendering strategy (Architecture §8.2). Maps structured references to locale-aware display text:

```typescript
interface NotificationContentResult {
  displayTitle: string;
  displayBody: string;
  navigateAction?: () => void;
}

function renderNotificationContent(
  item: NotificationItem,
  locale: string,
  resolveActor: (id: string) => ActorDisplayInfo | undefined,
): NotificationContentResult {
  const actor = resolveActor(item.actorId);
  const actorName = actor?.displayName ?? item.actorId;

  const templateKey = notificationTypeToTemplateKey(item.type);
  const template = i18n.t(templateKey, { actor: actorName });

  return {
    displayTitle: template || item.title,
    displayBody: item.body ?? "",
    navigateAction: buildNavigateAction(item.targetType, item.targetId),
  };
}
```

Template keys follow the pattern `notification.social.post_liked`, etc., and are added to the locale files in `packages/locales/`.

### 4.5 Sound Playback Module

**New file**: `apps/desktop/src/kernel/notification/sound.ts`

Implements sound playback using standard Web Audio API (Architecture §8.5):

```typescript
type SoundCategory = "social" | "chat" | "system" | "task";

const SOUND_MAP: Record<SoundCategory, string> = {
  social: "/sounds/notification_social.wav",
  chat: "/sounds/notification_chat.wav",
  system: "/sounds/notification_system.wav",
  task: "/sounds/notification_task.wav",
};

const audioCache = new Map<string, HTMLAudioElement>();

function preloadSounds(): void {
  for (const src of Object.values(SOUND_MAP)) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audioCache.set(src, audio);
  }
}

function playNotificationSound(category: SoundCategory): void {
  const src = SOUND_MAP[category];
  const audio = audioCache.get(src) ?? new Audio(src);
  audio.currentTime = 0;
  audio.play().catch(() => {});
}
```

Call `preloadSounds()` once at app initialization (e.g., in kernel boot).

**Sound assets**: Place 4 WAV files in `apps/desktop/public/sounds/`:

| File | Description |
|------|-------------|
| `notification_social.wav` | Soft chime for social interactions |
| `notification_chat.wav` | Distinctive message tone for chat |
| `notification_system.wav` | Neutral alert for system notices |
| `notification_task.wav` | Brief bell for task updates |

Spec: WAV PCM 16-bit, ≤ 1.5s, 44100 Hz, ≤ 100 KB each.

### 4.6 SSE Event Handler with Sound

In the SSE connection handler, integrate content rendering and sound:

```typescript
eventSource.addEventListener("notification.created", (e) => {
  const payload = JSON.parse(e.data);
  const item = payloadToNotificationItem(payload);
  store.pushNotification(item);

  if (payload.payload.soundEnabled) {
    playNotificationSound(categoryToSoundKey(item.category));
  }
});

eventSource.addEventListener("notification.count.updated", (e) => {
  const payload = JSON.parse(e.data);
  store.updateUnreadCounts(payload.payload);
});
```

### 4.7 UI Components

| Component | Location | Description |
|-----------|----------|-------------|
| `NotificationBell` | Header area | Bell icon with unread count badge. Click opens NotificationPanel |
| `NotificationPanel` | Drawer/Popover | Category tabs (All, Social, Chat, System, Task) + notification list |
| `NotificationList` | Inside Panel | Scrollable list with grouped display, mark-read actions |
| `NotificationItem` | Inside List | Single notification card: avatar, rendered title, body, timestamp, action buttons |
| `NotificationSettings` | Settings page | Per-category toggle (enabled, push, sound) |

UI library: Follow Desktop convention — **LobeUI first, antd fallback**.

`NotificationItem` uses `renderNotificationContent()` to display locale-aware text with navigable actor names and targets.

### 4.8 API Client Functions

```typescript
export const notificationApi = {
  list: (params: ListParams) => request.get('/notification/list', { params }),
  listGrouped: (params: ListParams) => request.get('/notification/grouped', { params }),
  markRead: (ids: string[]) => request.post('/notification/read', { notification_ids: ids }),
  markAllRead: (category?: number) => request.post('/notification/read-all', { category }),
  delete: (ids: string[]) => request.post('/notification/delete', { notification_ids: ids }),
  getUnreadCounts: () => request.get('/notification/unread-counts'),
  getPreferences: () => request.get('/notification/preferences'),
  updatePreference: (data: PreferenceUpdate) => request.post('/notification/preferences', data),
};
```

---

## 5. Tasks — Mobile

### 5.1 iOS Extensions

**File**: `apps/mobile/ios/PeersTouch/Core/Lynx/Bridge/NotificationBridgeModule.swift`

Extend the existing bridge:

| Method | Description |
|--------|-------------|
| `requestPermission` | Request `UNUserNotificationCenter` authorization |
| `showCategoryNotification(title, body, category, data)` | Show notification with category-based settings and sound |
| `updateBadgeCount(count)` | Update app icon badge number |
| `clearCategory(category)` | Clear notifications for a specific category |

Custom sound per category (Architecture §8.5):

```swift
private func soundForCategory(_ category: String) -> UNNotificationSound {
    switch category {
    case "social":
        return UNNotificationSound(named: UNNotificationSoundName("notification_social.wav"))
    case "chat":
        return UNNotificationSound(named: UNNotificationSoundName("notification_chat.wav"))
    case "system":
        return UNNotificationSound(named: UNNotificationSoundName("notification_system.wav"))
    case "task":
        return UNNotificationSound(named: UNNotificationSoundName("notification_task.wav"))
    default:
        return .default
    }
}
```

**Sound assets**: Place 4 WAV files in `apps/mobile/ios/PeersTouch/Resources/Sounds/`.

### 5.2 Android Extensions

**File**: `apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/lynx/bridge/NotificationBridgeModule.kt`

Extend the existing bridge:

| Method | Description |
|--------|-------------|
| `createCategoryChannels()` | Create NotificationChannel per category with custom sound (API 26+) |
| `showCategoryNotification(title, body, category, data)` | Post notification to appropriate channel |
| `updateBadgeCount(count)` | Update launcher badge via `ShortcutBadger` |
| `cancelByCategory(category)` | Cancel notifications for a category |

Per-channel sound configuration (Architecture §8.5):

```kotlin
private fun createCategoryChannels() {
    val soundMap = mapOf(
        "social" to "notification_social",
        "chat" to "notification_chat",
        "system" to "notification_system",
        "task" to "notification_task",
    )

    for ((key, soundName) in soundMap) {
        val soundUri = Uri.parse(
            "android.resource://${context.packageName}/raw/$soundName"
        )
        val channel = NotificationChannel(
            "peers_$key",
            key.replaceFirstChar { it.uppercase() },
            if (key == "chat") NotificationManager.IMPORTANCE_HIGH
            else NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            setSound(soundUri, AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build())
        }
        notificationManager.createNotificationChannel(channel)
    }
}
```

**Sound assets**: Place 4 WAV files in `apps/mobile/android/app/src/main/res/raw/`.

> **Note**: On Android, once a channel is created, its sound cannot be changed programmatically — the user controls it via system settings. If `sound_enabled = false` for a category, use a separate silent channel (e.g., `peers_social_silent`).

### 5.3 Mobile SSE/WebSocket Event Handling

If Mobile connects to Station via SSE (through Lynx WebView or native HTTP client), handle `notification.*` events:

1. Parse `notification.created` event
2. Call native bridge to show system notification (with category sound)
3. Parse `notification.count.updated` event
4. Update badge count via bridge

---

## 6. Verification

### Desktop

```bash
cd apps/desktop && pnpm run check && pnpm run test && pnpm run build
```

Functional verification:

1. Start Station + Desktop
2. Perform a notifiable action (e.g., like a post)
3. Verify notification bell badge updates
4. Click bell → notification panel opens with the notification
5. Verify notification text is locale-aware (not raw server-generated text)
6. Click "mark as read" → badge count decrements
7. Open Settings → notification preferences toggle works
8. Verify notification sound plays when a notification arrives
9. Disable sound for "Social" category → verify no sound for social notifications
10. Re-enable sound → verify sound plays again

### Mobile

```bash
cd apps/mobile/android && ./gradlew build
cd apps/mobile/ios && xcodebuild build
```

Functional verification:

1. Trigger a notification from Station
2. Verify system notification appears with correct category channel
3. Verify badge count updates
4. Verify notification tap opens relevant content
5. Verify each category channel plays its assigned custom sound
6. Verify Android system settings show per-channel sound control

---

## 7. Deliverables

| Deliverable | Path |
|-------------|------|
| Event catalog extension | `apps/desktop/src/kernel/events/catalog.ts` |
| NotificationSlice types | `apps/desktop/src/kernel/global-context/types.ts` |
| NotificationSlice store | `apps/desktop/src/kernel/global-context/store.ts` |
| Content rendering module | `apps/desktop/src/kernel/notification/content.ts` |
| Sound playback module | `apps/desktop/src/kernel/notification/sound.ts` |
| Sound assets (Desktop) | `apps/desktop/public/sounds/notification_*.wav` |
| Notification locale templates | `packages/locales/` (en, zh, etc.) |
| Notification API client | `apps/desktop/src/api/notification.ts` |
| NotificationBell component | `apps/desktop/src/components/NotificationBell/` |
| NotificationPanel component | `apps/desktop/src/components/NotificationPanel/` |
| NotificationSettings component | `apps/desktop/src/components/NotificationSettings/` |
| iOS bridge extension | `apps/mobile/ios/.../NotificationBridgeModule.swift` |
| iOS sound assets | `apps/mobile/ios/PeersTouch/Resources/Sounds/notification_*.wav` |
| Android bridge extension | `apps/mobile/android/.../NotificationBridgeModule.kt` |
| Android sound assets | `apps/mobile/android/app/src/main/res/raw/notification_*.wav` |

---

## 8. Next Phase

Phase 5: Preference & Advanced Features
