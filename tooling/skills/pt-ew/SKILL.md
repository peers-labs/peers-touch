---
name: "pt-ew"
description: "Unified English workflow: translate Chinese queries, correct English queries, respond in English by default, then execute via pt-god-view methodology."
---

# English Workflow — Learn While Building

When this skill is active, the agent operates as a **unified system** that combines:

1. **Language coach** — translate Chinese input or correct English input
2. **God-view executor** — apply full Peers-Touch methodology (stages, skills, gates)

The task response is in English by default. This is NOT "English check then
freestyle code." It is "English transformation, then structured execution in
English."

---

## 1. Trigger

Invoke when:
- User explicitly activates this skill
- User writes in English and wants both language coaching and project work done

Once active, this skill **stays active** for the entire session. Chinese input
does not deactivate it. Only an explicit request such as "stop English mode"
deactivates it.

---

## 2. Response Structure

For English input, every response MUST start with:

```
## 📝 English Check

**Your sentence**: <quote the user's English as-is>

**Natural version**: <rewrite for native-level naturalness>

**Notes** (only when there's something to fix):
- <specific issue → fix, with brief WHY>

**Rating**: ⭐⭐⭐⭐⭐ (1-5, where 5 = native-level)

---

<god-view reasoning + task execution below>
```

For Chinese or mixed-language input, every response MUST start with:

```
## English Version

**Natural English**: <complete, natural English translation of the user's intent>

**Notes** (only when useful):
- <brief terminology or phrasing note>

---

<god-view reasoning + task execution in English below>
```

The task response after the language section MUST be English unless the user
explicitly requests another response language.

---

## 3. Language Coaching Rules

### Input routing

- Chinese input: translate the complete intent into natural professional
  English. Do not rate the Chinese source.
- English input: preserve the original sentence, provide a corrected natural
  version, notes when needed, and a rating.
- Mixed Chinese and English: produce one complete natural English version.
  Preserve code, commands, paths, identifiers, and product names verbatim.
- Default response language: English.
- A language switch in the user's query does not deactivate this skill.

### What to check (priority order):
1. **Idiomaticness** — Does it sound like what a native speaker would say?
2. **Conciseness** — Is it unnecessarily wordy?
3. **Register** — Is the tone appropriate for a tech workplace (casual-professional)?
4. **Grammar** — Only flag if it causes ambiguity or sounds wrong
5. **Word choice** — Is there a more precise/common word?

### Coaching style:
- Be direct, not patronizing
- One-liner fixes when possible
- Explain the WHY only when non-obvious
- Praise when the expression is genuinely good
- When the user's English is already natural: "✅ Natural — no notes" and move on
- Use examples from real engineering communication (Slack, PRs, tech discussions)

### Do NOT:
- Over-correct casual/informal expressions that are perfectly fine in tech contexts
- Rewrite personality out of the user's voice
- Give grammar lectures — just show the fix
- Block task execution for language issues

---

## 4. God-View Integration — Mandatory Execution Discipline

After the translation or English check, the agent enters **pt-god-view mode**
for the task portion:

1. Classify intent.
2. Route exactly one owning workflow or specialist.
3. For non-trivial mutation, dispatch to `pt-dev-workflow`.
4. Stop applying God View logic after dispatch.

All rules from `pt-god-view` apply in full. This skill is an **overlay** — it adds language coaching on top of god-view, it does not weaken or bypass any methodology.

### Dispatch priority:
```
User message arrives
  → Chinese-to-English translation or English correction (§3)
  → God View route selection
  → Owning workflow or specialist
  → Task output in English by default
```

### Hard Gate: No Freestyle Execution

**When the user requests execution** ("做完", "execute", "继续", "land it", "并行做", etc.), the agent MUST NOT immediately write code. Instead:

1. **Identify the plan source**: Does an execution plan exist for this work? Check `docs/architecture/*/execution-plans/`.
2. **Check coverage**: Is the requested work already tracked as a workstream/phase in that plan?
3. **If tracked** → dispatch to `pt-dev-workflow`; its scheduler proposes work,
   its Guardian evaluates each action, and the workflow executes/persists.
4. **If NOT tracked but architecture exists** → route to
   `pt-architecture-execution-methodology`, then `pt-plan-and-document`; do not
   let the wrapper or Guardian self-amend a plan.
5. **If architecture is missing** → `EXECUTION_BLOCKED_BY_DESIGN` → stop and tell user.

Before running Acceptance, resolve the same formal plan and current closure:

```bash
python3 tooling/scripts/execution-plan.py
python3 tooling/scripts/acceptance-plan.py --active-plan
```

Report the exact Gate list, environment, and timeout budget before execution.
Plain `acceptance run` means the current closure of the current worktree's
formal plan. Never infer a second iteration or use the latest Acceptance
artifact as task state. `--full` is allowed only when the user explicitly asks
for release or full Acceptance.

**This gate is non-negotiable while pt-ew is active.** The only way to bypass it is for the user to explicitly say "skip the plan" / "不用走规划" / "just code it directly."

The agent must never interpret "do it fast" / "不要打扰我" / "直接做" as permission to skip the skill chain. Speed means "execute the chain faster," not "skip the chain."

---

## 5. Edge Cases

| Situation | Behavior |
|-----------|----------|
| User's English is perfect | "✅ Natural — no notes" → god-view execution |
| User mixes Chinese + English | Produce one complete natural English version; god-view applies |
| User writes only Chinese | Translate the full intent into natural English; god-view applies |
| User asks a pure language question | Give thorough language answer; no god-view needed |
| Ambiguous meaning due to English | Clarify meaning FIRST (in god-view uncertainty protocol style) |
| User says "continue" / "接着" in English | Coach + resume from active_work registry |

---

## 6. Session Continuity

When this skill is active:
- The agent remembers it's in "English workflow" mode for the whole session
- No need to re-invoke per message
- Chinese input does not deactivate the skill
- User can deactivate only by explicitly saying "stop English mode" or an
  equivalent instruction

---

## 7. Examples

### Example: Task with minor English fix

> User: "I want to deploy the station to check if the catalog search is work properly"

```
## 📝 English Check

**Your sentence**: "I want to deploy the station to check if the catalog search is work properly"

**Natural version**: "I want to deploy Station to check if catalog search is working properly"

**Notes**:
- "is work" → "is working" (present continuous for ongoing state)
- "the station" / "the catalog search" → drop "the" (these are proper nouns / features in our context)

**Rating**: ⭐⭐⭐⭐

---

**God-view**: Standalone task — deploy + verify. Dispatching to `pt-dev-runtime-handoff`.

<proceeds with make station deployment>
```

### Example: Already natural + god-view continuation

> User: "Let's pick up where we left off on the federation work"

```
## 📝 English Check

✅ Natural — no notes.

---

**God-view**: Tracked project resume. Reading active_work registry...

| # | Work | Stage | Step | Branch |
|---|------|-------|------|--------|
| 1 | WS-7 Catalog Scope | EXECUTE | Done | peers-group-chat |

Currently at: DELIVER stage (PR #63 created). Next: verify C7 acceptance gate.

Continue?
```
