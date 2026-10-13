// profile_change_hook.go — seam between the frame actor write path and the
// application-layer realtime event bus.
//
// The frame layer must not import app/subserver/events (that would invert the
// dependency direction). Instead it exposes a tiny observer: the events
// subserver registers one callback at boot, and the human-driven profile write
// path (updateProfileInternal) invokes it post-commit so the actor's own
// authenticated devices receive an ActorProfileChanged wake and refetch the
// authoritative profile.
//
// Contract:
//   - Hooks run asynchronously in their own goroutine; they must never block
//     the committing HTTP handler.
//   - Hooks are best-effort projections, exactly like the federation locator
//     publisher. Failures are logged inside the application hook; the local
//     actor row is already the durable source of truth.
//   - The actor PTID handed to the hook is always the changed actor itself;
//     human profile edits target the JWT subject, so publishing to that PTID
//     reaches that actor's own device streams. Bot avatar changes (whose
//     recipient is the owning human) are published separately by the bot
//     registry and do not use this hook.

package actor

import "sync"

var (
	profileChangedHooksMu sync.RWMutex
	profileChangedHooks   []func(actorPtid string, changedAtUnixMs int64)
)

// RegisterProfileChangedHook installs an application-layer observer invoked
// after a local human actor's profile mutation commits. Register once during
// Station boot. It is not safe to register after the station has started
// serving in production.
func RegisterProfileChangedHook(hook func(actorPtid string, changedAtUnixMs int64)) {
	if hook == nil {
		return
	}
	profileChangedHooksMu.Lock()
	defer profileChangedHooksMu.Unlock()
	profileChangedHooks = append(profileChangedHooks, hook)
}

// notifyProfileChanged fans the post-commit wake to every registered hook in
// an isolated goroutine so a slow observer cannot stall the writer.
func notifyProfileChanged(actorPtid string, changedAtUnixMs int64) {
	if actorPtid == "" {
		return
	}
	profileChangedHooksMu.RLock()
	hooks := make([]func(string, int64), len(profileChangedHooks))
	copy(hooks, profileChangedHooks)
	profileChangedHooksMu.RUnlock()
	for _, hook := range hooks {
		h := hook
		go h(actorPtid, changedAtUnixMs)
	}
}
