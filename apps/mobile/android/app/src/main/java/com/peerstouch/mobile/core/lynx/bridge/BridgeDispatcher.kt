package com.peerstouch.mobile.core.lynx.bridge

interface BridgeModule {
    val moduleName: String
    suspend fun handle(method: String, params: Map<String, Any?>): Any?
}

sealed class BridgeResult {
    data class Success(val data: Any?) : BridgeResult()
    data class Error(val code: String, val message: String) : BridgeResult()
}

enum class BridgeError(val code: String, val message: String) {
    MODULE_NOT_FOUND("BRIDGE_MODULE_NOT_FOUND", "Bridge module not found"),
    METHOD_NOT_FOUND("BRIDGE_METHOD_NOT_FOUND", "Bridge method not found"),
    INVALID_PARAMS("BRIDGE_INVALID_PARAMS", "Invalid bridge parameters"),
    EXECUTION_FAILED("BRIDGE_EXECUTION_FAILED", "Bridge execution failed")
}

class BridgeDispatcher constructor(
    modules: Set<@JvmSuppressWildcards BridgeModule>
) {
    private val moduleMap: Map<String, BridgeModule> = modules.associateBy { it.moduleName }

    suspend fun invoke(module: String, method: String, params: Map<String, Any?>): BridgeResult {
        val bridgeModule = moduleMap[module]
            ?: return BridgeResult.Error(
                BridgeError.MODULE_NOT_FOUND.code,
                "${BridgeError.MODULE_NOT_FOUND.message}: $module"
            )
        return try {
            val result = bridgeModule.handle(method, params)
            BridgeResult.Success(result)
        } catch (e: Exception) {
            BridgeResult.Error(
                BridgeError.EXECUTION_FAILED.code,
                "${BridgeError.EXECUTION_FAILED.message}: $module.$method - ${e.message}"
            )
        }
    }

    suspend fun invoke(api: String, params: Map<String, Any?>): BridgeResult {
        val components = api.split(".", limit = 2)
        if (components.size != 2) {
            return BridgeResult.Error(
                BridgeError.INVALID_PARAMS.code,
                "API format must be 'module.method', got: $api"
            )
        }
        return invoke(components[0], components[1], params)
    }

    fun hasModule(moduleName: String): Boolean = moduleMap.containsKey(moduleName)

    fun getRegisteredModules(): Set<String> = moduleMap.keys
}
