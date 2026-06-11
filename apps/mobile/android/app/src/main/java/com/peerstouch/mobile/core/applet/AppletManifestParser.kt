package com.peerstouch.mobile.core.applet

data class PlatformLoadConfig(
    val type: String,
    val entry: String
)

data class AppletLoadMap(
    val desktop: PlatformLoadConfig? = null,
    val android: PlatformLoadConfig? = null,
    val ios: PlatformLoadConfig? = null,
    val harmony: PlatformLoadConfig? = null,
    val web: PlatformLoadConfig? = null,
    val standalone: PlatformLoadConfig? = null
)

data class AppletBridgeConfig(
    val version: String? = null,
    val protocol: String
)

data class AppletEntryMap(
    val lynx: String,
    val standalone: String? = null
)

data class AppletServiceDeclaration(
    val id: String,
    val kind: String,
    val binding: String,
    val allowedMethods: List<String>,
    val allowedPaths: List<String>,
    val streaming: Boolean = false
)

data class AppletSkillDeclaration(
    val id: String,
    val inputSchema: String,
    val streaming: Boolean = false
)

data class PackageIntegrity(
    val algorithm: String,
    val files: Map<String, String>
)

data class AppletManifest(
    val id: String,
    val name: String?,
    val version: String,
    val description: String?,
    val author: String?,
    val icon: String?,
    val permissions: List<String>,
    val capabilities: List<String> = emptyList(),
    val minPlatformVersion: String? = null,
    val targets: List<String>,
    val targetPlatforms: List<String>? = null,
    val entries: AppletEntryMap,
    val load: AppletLoadMap,
    val bridge: AppletBridgeConfig,
    val services: List<AppletServiceDeclaration>,
    val skills: List<AppletSkillDeclaration>,
    val integrity: PackageIntegrity
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
    private val APPLET_ID_PATTERN = Regex("""^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$""")
    private val TARGET_PLATFORMS = setOf("desktop", "android", "ios", "harmony", "web", "standalone")
    private val LOAD_TYPES_BY_PLATFORM = mapOf(
        "desktop" to "lynx-web",
        "android" to "lynx-native",
        "ios" to "lynx-native",
        "harmony" to "lynx-native",
        "web" to "lynx-web",
        "standalone" to "web-spa"
    )
    private val SERVICE_BINDINGS = setOf("host-resolved", "station-resolved", "dev-override")

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

        val version = raw["version"] as? String
        if (version == null || !SEMVER_PATTERN.matches(version)) {
            issues.add("$source.version must be valid semver (e.g. 1.2.3)")
        }

        val description = raw["description"] as? String
        val author = raw["author"] as? String
        val icon = raw["icon"] as? String

        val permissions = raw["permissions"] as? List<*>
        val validPermissions = parseStringArray(permissions, "$source.permissions", issues, requireNonEmpty = true)

        val capabilities = parseStringArray(raw["capabilities"] as? List<*>, "$source.capabilities", issues, requireNonEmpty = false)

        val targetsRaw = (raw["targets"] ?: raw["targetPlatforms"]) as? List<*>
        val targets = parseStringArray(targetsRaw, "$source.targets", issues, requireNonEmpty = true)
            .filter { platform ->
                val valid = platform in TARGET_PLATFORMS
                if (!valid) issues.add("$source.targets contains invalid value: $platform")
                valid
            }
        val targetPlatforms = (raw["targetPlatforms"] as? List<*>)?.mapNotNull { it as? String }

        val entriesRaw = raw["entries"] as? Map<*, *>
        var entries: AppletEntryMap? = null
        if (entriesRaw == null) {
            issues.add("$source.entries must be an object")
        } else {
            val lynxEntry = entriesRaw["lynx"] as? String
            if (lynxEntry.isNullOrBlank()) issues.add("$source.entries.lynx must be a non-empty string")
            entries = AppletEntryMap(
                lynx = lynxEntry ?: "",
                standalone = entriesRaw["standalone"] as? String
            )
        }

        val minPlatformVersion = raw["minPlatformVersion"] as? String
        if (minPlatformVersion != null && !SEMVER_PATTERN.matches(minPlatformVersion)) {
            issues.add("$source.minPlatformVersion must be valid semver")
        }

        // Parse load as platform map
        val loadRaw = raw["load"] as? Map<*, *>
        var parsedLoadMap: AppletLoadMap? = null
        if (loadRaw == null) {
            issues.add("$source.load must be an object")
        } else {
            val platformConfigs = mutableMapOf<String, PlatformLoadConfig>()
            for (platform in targets) {
                val platformRaw = loadRaw[platform] as? Map<*, *>
                if (platformRaw == null) {
                    issues.add("$source.load.$platform must be an object for every target")
                    continue
                }
                val loadType = platformRaw["type"] as? String
                val expectedLoadType = LOAD_TYPES_BY_PLATFORM[platform]
                if (loadType != expectedLoadType) {
                    issues.add("$source.load.$platform.type must be $expectedLoadType")
                    continue
                }
                val loadEntry = platformRaw["entry"] as? String
                if (loadEntry.isNullOrBlank()) {
                    issues.add("$source.load.$platform.entry must be a non-empty string")
                    continue
                }
                platformConfigs[platform] = PlatformLoadConfig(type = loadType ?: "", entry = loadEntry)
            }

            parsedLoadMap = AppletLoadMap(
                desktop = platformConfigs["desktop"],
                android = platformConfigs["android"],
                ios = platformConfigs["ios"],
                harmony = platformConfigs["harmony"],
                web = platformConfigs["web"],
                standalone = platformConfigs["standalone"]
            )
        }

        // Parse bridge
        val bridge = raw["bridge"] as? Map<*, *>
        if (bridge == null) {
            issues.add("$source.bridge must be an object")
        } else {
            val bridgeVersion = bridge["version"] as? String
            if (bridgeVersion != null && !SEMVER_PATTERN.matches(bridgeVersion)) {
                issues.add("$source.bridge.version must be valid semver")
            }
            if (bridge["protocol"] != BRIDGE_PROTOCOL) {
                issues.add("$source.bridge.protocol must equal $BRIDGE_PROTOCOL")
            }
        }

        val services = parseServices(raw["services"] as? List<*>, source, issues)
        val skills = parseSkills(raw["skills"] as? List<*>, source, issues)
        val integrity = parseIntegrity(raw["integrity"] as? Map<*, *>, source, issues)

        if (validPermissions.contains("network.request") && services.isEmpty()) {
            issues.add("$source.network.request permission requires at least one service declaration")
        }
        if (entries?.lynx?.isNotBlank() == true && integrity?.files?.containsKey(entries.lynx) != true) {
            issues.add("$source.integrity.files must include entries.lynx")
        }
        skills.forEach { skill ->
            if (integrity?.files?.containsKey(skill.inputSchema) != true) {
                issues.add("$source.integrity.files must include skill input schema: ${skill.inputSchema}")
            }
        }

        if (issues.isNotEmpty()) {
            return ParseResult.Failure(issues)
        }

        return ParseResult.Success(
            AppletManifest(
                id = id!!,
                name = name,
                version = version!!,
                description = description,
                author = author,
                icon = icon,
                permissions = validPermissions,
                capabilities = capabilities,
                minPlatformVersion = minPlatformVersion,
                targets = targets,
                targetPlatforms = targetPlatforms,
                entries = entries!!,
                load = parsedLoadMap!!,
                bridge = AppletBridgeConfig(
                    version = bridge!!["version"] as? String,
                    protocol = BRIDGE_PROTOCOL
                ),
                services = services,
                skills = skills,
                integrity = integrity!!
            )
        )
    }

    private fun parseStringArray(raw: List<*>?, path: String, issues: MutableList<String>, requireNonEmpty: Boolean): List<String> {
        if (raw == null) {
            if (requireNonEmpty) issues.add("$path must be a non-empty string array")
            return emptyList()
        }
        if (requireNonEmpty && raw.isEmpty()) {
            issues.add("$path must be a non-empty string array")
        }
        return raw.mapIndexedNotNull { index, item ->
            val value = item as? String
            if (value.isNullOrBlank()) {
                issues.add("$path[$index] must be a non-empty string")
                null
            } else {
                value
            }
        }
    }

    private fun parseServices(raw: List<*>?, source: String, issues: MutableList<String>): List<AppletServiceDeclaration> {
        if (raw == null) {
            issues.add("$source.services must be an array")
            return emptyList()
        }
        return raw.mapIndexedNotNull { index, item ->
            val service = item as? Map<*, *>
            if (service == null) {
                issues.add("$source.services[$index] must be an object")
                return@mapIndexedNotNull null
            }
            val id = service["id"] as? String
            val kind = service["kind"] as? String
            val binding = service["binding"] as? String
            val allowedMethods = parseStringArray(service["allowedMethods"] as? List<*>, "$source.services[$index].allowedMethods", issues, requireNonEmpty = true)
            val allowedPaths = parseStringArray(service["allowedPaths"] as? List<*>, "$source.services[$index].allowedPaths", issues, requireNonEmpty = true)
            if (id.isNullOrBlank()) issues.add("$source.services[$index].id must be a non-empty string")
            if (kind != "http") issues.add("$source.services[$index].kind must be http")
            if (binding == null || binding !in SERVICE_BINDINGS) issues.add("$source.services[$index].binding must be one of $SERVICE_BINDINGS")
            AppletServiceDeclaration(
                id = id ?: "",
                kind = kind ?: "",
                binding = binding ?: "",
                allowedMethods = allowedMethods,
                allowedPaths = allowedPaths,
                streaming = service["streaming"] == true
            )
        }
    }

    private fun parseSkills(raw: List<*>?, source: String, issues: MutableList<String>): List<AppletSkillDeclaration> {
        if (raw == null) {
            issues.add("$source.skills must be an array")
            return emptyList()
        }
        return raw.mapIndexedNotNull { index, item ->
            val skill = item as? Map<*, *>
            if (skill == null) {
                issues.add("$source.skills[$index] must be an object")
                return@mapIndexedNotNull null
            }
            val id = skill["id"] as? String
            val inputSchema = skill["inputSchema"] as? String
            if (id.isNullOrBlank()) issues.add("$source.skills[$index].id must be a non-empty string")
            if (inputSchema.isNullOrBlank()) issues.add("$source.skills[$index].inputSchema must be a non-empty string")
            AppletSkillDeclaration(
                id = id ?: "",
                inputSchema = inputSchema ?: "",
                streaming = skill["streaming"] == true
            )
        }
    }

    private fun parseIntegrity(raw: Map<*, *>?, source: String, issues: MutableList<String>): PackageIntegrity? {
        if (raw == null) {
            issues.add("$source.integrity must be an object")
            return null
        }
        val algorithm = raw["algorithm"] as? String
        if (algorithm != "sha256") issues.add("$source.integrity.algorithm must be sha256")
        val filesRaw = raw["files"] as? Map<*, *>
        if (filesRaw == null || filesRaw.isEmpty()) {
            issues.add("$source.integrity.files must be a non-empty object")
            return PackageIntegrity(algorithm = algorithm ?: "", files = emptyMap())
        }
        val files = mutableMapOf<String, String>()
        filesRaw.forEach { (file, hash) ->
            if (file !is String || file.isBlank() || hash !is String || hash.isBlank()) {
                issues.add("$source.integrity.files entries must be non-empty strings")
            } else {
                files[file] = hash
            }
        }
        return PackageIntegrity(algorithm = algorithm ?: "", files = files)
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
