package com.peerstouch.mobile.core.applet

data class PlatformLoadConfig(
    val type: String,
    val entry: String
)

data class AppletLoadMap(
    val desktop: PlatformLoadConfig? = null,
    val android: PlatformLoadConfig? = null,
    val ios: PlatformLoadConfig? = null,
    val standalone: PlatformLoadConfig? = null
)

data class AppletBridgeConfig(
    val version: String,
    val protocol: String
)

data class AppletManifest(
    val id: String,
    val name: String,
    val version: String,
    val description: String,
    val author: String,
    val icon: String?,
    val permissions: List<String>,
    val capabilities: List<String> = emptyList(),
    val minPlatformVersion: String? = null,
    val targetPlatforms: List<String>? = null,
    val load: AppletLoadMap,
    val bridge: AppletBridgeConfig
)

data class AppletInfo(
    val manifest: AppletManifest,
    val main: String,
    val path: String
)

sealed class ParseResult<out T> {
    data class Success<T>(val value: T) : ParseResult<T>()
    data class Failure(val issues: List<String>) : ParseResult<Nothing>()
}

object AppletManifestParser {

    const val BRIDGE_PROTOCOL = "peers-touch.applet.bridge"

    private val SEMVER_PATTERN = Regex("""^\d+\.\d+\.\d+(?:-[0-9A-Za-z\-.]+)?(?:\+[0-9A-Za-z\-.]+)?$""")
    private val APPLET_ID_PATTERN = Regex("""^[a-z0-9][a-z0-9-]*$""")
    private val TARGET_PLATFORMS = setOf("desktop", "android", "ios", "standalone")
    private val LOAD_TYPES = setOf("lynx-native", "lynx-web", "web-spa")

    @Suppress("UNCHECKED_CAST")
    fun parse(raw: Map<String, Any?>, source: String): ParseResult<AppletManifest> {
        val issues = mutableListOf<String>()

        val id = raw["id"] as? String
        if (id.isNullOrBlank()) {
            issues.add("$source.id must be a non-empty string")
        } else if (!APPLET_ID_PATTERN.matches(id)) {
            issues.add("$source.id format is invalid, must match $APPLET_ID_PATTERN")
        }

        val name = raw["name"] as? String
        if (name.isNullOrBlank()) issues.add("$source.name must be a non-empty string")

        val version = raw["version"] as? String
        if (version == null || !SEMVER_PATTERN.matches(version)) {
            issues.add("$source.version must be valid semver (e.g. 1.2.3)")
        }

        val description = raw["description"] as? String
        if (description.isNullOrBlank()) issues.add("$source.description must be a non-empty string")

        val author = raw["author"] as? String
        if (author.isNullOrBlank()) issues.add("$source.author must be a non-empty string")

        val icon = raw["icon"] as? String

        val permissions = raw["permissions"] as? List<*>
        if (permissions == null) {
            issues.add("$source.permissions must be a string array")
        } else {
            permissions.forEachIndexed { index, item ->
                if (item !is String || item.isBlank()) {
                    issues.add("$source.permissions[$index] must be a non-empty string")
                }
            }
        }

        val capabilities = (raw["capabilities"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()

        val minPlatformVersion = raw["minPlatformVersion"] as? String
        if (minPlatformVersion != null && !SEMVER_PATTERN.matches(minPlatformVersion)) {
            issues.add("$source.minPlatformVersion must be valid semver")
        }

        val targetPlatforms = raw["targetPlatforms"] as? List<*>
        val validTargetPlatforms = targetPlatforms?.mapNotNull { platform ->
            val str = platform as? String
            if (str != null && str in TARGET_PLATFORMS) str
            else {
                issues.add("$source.targetPlatforms contains invalid value: $platform")
                null
            }
        }

        // Parse load as platform map
        val loadRaw = raw["load"] as? Map<*, *>
        var parsedLoadMap: AppletLoadMap? = null
        if (loadRaw == null) {
            issues.add("$source.load must be an object")
        } else {
            val platformConfigs = mutableMapOf<String, PlatformLoadConfig>()
            for (platform in TARGET_PLATFORMS) {
                val platformRaw = loadRaw[platform] as? Map<*, *> ?: continue
                val loadType = platformRaw["type"] as? String
                if (loadType == null || loadType !in LOAD_TYPES) {
                    issues.add("$source.load.$platform.type must be one of $LOAD_TYPES")
                    continue
                }
                val loadEntry = platformRaw["entry"] as? String
                if (loadEntry.isNullOrBlank()) {
                    issues.add("$source.load.$platform.entry must be a non-empty string")
                    continue
                }
                platformConfigs[platform] = PlatformLoadConfig(type = loadType, entry = loadEntry)
            }

            if (!platformConfigs.containsKey("android")) {
                issues.add("$source.load must contain an \"android\" platform config")
            }

            parsedLoadMap = AppletLoadMap(
                desktop = platformConfigs["desktop"],
                android = platformConfigs["android"],
                ios = platformConfigs["ios"],
                standalone = platformConfigs["standalone"]
            )
        }

        // Parse bridge
        val bridge = raw["bridge"] as? Map<*, *>
        if (bridge == null) {
            issues.add("$source.bridge must be an object")
        } else {
            val bridgeVersion = bridge["version"] as? String
            if (bridgeVersion == null || !SEMVER_PATTERN.matches(bridgeVersion)) {
                issues.add("$source.bridge.version must be valid semver")
            }
            if (bridge["protocol"] != BRIDGE_PROTOCOL) {
                issues.add("$source.bridge.protocol must equal $BRIDGE_PROTOCOL")
            }
        }

        if (issues.isNotEmpty()) {
            return ParseResult.Failure(issues)
        }

        return ParseResult.Success(
            AppletManifest(
                id = id!!,
                name = name!!,
                version = version!!,
                description = description!!,
                author = author!!,
                icon = icon,
                permissions = permissions!!.map { it as String },
                capabilities = capabilities,
                minPlatformVersion = minPlatformVersion,
                targetPlatforms = validTargetPlatforms,
                load = parsedLoadMap!!,
                bridge = AppletBridgeConfig(
                    version = bridge!!["version"] as String,
                    protocol = BRIDGE_PROTOCOL
                )
            )
        )
    }

    fun compareSemver(left: String, right: String): Int {
        fun normalize(value: String): Triple<Int, Int, Int> {
            val version = value.split("-")[0]
            val parts = version.split(".").map { it.toIntOrNull() ?: 0 }
            return Triple(
                parts.getOrElse(0) { 0 },
                parts.getOrElse(1) { 0 },
                parts.getOrElse(2) { 0 }
            )
        }
        val l = normalize(left)
        val r = normalize(right)
        if (l.first != r.first) return l.first - r.first
        if (l.second != r.second) return l.second - r.second
        return l.third - r.third
    }
}
