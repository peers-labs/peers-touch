package com.peerstouch.mobile.core.lynx.bridge

import com.peerstouch.mobile.core.applet.AppletServiceDeclaration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

const val MANIFEST_SERVICES_PARAM = "__peersTouchManifestServices"

private fun stringMapParam(value: Any?): Map<String, String> {
    val raw = value as? Map<*, *> ?: return emptyMap()
    return raw.mapNotNull { (key, item) ->
        val stringKey = key as? String ?: return@mapNotNull null
        val stringValue = item as? String ?: return@mapNotNull null
        stringKey to stringValue
    }.toMap()
}

data class ResolvedAppletServiceRequest(
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val body: Any?
)

object AppletServiceRequestResolver {
    @Suppress("UNCHECKED_CAST")
    fun resolve(
        stationBaseUrl: String,
        params: Map<String, Any?>,
        services: List<AppletServiceDeclaration>
    ): ResolvedAppletServiceRequest {
        val serviceId = params["service"] as? String
            ?: throw IllegalArgumentException("service is required")
        val service = services.find { it.id == serviceId }
            ?: throw IllegalArgumentException("Service is not declared by applet manifest: $serviceId")
        if (service.binding != "station-resolved") {
            throw IllegalArgumentException("Mobile network.request supports station-resolved services only: $serviceId")
        }

        val method = (params["method"] as? String)?.uppercase() ?: "GET"
        if (method !in service.allowedMethods) {
            throw IllegalArgumentException("HTTP method is not allowed for service $serviceId: $method")
        }

        val path = params["path"] as? String
            ?: throw IllegalArgumentException("path is required")
        if (!isAllowedPath(path, service.allowedPaths)) {
            throw IllegalArgumentException("Path is not allowed for service $serviceId: $path")
        }

        val publicPathPrefix = service.publicPathPrefix
            ?: throw IllegalArgumentException("publicPathPrefix is required for service $serviceId")
        val stationPathPrefix = service.stationPathPrefix
            ?: throw IllegalArgumentException("stationPathPrefix is required for service $serviceId")
        val stationPath = rewriteStationPath(path, publicPathPrefix, stationPathPrefix)
        val urlBuilder = stationBaseUrl.toHttpUrl().newBuilder().encodedPath(stationPath)

        val query = params["query"] as? Map<String, Any?> ?: emptyMap()
        query.forEach { (key, value) ->
            if (value != null) urlBuilder.addQueryParameter(key, value.toString())
        }

        val headers = stringMapParam(params["headers"])
        return ResolvedAppletServiceRequest(
            url = urlBuilder.build().toString(),
            method = method,
            headers = headers,
            body = params["data"] ?: params["body"]
        )
    }

    private fun isAllowedPath(path: String, allowedPaths: List<String>): Boolean =
        allowedPaths.any { allowed ->
            path == allowed || (allowed.endsWith("/*") && path.startsWith(allowed.removeSuffix("/*") + "/"))
        }

    private fun rewriteStationPath(path: String, publicPathPrefix: String, stationPathPrefix: String): String {
        if (path == publicPathPrefix) return stationPathPrefix
        if (!path.startsWith("$publicPathPrefix/")) {
            throw IllegalArgumentException("Path must start with publicPathPrefix: $publicPathPrefix")
        }
        return stationPathPrefix + path.removePrefix(publicPathPrefix)
    }
}

class NetworkBridgeModule constructor(
    private val okHttpClient: OkHttpClient,
    private val stationBaseUrlProvider: () -> String? = { null }
) : BridgeModule {

    override val moduleName: String = "network"

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "request" -> request(params)
            "download" -> download(params)
            "upload" -> upload(params)
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun request(params: Map<String, Any?>): Map<String, Any?> {
        val serviceRequest = params["service"] as? String
        val manifestServices = params[MANIFEST_SERVICES_PARAM] as? List<AppletServiceDeclaration> ?: emptyList()
        val resolved = if (serviceRequest != null) {
            val stationBaseUrl = stationBaseUrlProvider()
                ?: throw IllegalStateException("Station base URL is required for applet service network requests")
            AppletServiceRequestResolver.resolve(stationBaseUrl, params, manifestServices)
        } else {
            ResolvedAppletServiceRequest(
                url = params["url"] as? String ?: throw IllegalArgumentException("url is required"),
                method = (params["method"] as? String)?.uppercase() ?: "GET",
                headers = stringMapParam(params["headers"]),
                body = params["data"]
            )
        }

        return withContext(Dispatchers.IO) {
            val requestBuilder = Request.Builder().url(resolved.url)
            resolved.headers.forEach { (key, value) -> requestBuilder.addHeader(key, value) }

            val requestBody = when (resolved.body) {
                is String -> resolved.body.toRequestBody("application/json".toMediaTypeOrNull())
                is Map<*, *> -> {
                    val json = org.json.JSONObject(resolved.body as Map<String, Any>).toString()
                    json.toRequestBody("application/json".toMediaTypeOrNull())
                }
                else -> null
            }

            when (resolved.method) {
                "GET" -> requestBuilder.get()
                "POST" -> requestBuilder.post(requestBody ?: "".toRequestBody(null))
                "PUT" -> requestBuilder.put(requestBody ?: "".toRequestBody(null))
                "DELETE" -> requestBuilder.delete(requestBody)
                "PATCH" -> requestBuilder.patch(requestBody ?: "".toRequestBody(null))
                else -> throw IllegalArgumentException("Unsupported HTTP method: ${resolved.method}")
            }

            val response = okHttpClient.newCall(requestBuilder.build()).execute()
            val responseBody = response.body?.string()
            val data: Any? = try {
                if (responseBody != null) org.json.JSONObject(responseBody) else null
            } catch (_: Exception) {
                responseBody
            }

            val responseHeaders = mutableMapOf<String, String>()
            response.headers.forEach { (name, value) -> responseHeaders[name] = value }

            mapOf(
                "data" to data,
                "status" to response.code,
                "headers" to responseHeaders
            )
        }
    }

    private suspend fun download(params: Map<String, Any?>): Map<String, Any?> {
        val url = params["url"] as? String ?: throw IllegalArgumentException("url is required")
        val headers = stringMapParam(params["headers"])
        val filePath = params["filePath"] as? String

        return withContext(Dispatchers.IO) {
            val requestBuilder = Request.Builder().url(url)
            headers.forEach { (key, value) -> requestBuilder.addHeader(key, value) }

            val response = okHttpClient.newCall(requestBuilder.build()).execute()
            val body = response.body ?: throw IllegalStateException("Empty response body")

            val destination = if (filePath != null) {
                File(filePath)
            } else {
                File.createTempFile("download_", "_${url.substringAfterLast("/")}")
            }

            destination.outputStream().use { output ->
                body.byteStream().copyTo(output)
            }

            mapOf(
                "filePath" to destination.absolutePath,
                "statusCode" to response.code,
                "fileSize" to destination.length()
            )
        }
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun upload(params: Map<String, Any?>): Map<String, Any?> {
        val url = params["url"] as? String ?: throw IllegalArgumentException("url is required")
        val filePath = params["filePath"] as? String ?: throw IllegalArgumentException("filePath is required")
        val name = params["name"] as? String ?: "file"
        val headers = stringMapParam(params["headers"])
        val formData = stringMapParam(params["formData"])

        return withContext(Dispatchers.IO) {
            val file = File(filePath)
            val multipartBuilder = MultipartBody.Builder().setType(MultipartBody.FORM)

            formData.forEach { (key, value) -> multipartBuilder.addFormDataPart(key, value) }
            multipartBuilder.addFormDataPart(
                name, file.name,
                file.asRequestBody("application/octet-stream".toMediaTypeOrNull())
            )

            val requestBuilder = Request.Builder().url(url).post(multipartBuilder.build())
            headers.forEach { (key, value) -> requestBuilder.addHeader(key, value) }

            val response = okHttpClient.newCall(requestBuilder.build()).execute()
            val responseBody = response.body?.string()
            val data: Any? = try {
                if (responseBody != null) org.json.JSONObject(responseBody) else null
            } catch (_: Exception) {
                responseBody
            }

            mapOf(
                "data" to data,
                "statusCode" to response.code
            )
        }
    }
}
