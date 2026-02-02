package com.carrel.app.features.paper

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.ConvexService
import com.carrel.app.ui.components.StatusBadge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URL

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaperDetailScreen(
    paperId: String,
    convexClient: ConvexClient,
    convexService: ConvexService? = null,
    onBackClick: () -> Unit
) {
    val viewModel = remember { PaperViewModel(paperId, convexClient, convexService) }
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    var showMenu by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(uiState.paper?.title ?: "Paper") },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    // Share button
                    uiState.paper?.pdfUrl?.let { pdfUrl ->
                        IconButton(
                            onClick = {
                                val intent = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, pdfUrl)
                                }
                                context.startActivity(Intent.createChooser(intent, "Share PDF"))
                            }
                        ) {
                            Icon(Icons.Default.Share, contentDescription = "Share")
                        }
                    }

                    // Menu
                    Box {
                        IconButton(onClick = { showMenu = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "More options")
                        }

                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("Sync") },
                                onClick = {
                                    showMenu = false
                                    viewModel.build()
                                },
                                leadingIcon = { Icon(Icons.Default.Refresh, contentDescription = null) }
                            )
                            DropdownMenuItem(
                                text = { Text("Force Rebuild") },
                                onClick = {
                                    showMenu = false
                                    viewModel.build(force = true)
                                },
                                leadingIcon = { Icon(Icons.Default.Build, contentDescription = null) }
                            )
                        }
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
            when {
                uiState.isLoading && uiState.paper == null -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                uiState.paper != null -> {
                    Column(modifier = Modifier.fillMaxSize()) {
                        // PDF Viewer
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth()
                        ) {
                            uiState.paper?.pdfUrl?.let { url ->
                                PdfViewer(
                                    pdfUrl = url,
                                    modifier = Modifier.fillMaxSize()
                                )
                            } ?: run {
                                NoPdfPlaceholder(
                                    onBuildClick = { viewModel.build() },
                                    modifier = Modifier.align(Alignment.Center)
                                )
                            }
                        }

                        // Info panel
                        PaperInfoPanel(
                            paper = uiState.paper!!,
                            isBuilding = uiState.isBuilding,
                            isTogglingPublic = uiState.isTogglingPublic,
                            onTogglePublic = { viewModel.togglePublic() }
                        )
                    }
                }
                uiState.error != null -> {
                    Column(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = uiState.error ?: "An error occurred",
                            color = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = { viewModel.loadPaper() }) {
                            Text("Retry")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NoPdfPlaceholder(
    onBuildClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.InsertDriveFile,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "No PDF available",
            style = MaterialTheme.typography.titleMedium
        )
        Spacer(modifier = Modifier.height(8.dp))
        Button(onClick = onBuildClick) {
            Text("Build PDF")
        }
    }
}

@Composable
private fun PaperInfoPanel(
    paper: com.carrel.app.core.network.models.Paper,
    isBuilding: Boolean,
    isTogglingPublic: Boolean,
    onTogglePublic: () -> Unit
) {
    Surface(
        tonalElevation = 2.dp
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = paper.title ?: "Untitled",
                        style = MaterialTheme.typography.titleMedium
                    )
                    if (!paper.authors.isNullOrBlank()) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = paper.authors,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                StatusBadge(status = paper.status)
            }

            Spacer(modifier = Modifier.height(12.dp))

            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Public/Private toggle
                FilledTonalButton(
                    onClick = onTogglePublic,
                    enabled = !isTogglingPublic
                ) {
                    if (isTogglingPublic) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = if (paper.isPublic) Icons.Filled.Public else Icons.Default.Lock,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(if (paper.isPublic) "Public" else "Private")
                }

                if (isBuilding || paper.compilationProgress != null) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = paper.compilationProgress ?: "Building...",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                paper.lastSyncError?.let { error ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (error.length > 50) error.take(50) + "..." else error,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            maxLines = 1
                        )
                    }
                }

                Spacer(modifier = Modifier.weight(1f))

                paper.lastSyncedAt?.let { timestamp ->
                    val timeAgo = remember(timestamp) {
                        formatTimeAgo(timestamp)
                    }
                    Text(
                        text = "Synced $timeAgo",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun PdfViewer(
    pdfUrl: String,
    modifier: Modifier = Modifier
) {
    var pageBitmaps by remember { mutableStateOf<List<Bitmap>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var pageCount by remember { mutableIntStateOf(0) }
    val context = LocalContext.current

    LaunchedEffect(pdfUrl) {
        isLoading = true
        error = null
        pageBitmaps = emptyList()
        try {
            val bitmaps = withContext(Dispatchers.IO) {
                // Download PDF to temp file
                val tempFile = File.createTempFile("pdf", ".pdf", context.cacheDir)
                URL(pdfUrl).openStream().use { input ->
                    tempFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }

                // Open PDF renderer
                val fileDescriptor = ParcelFileDescriptor.open(
                    tempFile,
                    ParcelFileDescriptor.MODE_READ_ONLY
                )
                val renderer = PdfRenderer(fileDescriptor)
                pageCount = renderer.pageCount

                // Render all pages
                val result = mutableListOf<Bitmap>()
                for (i in 0 until renderer.pageCount) {
                    val page = renderer.openPage(i)
                    val bmp = Bitmap.createBitmap(
                        page.width * 2,
                        page.height * 2,
                        Bitmap.Config.ARGB_8888
                    )
                    bmp.eraseColor(android.graphics.Color.WHITE)
                    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    result.add(bmp)
                    page.close()
                }

                renderer.close()
                fileDescriptor.close()
                tempFile.delete()

                result
            }
            pageBitmaps = bitmaps
        } catch (e: Exception) {
            error = e.message
        }
        isLoading = false
    }

    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        when {
            isLoading -> {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Loading PDF...", style = MaterialTheme.typography.bodySmall)
                }
            }
            error != null -> {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Failed to load PDF")
                    Text(
                        text = error ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
            pageBitmaps.isNotEmpty() -> {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(8.dp)
                ) {
                    itemsIndexed(pageBitmaps) { index, bitmap ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                        ) {
                            Column {
                                Image(
                                    bitmap = bitmap.asImageBitmap(),
                                    contentDescription = "Page ${index + 1}",
                                    modifier = Modifier.fillMaxWidth(),
                                    contentScale = ContentScale.FillWidth
                                )
                                Text(
                                    text = "Page ${index + 1} of $pageCount",
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .background(MaterialTheme.colorScheme.surfaceVariant)
                                        .padding(4.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    textAlign = TextAlign.Center,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun formatTimeAgo(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> "just now"
        diff < 3600_000 -> "${diff / 60_000}m ago"
        diff < 86400_000 -> "${diff / 3600_000}h ago"
        diff < 604800_000 -> "${diff / 86400_000}d ago"
        else -> "${diff / 604800_000}w ago"
    }
}
