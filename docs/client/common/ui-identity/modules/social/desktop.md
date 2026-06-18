# Desktop Social UI Identity

> Status: Desktop refinement for Social UI Identity.
> Audience: Desktop engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

This document adapts Social UI Identity to Desktop.

It does not redefine the Social product model. It defines Desktop layout, surface, and interaction constraints for implementing it.

## 2. Desktop Social Layout

Desktop Social uses one primary content rail.

Rules:

- The app shell/sidebar owns navigation; Social page owns only the page canvas.
- Page title, tabs, primary CTA, composer, feed, detail, and comments align to one content rail.
- Do not leave a large unowned blank gutter between the shell and Social content.
- The primary rail should feel like a modern social feed, not a centered settings card.
- Detail mode should preserve feed context through a continuous thread surface.

## 3. Header, Tabs, And New Post

Rules:

- `New Post` is the only primary CTA in the Social page header.
- The CTA must share height, radius, and vertical rhythm with tabs.
- The CTA must use the project primary token, not an isolated black fill unless black is the active global primary token.
- Tabs should be quiet and readable; selected tab should not look like a separate button system.
- Header copy should be concise and should not compete with the feed.

## 4. Feed Item

Feed item anatomy:

```text
Author row
  -> Author avatar/name/handle
  -> Station/time meta
Body
  -> Text/media
Federation meta
  -> source · audience · reason
Action row
  -> reaction · comment · share/future
```

Rules:

- Author name and content are primary.
- Handle, station, time, audience, and reason are metadata.
- Action row must be compact, aligned, and low-noise.
- Reaction count and comment count must not look like unrelated buttons.
- The `more` menu must be visually secondary and bounded to the feed item.

## 5. Detail And Comment Thread

Detail mode should be one thread surface.

Rules:

- Back action belongs above the thread, not inside a detached card.
- The root post and comments must feel connected.
- Comments should use indentation, subtle dividers, or background continuity, not separate heavy cards.
- Reply composer belongs to the thread surface.
- Empty comments should read as "no replies yet", not as a missing panel.

## 6. Composer

Rules:

- Composer is an action surface, not a form card.
- Text input, media attachments, audience selector, and publish button share one state owner.
- Publish disabled state must explain empty text, uploading media, invalid audience, or offline/runtime failure when applicable.
- Audience selector must be visible enough to prevent privacy mistakes.

## 7. Reaction And Comments

Rules:

- Reaction picker should be compact and anchored to the reaction action.
- While reaction is pending, disable only the affected reaction group.
- A failed reaction restores the previous selected state/count.
- Comment submit pending state belongs to the reply composer.
- Comment failures preserve typed text and show inline recovery.

## 8. Station, Audience, And Moderation

Rules:

- Stable source/audience/reason appears as one quiet meta line.
- Degraded trust or moderation appears as an explicit trust surface.
- Station block/moderation state must come from Station policy projection.
- Do not infer blocked state from missing content.
- If station moderation aggregate notice is not implemented, show no fake notice; only show command pending/unavailable states where the user invokes them.

## 9. Desktop Interaction

Desktop may use hover and popover affordances.

Rules:

- Hover actions cannot be the only way to interact.
- Popovers cannot cover the content being reacted to or commented on.
- Keyboard focus must reach tabs, composer, reaction picker, comment action, and more menu.
- Focus returns to the source after popover close.

## 10. Acceptance States

Every Desktop Social implementation must capture or manually verify:

- Feed with one post.
- Feed with multiple posts.
- Detail with comments.
- Detail with zero comments.
- Reaction pending and success.
- Comment pending, success, and failure.
- Composer empty, typing, publish pending, publish failure.
- Long author name and long station domain.
- Narrow desktop window.
- Station moderation unavailable or not yet projected.

## 11. AI Agent Checklist

- [ ] Does the screenshot have one content rail?
- [ ] Are tabs and `New Post` part of one header system?
- [ ] Does detail/comment mode feel like one thread?
- [ ] Are action rows quiet and compact?
- [ ] Are pending states localized to the affected interaction group?
- [ ] Are station/audience/reason visible without dominating Human content?
