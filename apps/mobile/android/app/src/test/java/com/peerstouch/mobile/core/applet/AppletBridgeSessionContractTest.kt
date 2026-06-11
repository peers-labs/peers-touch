package com.peerstouch.mobile.core.applet

import com.peerstouch.mobile.core.lynx.bridge.BridgeDispatcher
import com.peerstouch.mobile.core.lynx.bridge.BridgeModule
import com.peerstouch.mobile.core.lynx.bridge.BridgeResult
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AppletBridgeSessionContractTest {
    private class EchoBridgeModule : BridgeModule {
        override val moduleName = "storage"

        override suspend fun handle(method: String, params: Map<String, Any?>): Any? =
            mapOf("method" to method, "value" to params["value"])
    }

    private class ThrowingBridgeModule : BridgeModule {
        override val moduleName = "tasks"

        override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
            error("boom")
        }
    }

    @Test
    fun canonicalManifestParsesAndroidNativeApplet() {
        val result = AppletManifestParser.parse(canonicalManifestRaw(), "android-contract")
        val manifest = assertIs<ParseResult.Success<AppletManifest>>(result).value

        assertEquals("android-contract-applet", manifest.id)
        assertEquals(listOf("android"), manifest.targets)
        assertEquals("lynx-native", manifest.load.android?.type)
        assertEquals(AppletManifestParser.BRIDGE_PROTOCOL, manifest.bridge.protocol)
        assertTrue(manifest.permissions.contains("network.request"))
        assertTrue(manifest.services.any { service -> service.id == "primary-api" })
        assertTrue(manifest.integrity.files.containsKey("main.lynx.bundle"))
        assertTrue(manifest.integrity.files.containsKey("schemas/skill.input.json"))
    }

    @Test
    fun networkPermissionRequiresServiceDeclaration() {
        val raw = canonicalManifestRaw().toMutableMap()
        raw["services"] = emptyList<Map<String, Any?>>()

        val result = AppletManifestParser.parse(raw, "android-contract")

        val failure = assertIs<ParseResult.Failure>(result)
        assertTrue(
            failure.issues.any { issue ->
                issue.contains("network.request permission requires at least one service declaration")
            }
        )
    }

    @Test
    fun bridgeSessionEnforcesPermissionsAndCanonicalErrors() = runBlocking {
        val manifest = assertIs<ParseResult.Success<AppletManifest>>(
            AppletManifestParser.parse(canonicalManifestRaw(), "android-contract")
        ).value
        val dispatcher = BridgeDispatcher(setOf(EchoBridgeModule(), ThrowingBridgeModule()))
        val session = AppletBridgeSession(manifest, dispatcher)

        val allowed = assertIs<BridgeResult.Success>(
            session.dispatch("storage.get", mapOf("value" to "ok"))
        )
        val allowedData = assertIs<Map<*, *>>(allowed.data)
        assertEquals("get", allowedData["method"])
        assertEquals("ok", allowedData["value"])

        val denied = assertIs<BridgeResult.Error>(
            session.dispatch("navigation.back", emptyMap())
        )
        assertEquals("PERMISSION_DENIED", denied.code)

        val failed = assertIs<BridgeResult.Error>(
            session.dispatch("tasks.start", emptyMap())
        )
        assertEquals("CAPABILITY_FAILED", failed.code)

        val malformed = assertIs<BridgeResult.Error>(
            session.dispatch("malformed", emptyMap())
        )
        assertEquals("INVALID_PARAMS", malformed.code)

        session.transition(AppletState.UNLOADED)
        val unloaded = assertIs<BridgeResult.Error>(
            session.dispatch("storage.get", emptyMap())
        )
        assertEquals("INVALID_SESSION", unloaded.code)
    }

    private fun canonicalManifestRaw(): Map<String, Any?> = mapOf(
        "id" to "android-contract-applet",
        "name" to "Android Contract Applet",
        "version" to "1.0.0",
        "description" to "Android bridge/session contract fixture",
        "author" to "Peers Touch",
        "permissions" to listOf("network.request", "storage.get", "tasks.start"),
        "capabilities" to emptyList<String>(),
        "targets" to listOf("android"),
        "entries" to mapOf("lynx" to "main.lynx.bundle"),
        "load" to mapOf(
            "android" to mapOf(
                "type" to "lynx-native",
                "entry" to "main.lynx.bundle"
            )
        ),
        "bridge" to mapOf(
            "protocol" to AppletManifestParser.BRIDGE_PROTOCOL,
            "version" to "1.0.0"
        ),
        "services" to listOf(
            mapOf(
                "id" to "primary-api",
                "kind" to "http",
                "binding" to "host-resolved",
                "allowedMethods" to listOf("GET", "POST"),
                "allowedPaths" to listOf("/api/v1/e2e", "/api/v1/e2e/echo"),
                "streaming" to false
            )
        ),
        "skills" to listOf(
            mapOf(
                "id" to "android.echo",
                "inputSchema" to "schemas/skill.input.json",
                "streaming" to false
            )
        ),
        "integrity" to mapOf(
            "algorithm" to "sha256",
            "files" to mapOf(
                "main.lynx.bundle" to "sha256:bundle",
                "schemas/skill.input.json" to "sha256:schema"
            )
        )
    )
}
