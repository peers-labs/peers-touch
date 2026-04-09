package com.peerstouch.mobile.core.lynx.bridge

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

class NetworkBridgeModule constructor(
    private val okHttpClient: OkHttpClient
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
        val url = params["url"] as? String ?: throw IllegalArgumentException("url is required")
        val method = (params["method"] as? String)?.uppercase() ?: "GET"
        val headers = params["headers"] as? Map<String, String> ?: emptyMap()
        val body = params["data"]

        return withContext(Dispatchers.IO) {
            val requestBuilder = Request.Builder().url(url)
            headers.forEach { (key, value) -> requestBuilder.addHeader(key, value) }

            val requestBody = when (body) {
                is String -> body.toRequestBody("application/json".toMediaTypeOrNull())
                is Map<*, *> -> {
                    val json = org.json.JSONObject(body as Map<String, Any>).toString()
                    json.toRequestBody("application/json".toMediaTypeOrNull())
                }
                else -> null
            }

            when (method) {
                "GET" -> requestBuilder.get()
                "POST" -> requestBuilder.post(requestBody ?: "".toRequestBody(null))
                "PUT" -> requestBuilder.put(requestBody ?: "".toRequestBody(null))
                "DELETE" -> requestBuilder.delete(requestBody)
                "PATCH" -> requestBuilder.patch(requestBody ?: "".toRequestBody(null))
                else -> throw IllegalArgumentException("Unsupported HTTP method: $method")
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
        val headers = params["headers"] as? Map<String, String> ?: emptyMap()
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
        val headers = params["headers"] as? Map<String, String> ?: emptyMap()
        val formData = params["formData"] as? Map<String, String> ?: emptyMap()

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
