# Chat attachment viewing

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-24 | **Updated**: 2026-10-25
> **Owner**: Chat Product Team

Applies to Desktop and Mobile, sender and receiver, Direct and Group
conversations. Governs CHAT-J03, CHAT-J06 and CCU-J04.

## Product contract

An attachment card identifies the original filename, file type, size and current
transfer state. Selecting it immediately opens a file detail surface. A remote
file begins a resumable download; the surface displays progress, cancel, retry
and an actionable terminal error. Reopening it resumes the same attachment.
Closing the surface leaves the transfer under Messaging Runtime ownership.

The detail surface previews supported images, audio, video, PDF, plain text and
common Office documents. DOCX uses a local document renderer; XLSX and XLS use a
local workbook parser with sheet selection and a bounded table viewport;
PPTX and PPT use a local presentation parser with slide navigation. Older or
decoder-unsupported Word/OpenDocument formats retain platform document preview
and explicit external opening. Archives show details and explicit open/save
actions. Executable content is never launched automatically. Unsupported or
unavailable preview remains a usable detail surface with its filename and
actions.

Both clients use the same selected-resource preview lifecycle. File byte length
does not decide whether PDF, text or image preview is available. PDF.js consumes
authenticated Range reads, disables automatic full-file fetching and renders
one page at a time to a canvas bounded to 4 megapixels. Text is read in bounded
pages with Unicode-safe boundaries. Native image preview reads the verified
cache, decodes within a resource budget and returns a reduced representation
under the original revocable grant. Neither path assembles an arbitrarily large
original in the WebView merely to show the first page.

PDF.js may coalesce several demand chunks. Each such demand is read in 1 MiB
native ranges and returned once, as required by its transport, with a 32 MiB
contiguous-demand budget. Resource exhaustion preserves explicit system actions.
The canvas raster budget does not change logical page size or zoom geometry.
Native image admission includes encoded input, bit depth, codec working planes,
reduced pixels and output; encoded decoder input is bounded to 32 MiB. JPEG
progressive coefficients and WebP compositing have separate working-set
reservations. JPEG EXIF rotation and mirroring are applied to the representation.

Office parsers have independent limits for decoded archive bytes, entries,
document nodes, cells and decoded image pixels. These protect parser resources;
they are not sender upload or download quotas. ZIP metadata is read by Range
and relevant parts are admitted before inflation. Parse cancellation, resource
exhaustion and unsupported formats remain visible and keep native preview,
external open and save available. Libraries load only when a selected file
needs them. Closing, leaving Chat or changing scope cancels reads, terminates
owned workers, releases document resources and removes the rendered surface.
Document scripts, macros, active HTML parts and external resources are not
executed or fetched. No document is uploaded to an online conversion service.

Archive admission follows the actual ZIP signature, including OOXML files
renamed to legacy extensions. Legacy binary paths require a CFB signature.
Word inline BMP images and landscape sections preserve their SDK page geometry.

Word parsing and rendering run in the same cancellable document worker, using
the local SDK with an inert DOM implementation. The WebView receives one
sanitized page at a time in a script-free sandbox. Workbook parsing and slide
rendering use that same worker lifecycle. Archive inflation also checks actual
written bytes, independently of declared ZIP sizes. Legacy XLS/PPT parsers use
a bounded contiguous input; parser resource exhaustion preserves system actions.
The existing encrypted-object transfer ceiling is 2 GiB, owned by
`secure-content-core` object validation. This preview change does not change
that protocol contract.

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
- Acceptance's Native driver owns macOS document scripting and window/content
  observations. Chat Gates retain attachment identity, selected UI actions,
  integrity/eviction oracles and cleanup decisions; they contain no platform
  scripting implementation.

## File safety and lifecycle

Cache identity is attachment identity, independent of mutable display names.
Display/export filenames remove separators, control characters and traversal
components, preserve a bounded extension, and supply a deterministic fallback.
Asset reads must remain constrained to authenticated Engine-managed roots.
Text preview bounds the rendered page and renders text, never HTML or script.

## Preview composition

The selected file is the main reading subject. The detail header shows its
filename, short format and size; raw MIME is supporting inspectable metadata.
One bounded reading rectangle owns scrolling, with its navigation above content
and the system action rail outside it. PDF has fit-width, fit-page and actual-size
choices. Word pages preserve the local renderer's page dimensions. Workbooks
show source row numbers, column letters, cell ranges and merged cells inside
their bounded viewport. System preview is named separately from the in-app
reader. Image cards request the same grant's reduced representation independent
of original byte length, with readable text on their owning message surface.

`data-chat-preview-state` publishes loading, ready or unavailable. PDF page
identity becomes ready only after the current render promise finishes; Word
and slide frames publish after their load and paint opportunity. Downloaded
bytes and an allocated decoder node do not imply completed visible content.
Evidence captures must match the selected attachment, filename, format and
completed page. Each screenshot is inspected; a blank nonempty page, absent
dialog, incorrect file or mismatched format invalidates that screenshot.
Large-file byte tests and high-resolution image tests are separate obligations.

The existing `client-chat-core` selected-resource mount is the sole format
dispatcher. It composes local format adapters; Desktop and Mobile supply
translated labels and preserve their existing modal, metadata, transfer,
cancel/retry, system preview, external-open and save action hierarchy.
Format navigation stays inside the preview rectangle. A document renderer
cannot install a page, create a second Messaging Runtime, change selection
ownership, resolve an unrestricted path or contact Station directly.

The byte reader accepts only the Runtime-supplied opaque asset URL, validates
Range identity and size, and shares the selected mount's abort signal. Derived
image requests are representations of that same asset handle, not new grants
or attachment metadata. Native revalidates Engine scope before reading or
returning a representation. Grants and derivatives are revoked together.

Reusable libraries own document format decoding. The integration owns worker
lifetime, archive admission, disabled external relationships, rendered-content
isolation, locale labels, viewport bounds and teardown. Library-internal
document objects never become a new public business DTO or persistence model.
User exports continue to contain the original verified bytes, never the
preview's reduced representation.

An access handle is bound to actor, Station, profile, device and activation
generation. Native rejects stale handles and paths outside its owned roots.
Background validation of the unchanged per-window account/PTID/JWT preserves
the activation generation; it must not revoke an open file preview. The
window session registry owns this atomic rebinding rule. Genuine authority
replacement or logout continues to invalidate the previous generation.
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
that arrives before OS dispatch still fences the late action. Capacity compacts
older identities behind the fixed issuance watermark and admits newly issued
actions. Desktop profile teardown revokes grants before worker draining,
including teardown failures and engines retained by in-flight operations.
After cache eviction, an explicit open first finalizes descriptor-bound verified
plaintext staging under the transfer permit. Only absence of completed local
artifacts queues restoration of the same download identity.
A failed cache commitment stays unavailable until explicit retry
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
