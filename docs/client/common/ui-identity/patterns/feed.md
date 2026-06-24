# Feed Pattern

> Status: Shared UI pattern for activity feeds.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

The feed pattern defines activity reading surfaces across Social, Agent Activity, Applet Activity, notifications, and future collaborative streams.

## 2. Feed Promise

A feed item must answer:

- What happened?
- Who or what caused it?
- Where did it come from?
- Why is it visible here?
- What can the user do next?

## 3. Anatomy

```text
Feed surface
  -> Scope header
  -> Optional composer/action surface
  -> Feed item list
      -> Actor/source row
      -> Primary content
      -> Context/meta row
      -> Action row
      -> Optional inline expansion
  -> Pagination/loading/recovery state
```

## 4. Layout Rules

- Feed is one continuous reading rail.
- Items should align to the same content edge.
- Action rows should align to item content, not drift to arbitrary card corners.
- Inline expansions should feel attached to their parent item.
- Pagination/loading should preserve feed geometry.

## 5. Surface Rules

- Prefer light separation over heavy nested cards.
- Use stronger surfaces only for composer, selected/detail state, or recovery.
- Do not make every item look like an independent dashboard panel.
- Do not mix table, card, and chat bubble metaphors in one feed unless the module contract defines why.

## 6. Metadata Rules

- Stable metadata should be quiet.
- Risky or decision-changing metadata should be explicit.
- Metadata should be grouped by meaning: source, audience, reason, time, relationship.
- Long metadata must truncate or wrap without stealing primary content hierarchy.

## 7. Action Rules

- Feed actions should be compact and repeatable.
- Primary per-item action should be discoverable without hover.
- Secondary per-item actions may live behind a menu.
- Destructive actions require scoped confirmation or reversible recovery.

## 8. Incomplete Capability Rules

- Unsupported action should not appear enabled.
- Future capability may appear as disabled only when the disabled reason is useful to the user.
- Runtime failure should show local retry, not a global page error.
- Empty feed, filtered feed, unavailable feed, and hidden-by-policy feed are different states.

## 9. AI Agent Checklist

- [ ] Is the feed one continuous reading rail?
- [ ] Does each item answer actor/source/content/context/action?
- [ ] Are inline expansions visually attached?
- [ ] Are metadata and trust states grouped by meaning?
- [ ] Are incomplete actions represented honestly?
