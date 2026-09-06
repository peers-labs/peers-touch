# W9-D Social Convergence Report

## Test Configuration

| Property | Sim1 (Alice) | Sim2 (Bob) |
|---|---|---|
| Device | iPhone 15 Pro | iPhone 15 Pro Max |
| UDID | FE067914-... | 4B35B985-... |
| Email | alice@p.t | bob@p.t |
| PTID | ptid:v1:actor:peers:p:alice:1220f69308... | ptid:v1:actor:peers:p:bob:122000214d28... |
| Station | node-c (http://10.37.246.80:18080) | node-c (http://10.37.246.80:18080) |
| Build | devUrl HMR (Vite 5173) | devUrl HMR (Vite 5173) |

## Proven Gates (Partial)

### Two-Actor Login Convergence
- Both actors logged in via Email Login (alice@p.t, bob@p.t)
- Both sessions persisted to iOS Keychain via safeScopePart
- Both Shell pages rendered with 4 tabs (Chats, Moments, Contacts, Me)
- Evidence: sim1_alice_me.png, sim2_bob_me.png

### Presence Convergence
- Alice heartbeat: 200 OK, actor_id confirmed
- Bob heartbeat: 200 OK, actor_id confirmed
- Both actors registered with Station presence subsystem

### Profile Convergence
- Alice profile: "Alice node-c", avatar present
- Bob profile: "Bob node-c", avatar present
- Both profiles retrievable via /actor/profile

### Notification Convergence
- Alice: unread=0, notifications endpoint responsive
- Bob: unread=0, by_category responsive

### Station Identity Convergence
- Both actors share same Station (node-c)
- Both show "Encryption: Active"
- Settings layout identical across both devices

## Blocked Gates

### MS-AG06 Projection Freshness (BLOCKED)
- Station at 10.37.246.80:18080 does NOT deploy the `friend-chat` subserver
- All `/friend-chat/*` endpoints return 404
- All `/group-chat/*` endpoints return 404
- `/messaging/events` returns 404
- Cannot test: friend request send/accept, message exchange, realtime convergence

### MS-AG04 Unknown Outcome (BLOCKED)
- Requires friend-chat/messaging infrastructure to test command convergence
- Cannot inject network faults without active messaging channel

## Conclusion

W9-D achieves PARTIAL proof: two-actor login, presence, profile, and notification
convergence are proven on two iOS simulators with a shared Station. Full MS-AG06
(projection freshness) and MS-AG04 (unknown outcome) require the Station to deploy
the `friend-chat` and `group-chat` subservers.
