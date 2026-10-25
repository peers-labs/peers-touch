# Chat attachment viewing

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-24 | **Updated**: 2026-10-24
> **Owner**: Chat Product Team

Applies to Desktop and Mobile, sender and receiver, Direct and Group
conversations. Governs CHAT-J03, CHAT-J06 and CCU-J04.

## Product contract

An attachment card identifies the original filename, file type, size and current
transfer state. Selecting it immediately opens a file detail surface. A remote
file begins a resumable download; the surface displays progress, cancel, retry
and an actionable terminal error. Reopening it resumes the same attachment.
Closing the surface leaves the transfer under Messaging Runtime ownership.

The detail surface previews supported images, audio, video, PDF and bounded
plain text. Office documents use the platform document preview where available;
otherwise the user explicitly chooses an external application. Archives show
details and explicit open/save actions. Executable content is never launched
automatically. Unsupported or unavailable preview remains a usable detail
surface with its filename and actions.

Both clients use the same selected-resource preview lifecycle. Images assemble
at most 32 MiB; text is limited to 512 KiB. PDF.js loads lazily in a bundled
worker, reads at most 64 MiB and renders one page at a time to a canvas bounded
to 4 megapixels. It does not instantiate a document frame, execute document
scripts or enable XFA. Oversized or decoder-unsupported content retains native
preview/open/save actions. Inline image cards fall back to a filename card
above the asset protocol's 8 MiB read limit.

Preview, Open externally and Save a copy are distinct intents. External opening
uses a disposable copy with the original safe basename and extension. Saving
uses the platform destination picker/export controller and reports cancellation
separately from failure. Neither operation gives an external application a
writable reference to the immutable verified attachment cache. Saved files
survive Chat cache eviction.

An asynchronous download can update the current detail surface; it cannot open
a system application after the user closes the surface, changes conversation,
changes account, switches Station or leaves Chat. A fresh explicit action is
required for an external open or export.

## Ownership and contracts

- `secure-content-core` owns reusable safe filename and verified file-copy
  mechanisms. It does not know Chat membership or Station routing.
- `messaging-native-filesystem` adapts those stream mechanisms to Engine-owned
  roots, opaque file grants, bounded asset reads and disposable handoff copies.
  It does not authorize conversation membership or invoke system applications.
- Messaging Core and each Device Messaging Engine retain authorization,
  encryption, integrity verification, durable transfer checkpoints and retry.
  A sender reads its verified staged/cache bytes, never the original mutable
  picker source. Station continues to see ciphertext descriptors only.
- Local attachment-access contracts are protobuf-first under
  `model/domain/chat/attachment.proto`. They do not change encrypted message
  metadata or add a Station plaintext endpoint.
- `client-chat-core` owns file classification and a scoped, deduplicated access
  controller. Desktop/Mobile Messaging Runtimes install the controller, refresh
  pending requests from projection events and bounded reconciliation, and
  invalidate it at scope teardown. Renderers subscribe and dispatch intent.
- Native resolves attachment identity within the active authenticated Engine.
  Presentation receives an opaque access handle/asset URL and public metadata,
  never an unrestricted native path. Native revalidates scope and verified bytes
  before preview, external opening or export.
- Desktop uses native file dialogs and system application integration. Mobile
  extends the existing `platform-permissions` plugin: iOS Quick Look and document
  export; Android FileProvider with temporary read grants, ACTION_VIEW and the
  Storage Access Framework. A URL opener is not a Mobile file adapter.

## File safety and lifecycle

Cache identity is attachment identity, independent of mutable display names.
Display/export filenames remove separators, control characters and traversal
components, preserve a bounded extension, and supply a deterministic fallback.
Asset reads must remain constrained to authenticated Engine-managed roots.
Text preview is size bounded and renders text, never HTML or script.

An access handle is bound to actor, Station, profile, device and activation
generation. Native rejects stale handles and paths outside its owned roots.
System handoff copies are owned by a bounded platform staging area, while
user-selected exports are outside cache retention ownership. No cache cleanup
removes a saved export.

Each access read receives its own opaque grant. Runtime revocation precedes
reacquisition; releasing a late result cannot revoke a newer reader's grant.
Native verification runs outside the grant registry lock and checks a captured
revocation epoch between bounded reads. Suspension disables new grants; resume
keeps the old epoch invalid. IPC checks the captured Engine, owner and epoch
again before returning and releases a rejected late grant directly.
Mobile native adapters retain bounded cancellation identities so a cancellation
that arrives before OS dispatch still fences the late action. After cache
eviction, an explicit open queues restoration of the same completed download
identity. A failed cache commitment stays unavailable until explicit retry
removes the corrupt cache and restores verified bytes.

Native action issuance is fixed before authorization and cannot advance past a
cancel-all watermark. Android's owned export picker retains its bounded action
across its own Activity stop; actual scope revocation, timeout and teardown
still cancel it. Preview/export copies are removed after their terminal
operation. macOS Quick Look belongs to the Host presentation registry and is
terminated on grant/scope revocation and before application exit. Temporary
copies use private directories and files on Unix.

Cancellation has one publication owner. A caller timeout keeps transfer
admission fenced until the active attempt drains; explicit retry finishes that
cancellation before requeueing. Background access reconciliation has a retention
limit, while a selected detail continues observing its Runtime-owned transfer.

## Verification obligations

Source/contract checks cover classification, filename safety, integrity mismatch,
cancel/retry, duplicate requests, stale scope and closed-surface fencing.
Native Journeys must send files in both directions and prove sender/receiver
filename, exact bytes, preview, external copy isolation and saved-file retention.
The matrix includes image, audio, video, PDF, text, Office, archive and unsupported
content; interrupted download, retry, account/Station change and restart.
Unavailable OS/native cells remain UNPROVEN. Browser or API checks cannot
substitute for platform preview, destination picker or external-application proof.

## Research basis

- [WeChat file-opening tools](https://support.weixin.qq.com/cgi-bin/mmsupportacctnodeweb-bin/pages/5ovo5GKYRLqp7KJZ)
- [Signal media/file viewing and saving](https://support.signal.org/hc/en-us/articles/360007317471-View-and-save-media-or-files)
- [Signal download policy](https://support.signal.org/hc/en-us/articles/360056044831-Data-Usage-Options-Wi-Fi-Cellular)
- [Slack file interactions](https://slack.com/help/articles/201330736-Add-files-to-Slack)
- [iOS Quick Look](https://developer.apple.com/documentation/quicklook/qlpreviewcontroller)
- [Android secure file sharing](https://developer.android.com/training/secure-file-sharing/share-file)
- [Tauri opener platform support](https://v2.tauri.app/plugin/opener/)
