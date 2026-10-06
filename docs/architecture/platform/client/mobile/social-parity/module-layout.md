# Mobile Social Desktop Parity - Module Layout

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile / Social / Client Architecture

---

## 1. Target Tree

```text
apps/mobile/src/
├── app/navigation/
│   └── momentsRoutes.ts
├── features/social/
│   ├── mobileSocialFacade.ts
│   ├── socialExperienceProjection.ts
│   ├── socialIntents.ts
│   ├── socialAudience.ts
│   ├── socialCircles.ts
│   ├── momentsFeedStore.ts
│   ├── socialStore.ts
│   └── useSocialExperience.ts
├── runtimes/
│   ├── momentsProjectionDescriptor.ts
│   └── privateMomentsRuntime.ts
├── services/
│   ├── mobileCommands.ts
│   └── gateways/
│       └── momentsGateway.ts
└── pages/
    ├── MomentsPage.tsx
    └── moments/
        ├── MomentsScopeHeader.tsx
        ├── MomentComposerSheet.tsx
        ├── AudiencePickerSheet.tsx
        ├── AudienceTargetPickerPage.tsx
        ├── ExploreSortSheet.tsx
        ├── MomentExceptionDetailPage.tsx
        ├── MomentActionsSheet.tsx
        ├── MomentContent.tsx
        ├── MomentInlineComments.tsx
        ├── MomentMediaOverlay.tsx
        ├── SocialSearchPage.tsx
        ├── SocialProfilePage.tsx
        ├── SocialProfileActionsSheet.tsx
        ├── CircleListPage.tsx
        ├── CircleDetailPage.tsx
        ├── CircleMemberPickerPage.tsx
        ├── MomentFeedItem.tsx
        ├── MomentCommentsSection.tsx
        ├── PrivateStateSurface.tsx
        └── RemoteDeliveryState.tsx

apps/mobile/src-tauri/src/social/
├── mod.rs
├── commands.rs
├── adapter.rs
├── projection.rs
├── transport.rs
├── store.rs
└── worker.rs
```

Names describe target responsibilities. Existing files may be split/moved only through one atomic
ownership cut; no duplicate live facade or adapter is allowed.

## 2. Responsibilities

| Path | Owns | Must not own |
|---|---|---|
| `mobileSocialFacade.ts` | projection composition and intent routing | persistence, fetch, crypto, policy |
| `socialExperienceProjection.ts` | immutable UI read model | canonical business enums |
| `socialIntents.ts` | generated-intent adapters | hand-written domain protocol |
| `socialAudience.ts` | UI completeness over generated Audience | recipient authorization |
| `socialCircles.ts` | Circle projection/actions through port | Circle truth |
| `momentsFeedStore.ts` | bounded public feed input | private keys or page lifecycle |
| `privateMomentsRuntime.ts` | Web-to-Native private projection port | duplicate Native persistence |
| `momentsProjectionDescriptor.ts` | lifecycle registration/reconcile | page rendering |
| `momentsRoutes.ts` | route identity/back/focus/scroll | business selection truth |
| `pages/moments/*` | Mobile rendering and local interaction | gateway/runtime install |
| Rust `adapter.rs` | one typed Social interface | second business authority |
| Rust `transport.rs` | authenticated canonical Station transport | remote Station direct client |
| Rust `store.rs` | existing encrypted local ownership | parallel Web outbox |
| Rust `worker.rs` | bounded reconcile/replay | blind retry |

## 3. Dependency Direction

```text
pages/moments
  -> useSocialExperience
    -> mobileSocialFacade
      -> momentsFeedStore / socialStore / privateMomentsRuntime
        -> typed mobileCommands
          -> Rust social adapter
            -> canonical Station APIs / secure-content-core
```

Reverse imports are forbidden. Rust may emit sanitized projection events; it never imports Web/UI logic.

## 4. Component Lifetime

| Surface | Category | Cache |
|---|---|---|
| Moments primary tab | `on-visit + none` | projection externalized |
| Home/Explore feed | `virtualized content` | bounded window + anchor |
| Comment previews and composer | `lazy section` | 10 rows per item by default; one overflow group/composer selected; no route |
| Image/video preview | `on-visit + none` | selected-only overlay; no route |
| Profile/Search/Circles/target/member and exception Detail | `on-visit + none` | route presentation memory only |
| Composer | `on-visit + none` | encrypted draft externalized |
| Audience/Reaction/Circle edit sheet | `on-visit + none` | selected-only |
| runtime projection | lifecycle-owned | independent of page tree |

No hidden Mobile page tree is retained with CSS.

## 5. Registration

- Moments routes register with the existing Mobile navigation descriptor owner.
- Moments/private Social runtimes register once with the Mobile runtime registry.
- The architecture module is registered as `mobile-social-parity`.
- Prototype remains the single existing `mobile-chat` Mobile Shell manifest, amended for Social parity.
