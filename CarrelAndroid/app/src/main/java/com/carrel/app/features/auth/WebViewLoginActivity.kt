package com.carrel.app.features.auth

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.ui.theme.CarrelTheme

/**
 * WebView-based login activity that handles OAuth redirects internally.
 * This is more reliable than Custom Tabs in emulators.
 */
class WebViewLoginActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val provider = intent.getStringExtra(EXTRA_PROVIDER)
        val url = buildString {
            append("${ConvexClient.SITE_URL}/mobile-auth")
            if (provider != null) {
                append("?provider=$provider")
            }
        }

        setContent {
            CarrelTheme {
                WebViewLoginScreen(
                    url = url,
                    onTokenReceived = { token ->
                        Log.d(TAG, "Token received, returning to app")
                        val resultIntent = Intent().apply {
                            putExtra(EXTRA_TOKEN, token)
                        }
                        setResult(Activity.RESULT_OK, resultIntent)
                        finish()
                    },
                    onError = { error ->
                        Log.e(TAG, "Login error: $error")
                        val resultIntent = Intent().apply {
                            putExtra(EXTRA_ERROR, error)
                        }
                        setResult(Activity.RESULT_CANCELED, resultIntent)
                        finish()
                    },
                    onCancel = {
                        setResult(Activity.RESULT_CANCELED)
                        finish()
                    }
                )
            }
        }
    }

    companion object {
        private const val TAG = "WebViewLogin"
        const val EXTRA_PROVIDER = "provider"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_ERROR = "error"

        fun createIntent(context: Context, provider: String?): Intent {
            return Intent(context, WebViewLoginActivity::class.java).apply {
                putExtra(EXTRA_PROVIDER, provider)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun WebViewLoginScreen(
    url: String,
    onTokenReceived: (String) -> Unit,
    onError: (String) -> Unit,
    onCancel: () -> Unit
) {
    var isLoading by remember { mutableStateOf(true) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Sign In") },
                navigationIcon = {
                    IconButton(onClick = onCancel) {
                        Icon(Icons.Default.Close, contentDescription = "Cancel")
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            AndroidView(
                factory = { context ->
                    WebView(context).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true

                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(
                                view: WebView?,
                                request: WebResourceRequest?
                            ): Boolean {
                                val uri = request?.url ?: return false

                                // Intercept carrel:// callback
                                if (uri.scheme == "carrel" && uri.host == "auth") {
                                    val token = uri.getQueryParameter("token")
                                    val error = uri.getQueryParameter("error")

                                    when {
                                        token != null -> onTokenReceived(token)
                                        error != null -> onError(error)
                                        else -> onError("Unknown callback format")
                                    }
                                    return true
                                }

                                return false
                            }

                            override fun onPageFinished(view: WebView?, url: String?) {
                                super.onPageFinished(view, url)
                                isLoading = false
                            }
                        }

                        loadUrl(url)
                    }
                },
                modifier = Modifier.fillMaxSize()
            )

            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center)
                )
            }
        }
    }
}
