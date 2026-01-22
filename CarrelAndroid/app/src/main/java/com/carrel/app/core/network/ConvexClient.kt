package com.carrel.app.core.network

import com.carrel.app.core.auth.AuthManager
import com.carrel.app.core.network.models.*
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.android.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json

class ConvexClient(
    private val authManager: AuthManager
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val httpClient = HttpClient(Android) {
        install(ContentNegotiation) {
            json(json)
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 15_000
        }
    }

    // MARK: - Papers

    suspend fun papers(): ApiResult<List<Paper>> {
        val token = authManager.getValidToken() ?: return ApiResult.Error(ApiException.TokenExpired)
        return get("$BASE_URL/api/mobile/papers", token)
    }

    suspend fun paper(id: String): ApiResult<Paper> {
        val token = authManager.getValidToken() ?: return ApiResult.Error(ApiException.TokenExpired)
        return get("$BASE_URL/api/mobile/paper?id=$id", token)
    }

    suspend fun buildPaper(id: String, force: Boolean = false): ApiResult<SuccessResponse> {
        val token = authManager.getValidToken() ?: return ApiResult.Error(ApiException.TokenExpired)
        return post("$BASE_URL/api/mobile/paper/build", token, mapOf("paperId" to id, "force" to force))
    }

    suspend fun deletePaper(id: String): ApiResult<SuccessResponse> {
        val token = authManager.getValidToken() ?: return ApiResult.Error(ApiException.TokenExpired)
        return delete("$BASE_URL/api/mobile/paper", token, mapOf("paperId" to id))
    }

    suspend fun updatePaper(
        id: String,
        title: String? = null,
        authors: String? = null
    ): ApiResult<SuccessResponse> {
        val token = authManager.getValidToken() ?: return ApiResult.Error(ApiException.TokenExpired)
        val body = buildMap<String, Any> {
            put("paperId", id)
            title?.let { put("title", it) }
            authors?.let { put("authors", it) }
        }
        return patch("$BASE_URL/api/mobile/paper", token, body)
    }

    suspend fun togglePaperPublic(id: String): ApiResult<TogglePublicResponse> {
        val token = authManager.getValidToken() ?: return ApiResult.Error(ApiException.TokenExpired)
        return post("$BASE_URL/api/mobile/paper/toggle-public", token, mapOf("paperId" to id))
    }

    // MARK: - User

    suspend fun user(): ApiResult<User> {
        val token = authManager.getValidToken() ?: return ApiResult.Error(ApiException.TokenExpired)
        return get("$BASE_URL/api/mobile/user", token)
    }

    // MARK: - Auth (no auth required)

    suspend fun refreshToken(refreshToken: String): ApiResult<RefreshTokenResponse> {
        return post("$BASE_URL/api/mobile/refresh", null, mapOf("refreshToken" to refreshToken))
    }

    suspend fun revokeToken(refreshToken: String): ApiResult<SuccessResponse> {
        return post("$BASE_URL/api/mobile/revoke", null, mapOf("refreshToken" to refreshToken))
    }

    // MARK: - HTTP Methods

    private suspend inline fun <reified T> get(url: String, token: String?): ApiResult<T> {
        return try {
            val response = httpClient.get(url) {
                token?.let { header("Authorization", "Bearer $it") }
            }
            handleResponse(response)
        } catch (e: Exception) {
            ApiResult.Error(ApiException.NetworkError(e))
        }
    }

    private suspend inline fun <reified T> post(url: String, token: String?, body: Any?): ApiResult<T> {
        return try {
            val response = httpClient.post(url) {
                token?.let { header("Authorization", "Bearer $it") }
                body?.let {
                    contentType(ContentType.Application.Json)
                    setBody(it)
                }
            }
            handleResponse(response)
        } catch (e: Exception) {
            ApiResult.Error(ApiException.NetworkError(e))
        }
    }

    private suspend inline fun <reified T> patch(url: String, token: String?, body: Any?): ApiResult<T> {
        return try {
            val response = httpClient.patch(url) {
                token?.let { header("Authorization", "Bearer $it") }
                body?.let {
                    contentType(ContentType.Application.Json)
                    setBody(it)
                }
            }
            handleResponse(response)
        } catch (e: Exception) {
            ApiResult.Error(ApiException.NetworkError(e))
        }
    }

    private suspend inline fun <reified T> delete(url: String, token: String?, body: Any?): ApiResult<T> {
        return try {
            val response = httpClient.delete(url) {
                token?.let { header("Authorization", "Bearer $it") }
                body?.let {
                    contentType(ContentType.Application.Json)
                    setBody(it)
                }
            }
            handleResponse(response)
        } catch (e: Exception) {
            ApiResult.Error(ApiException.NetworkError(e))
        }
    }

    private suspend inline fun <reified T> handleResponse(response: HttpResponse): ApiResult<T> {
        return when (response.status.value) {
            in 200..299 -> {
                try {
                    ApiResult.Success(response.body())
                } catch (e: Exception) {
                    ApiResult.Error(ApiException.Unknown(response.status.value, "Failed to parse response"))
                }
            }
            401 -> {
                val errorBody = try {
                    response.body<ApiErrorResponse>()
                } catch (e: Exception) {
                    null
                }
                if (errorBody?.error?.contains("expired") == true) {
                    ApiResult.Error(ApiException.TokenExpired)
                } else {
                    ApiResult.Error(ApiException.Unauthorized)
                }
            }
            404 -> ApiResult.Error(ApiException.NotFound)
            400 -> {
                val message = try {
                    response.body<ApiErrorResponse>().error
                } catch (e: Exception) {
                    "Bad request"
                }
                ApiResult.Error(ApiException.BadRequest(message))
            }
            in 500..599 -> {
                val message = try {
                    response.body<ApiErrorResponse>().error
                } catch (e: Exception) {
                    "Server error"
                }
                ApiResult.Error(ApiException.ServerError(message))
            }
            else -> {
                val message = try {
                    response.body<ApiErrorResponse>().error
                } catch (e: Exception) {
                    "Unknown error"
                }
                ApiResult.Error(ApiException.Unknown(response.status.value, message))
            }
        }
    }

    companion object {
        // Update this to your Convex deployment URL
        const val BASE_URL = "https://earnest-eel-967.convex.site"
        const val SITE_URL = "https://carrel.app"
    }
}
