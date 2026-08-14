# P2-M1: Markdown Rendering — Acceptance (S2/S4)

> **Module**: P2-M1 Markdown Rendering
> **Status**: defined (execute in S4)

---

## Deterministic Checks (automated)

| # | Check | Command / Verification |
|---|-------|----------------------|
| D1 | TypeScript compiles | `cd apps/desktop && pnpm run check` — 0 errors |
| D2 | No `any` types in new/modified files | `grep ': any' apps/desktop/src/components/messages/markdownConfig.ts` → 0 hits |
| D3 | No console.log | `grep -r 'console.log' apps/desktop/src/components/messages/markdownConfig.ts` → 0 hits |
| D4 | `rehype-highlight` removed from package.json | `grep 'rehype-highlight' apps/desktop/package.json` → 0 hits |
| D5 | No `dangerouslySetInnerHTML` in SearchPage AI answer | `grep 'dangerouslySetInnerHTML' apps/desktop/src/pages/SearchPage.tsx` → 0 hits (for the AI answer section) |
| D6 | No direct `react-markdown` import in SkillsTab | `grep "from 'react-markdown'" apps/desktop/src/components/SkillsTab.tsx` → 0 hits |
| D7 | markdownConfig.ts exists | File exists and exports `chatMarkdownProps` |

## Functional Scenarios (manual, S4)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| F1 | LaTeX formula rendering | Send message containing `$E=mc^2$` and `$$\int_0^1 x^2 dx$$` | Inline and block formulas render with KaTeX |
| F2 | Mermaid diagram | Send message with ```mermaid\ngraph TD\nA-->B``` | Diagram renders as SVG |
| F3 | Code block highlighting | Send message with ```typescript\nconst x = 1;``` | Shiki syntax highlighting with language tag, copy/export/run actions |
| F4 | GFM table | Send message with markdown table | Table renders with borders and alignment |
| F5 | GitHub alert | Send message with `> [!WARNING]\n> Important note` | Renders as styled warning blockquote |
| F6 | Image gallery | Send message with multiple images | Click image opens lightbox |
| F7 | Streaming smoothness | During streaming response | Tokens appear with balanced smooth animation, no jank |
| F8 | Search page markdown | Search → get AI answer with code/bold/links | Renders properly via LazyMarkdown (no raw HTML) |
| F9 | Skills tab markdown | View skill detail with code blocks | Code blocks have syntax highlighting |
| F10 | Footnotes | Send message with `text[^1]...\n[^1]: note` | Footnote link and definition render correctly |

## Integration Checks

| # | Check | Verification |
|---|-------|-------------|
| I1 | No regression in existing chat | Messages render identically with new props (additive only) |
| I2 | LazyMarkdown backwards-compatible | All existing consumers (UserMessage, SharePage, NotesPage) unaffected |
| I3 | Bundle size stable | No new heavy dependencies (all features from existing @lobehub/ui) |
