package com.peerstouch.mobile.core.applet.kernel

import com.peerstouch.mobile.core.applet.AppletBridgeConfig
import com.peerstouch.mobile.core.applet.AppletEntryMap
import com.peerstouch.mobile.core.applet.AppletLifecycleEvent
import com.peerstouch.mobile.core.applet.AppletLoadMap
import com.peerstouch.mobile.core.applet.AppletManifest
import com.peerstouch.mobile.core.applet.AppletState
import com.peerstouch.mobile.core.applet.PackageIntegrity
import com.peerstouch.mobile.core.applet.PlatformLoadConfig
import com.peerstouch.mobile.core.applet.nextState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AppletKernelPolicyTest {
    private class RecordingSurfaceController : AppletSurfaceController {
        val commands = mutableListOf<Pair<SurfaceCommand, String>>()

        override fun applySurfaceCommand(command: SurfaceCommand, target: AppletLifecycleTarget) {
            commands += command to target.appletId
        }
    }

    private data class Harness(
        val kernel: AppletKernel,
        val surfaceController: RecordingSurfaceController,
        val sessionStates: MutableMap<String, AppletState>,
        val clock: TestClock
    )

    private class TestClock(var nowMs: Long)

    @Test
    fun lruSuspendsOldestHiddenWarmInstanceWhenMobileLimitIsExceeded() {
        val harness = createHarness()
        listOf("a", "b", "c", "d").forEach { appletId ->
            harness.launchVisible(appletId)
            harness.clock.nowMs += 10L
            harness.kernel.dispatchApplet(appletId, AppletLifecycleEvent.HIDE, "test-hide")
        }

        assertEquals(AppletState.SUSPENDED, harness.sessionStates.getValue("a"))
        assertEquals(AppletState.HIDDEN_WARM, harness.sessionStates.getValue("b"))
        assertEquals(AppletState.HIDDEN_WARM, harness.sessionStates.getValue("c"))
        assertEquals(AppletState.HIDDEN_WARM, harness.sessionStates.getValue("d"))
        assertTrue(harness.surfaceController.commands.contains(SurfaceCommand.DETACH to "a"))
    }

    @Test
    fun sweepAppliesHiddenWarmAndSuspendedTtlPolicies() {
        val harness = createHarness()
        harness.launchVisible("ttl")
        harness.kernel.dispatchApplet("ttl", AppletLifecycleEvent.HIDE, "test-hide")

        harness.clock.nowMs += AppletResourcePolicy.MOBILE.hiddenWarmTtlMs
        harness.kernel.sweep()
        assertEquals(AppletState.SUSPENDED, harness.sessionStates.getValue("ttl"))
        assertTrue(harness.surfaceController.commands.contains(SurfaceCommand.DETACH to "ttl"))

        harness.clock.nowMs += AppletResourcePolicy.MOBILE.suspendedTtlMs
        harness.kernel.sweep()
        assertTrue("ttl" !in harness.sessionStates)
        assertTrue(harness.surfaceController.commands.contains(SurfaceCommand.DESTROY to "ttl"))
    }

    @Test
    fun memoryPressureDestroysOnlyPolicySelectedInstances() {
        val harness = createHarness()
        harness.launchVisible("visible")
        harness.launchVisible("suspended")
        harness.kernel.dispatchApplet("suspended", AppletLifecycleEvent.HIDE, "test-hide")
        harness.kernel.dispatchApplet("suspended", AppletLifecycleEvent.SUSPEND, "test-suspend")

        harness.kernel.handleMemoryPressure(MemoryPressureLevel.MODERATE)
        assertEquals(AppletState.VISIBLE, harness.sessionStates.getValue("visible"))
        assertTrue("suspended" !in harness.sessionStates)

        harness.launchVisible("hidden")
        harness.kernel.dispatchApplet("hidden", AppletLifecycleEvent.HIDE, "test-hide")
        harness.kernel.handleMemoryPressure(MemoryPressureLevel.CRITICAL)
        assertEquals(AppletState.VISIBLE, harness.sessionStates.getValue("visible"))
        assertTrue("hidden" !in harness.sessionStates)
    }

    private fun createHarness(): Harness {
        val clock = TestClock(1_000L)
        val registry = AppletInstanceRegistry()
        val surfaceController = RecordingSurfaceController()
        val sessionStates = mutableMapOf<String, AppletState>()
        val orchestrator = AppletLifecycleOrchestrator(
            registry = registry,
            surfaceController = surfaceController,
            sessionLifecycleDispatcher = { appletId, event, resumeTarget ->
                sessionStates[appletId] = sessionStates.getValue(appletId).nextState(event, resumeTarget)
            },
            sessionDestroyer = { appletId ->
                sessionStates.remove(appletId)
            }
        )
        val kernel = AppletKernel(
            registry = registry,
            orchestrator = orchestrator,
            scheduler = AppletResourceScheduler(registry),
            clock = { clock.nowMs }
        )
        return Harness(kernel, surfaceController, sessionStates, clock)
    }

    private fun Harness.launchVisible(appletId: String) {
        val manifest = manifest(appletId)
        sessionStates[appletId] = AppletState.MATERIALIZING
        val target = kernel.registerMaterializing(
            manifest = manifest,
            instanceId = appletId,
            sessionId = "android:$appletId:${clock.nowMs}"
        )
        kernel.dispatch(target, AppletLifecycleEvent.READY, "test-ready")
    }

    private fun manifest(appletId: String): AppletManifest =
        AppletManifest(
            id = appletId,
            name = appletId,
            version = "1.0.0",
            description = null,
            author = null,
            icon = null,
            permissions = emptyList(),
            targets = listOf("android"),
            entries = AppletEntryMap(lynx = "main.lynx.bundle"),
            load = AppletLoadMap(android = PlatformLoadConfig(type = "lynx-native", entry = "main.lynx.bundle")),
            bridge = AppletBridgeConfig(protocol = "peers-touch.applet.bridge", version = "1.0.0"),
            services = emptyList(),
            skills = emptyList(),
            integrity = PackageIntegrity(algorithm = "sha256", files = mapOf("main.lynx.bundle" to "sha256:test"))
        )
}
