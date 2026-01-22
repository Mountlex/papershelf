package com.carrel.app.core.network

sealed class ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>()
    data class Error(val exception: ApiException) : ApiResult<Nothing>()

    inline fun <R> map(transform: (T) -> R): ApiResult<R> = when (this) {
        is Success -> Success(transform(data))
        is Error -> this
    }

    inline fun onSuccess(action: (T) -> Unit): ApiResult<T> {
        if (this is Success) action(data)
        return this
    }

    inline fun onError(action: (ApiException) -> Unit): ApiResult<T> {
        if (this is Error) action(exception)
        return this
    }

    fun getOrNull(): T? = (this as? Success)?.data

    fun getOrThrow(): T = when (this) {
        is Success -> data
        is Error -> throw exception
    }
}

sealed class ApiException(
    override val message: String,
    override val cause: Throwable? = null
) : Exception(message, cause) {

    data object Unauthorized : ApiException("You are not authorized. Please sign in again.")
    data object TokenExpired : ApiException("Session expired. Please sign in again.")
    data object NotFound : ApiException("Resource not found")
    data class BadRequest(override val message: String) : ApiException(message)
    data class ServerError(override val message: String) : ApiException(message)
    data class NetworkError(override val cause: Throwable) : ApiException("Network error: ${cause.message}", cause)
    data class Unknown(val code: Int, override val message: String) : ApiException("Error $code: $message")

    val isAuthError: Boolean
        get() = this is Unauthorized || this is TokenExpired
}
