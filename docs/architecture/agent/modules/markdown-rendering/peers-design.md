# P2-M1: Markdown Rendering — Design (S2)

> **Module**: P2-M1 Markdown Rendering
> **Status**: S2 design
> **Depends on**: P0 message display, P1 Portal

---

## 1. Current Architecture

The rendering pipeline is already in place:

```
message.content → <LazyMarkdown> → @lobehub/ui Markdown → react-markdown + shiki + plugins
```

- `LazyMarkdown.tsx`: Suspense wrapper for lazy-loaded `@lobehub/ui` Markdown
- `AssistantMessage.tsx` L475-503: passes `variant="chat"`, `animated`, custom code block actions
- `@lobehub/ui` v5.25 internally bundles: shiki (code), katex (math), mermaid (diagrams), rehype-raw, remark-gfm, remark-math, remark-breaks, rehype-github-alerts, beautiful-mermaid, remark-cjk-friendly

## 2. Design Decisions

### D1: Enable built-in rendering features via props

The `@lobehub/ui` Markdown component has these as opt-in props. We enable them:

| Prop | Value | Effect |
|------|-------|--------|
| `enableLatex` | `true` | KaTeX formula rendering (`$...$` inline, `$$...$$` block) |
| `enableMermaid` | `true` | Mermaid diagram rendering (```mermaid blocks) |
| `enableImageGallery` | `true` | Click image → lightbox preview |
| `enableGithubAlert` | `true` | `> [!NOTE]`, `> [!WARNING]` etc. blockquotes |
| `enableCustomFootnotes` | `true` | Footnote references `[^1]` |
| `streamSmoothingPreset` | `'balanced'` | Smooth streaming token animation |

These are set in `AssistantMessage.tsx` on the `<Markdown>` usage. No new components needed.

### D2: Centralize markdown config

Create a shared config object to avoid prop duplication across `AssistantMessage`, `UserMessage`, `MessageBubble`, `SharePage`, `NotesPage`:

```typescript
// apps/desktop/src/components/messages/markdownConfig.ts
export const chatMarkdownProps = {
  enableLatex: true,
  enableMermaid: true,
  enableImageGallery: true,
  enableGithubAlert: true,
  enableCustomFootnotes: true,
  streamSmoothingPreset: 'balanced' as const,
};
```

Each consumer spreads `{...chatMarkdownProps}` then adds its own overrides (e.g. `animated`, custom `componentProps`).

### D3: Thinking block as markdown content (not external component)

Currently, `message.thinking` renders in `DiagnosticsBlock` as a plain `<pre>`. The thinking content is NOT part of `message.content` — it's a separate field.

**Decision**: Keep thinking in DiagnosticsBlock (it's metadata, not user-visible content). No change here. LobeHub's `LobeThinking` plugin is for `<think>` tags inside content — if models output `<think>...</think>` within `message.content`, `@lobehub/ui` handles it natively via `rehype-raw`. No custom plugin needed.

### D4: Tool call inline rendering

LobeHub has a `Tool/` markdown plugin that renders tool calls inline within markdown content. In our architecture, tool calls are **separate data** (`message.toolCalls[]`), NOT embedded in markdown content. They render via `ToolCallsBlock` above the content.

**Decision**: No markdown plugin needed. Current architecture is correct — tool calls are structured data rendered by dedicated components, not markdown text.

### D5: SearchPage simpleMarkdown replacement

`SearchPage.tsx` uses a regex-based `simpleMarkdown()` with `dangerouslySetInnerHTML`. While XSS-safe (escapes first), it lacks code blocks, links, etc.

**Decision**: Replace with `<LazyMarkdown variant="chat" fontSize={13}>` for search AI answers. The Suspense fallback handles the lazy load. Simple and consistent.

### D6: Remove unused `rehype-highlight` dependency

Project declares `rehype-highlight ^7.0.2` in `package.json` but never imports it. `@lobehub/ui` uses shiki internally. Remove it.

### D7: SkillsTab markdown upgrade

`SkillsTab.tsx` uses raw `react-markdown` with only `remark-gfm`. Replace with `<LazyMarkdown>` for consistent rendering (code highlighting, GFM, CJK).

## 3. File Changes

| File | Change |
|------|--------|
| `src/components/messages/markdownConfig.ts` | **NEW** — shared props |
| `src/components/messages/AssistantMessage.tsx` | Spread `chatMarkdownProps`, add `enableLatex/enableMermaid/etc.` |
| `src/components/MessageBubble.tsx` | Spread `chatMarkdownProps` |
| `src/pages/SearchPage.tsx` | Replace `simpleMarkdown` + `dangerouslySetInnerHTML` with `<LazyMarkdown>` |
| `src/components/SkillsTab.tsx` | Replace `react-markdown` with `<LazyMarkdown>` |
| `apps/desktop/package.json` | Remove `rehype-highlight` |

## 4. Out of Scope (deferred)

- Custom remark plugins (Skill, Task, Mention, LocalFile, etc.) — these depend on features not yet built (Task Management = P2-M7, etc.)
- HTML preview mode — not needed until artifacts render HTML
- Video embed plugin — covered by P2-M4

## 5. Verification

- `pnpm run check` passes
- Markdown renders: code blocks with shiki highlighting, LaTeX formulas, Mermaid diagrams, GFM tables, footnotes, GitHub alerts
- Search page AI answers render markdown properly
- Streaming animation is smooth with `balanced` preset
