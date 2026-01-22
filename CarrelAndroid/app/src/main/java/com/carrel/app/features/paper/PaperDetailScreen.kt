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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.carrel.app.core.network.ConvexClient
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
    onBackClick: () -> Unit
) {
    val viewModel = remember { PaperViewModel(paperId, convexClient) }
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    var showEditDialog by remember { mutableStateOf(false) }
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
                                text = { Text("Edit Details") },
                                onClick = {
                                    showMenu = false
                                    showEditDialog = true
                                },
                                leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) }
                            )
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

    // Edit dialog
    if (showEditDialog) {
        EditPaperDialog(
            title = uiState.paper?.title ?: "",
            authors = uiState.paper?.authors ?: "",
            onDismiss = { showEditDialog = false },
            onSave = { title, authors ->
                viewModel.updateMetadata(title, authors)
                showEditDialog = false
            }
        )
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
            imageVector = Icons.Default.Description,
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
                            imageVector = if (paper.isPublic) Icons.Default.Public else Icons.Default.Lock,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(if (paper.isPublic) "Public" else "Private")
                }

                if (isBuilding) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Building...",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
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
private fun EditPaperDialog(
    title: String,
    authors: String,
    onDismiss: () -> Unit,
    onSave: (String?, String?) -> Unit
) {
    var editedTitle by remember { mutableStateOf(title) }
    var editedAuthors by remember { mutableStateOf(authors) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit Paper") },
        text = {
            Column {
                OutlinedTextField(
                    value = editedTitle,
                    onValueChange = { editedTitle = it },
                    label = { Text("Title") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(16.dp))
                OutlinedTextField(
                    value = editedAuthors,
                    onValueChange = { editedAuthors = it },
                    label = { Text("Authors") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onSave(
                        editedTitle.takeIf { it.isNotBlank() },
                        editedAuthors.takeIf { it.isNotBlank() }
                    )
                }
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

@Composable
private fun PdfViewer(
    pdfUrl: String,
    modifier: Modifier = Modifier
) {
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current

    LaunchedEffect(pdfUrl) {
        isLoading = true
        error = null
        try {
            bitmap = withContext(Dispatchers.IO) {
                // Download PDF to temp file
                val tempFile = File.createTempFile("pdf", ".pdf", context.cacheDir)
                URL(pdfUrl).openStream().use { input ->
                    tempFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }

                // Render first page
                val fileDescriptor = ParcelFileDescriptor.open(
                    tempFile,
                    ParcelFileDescriptor.MODE_READ_ONLY
                )
                val renderer = PdfRenderer(fileDescriptor)
                val page = renderer.openPage(0)

                val bmp = Bitmap.createBitmap(
                    page.width * 2,
                    page.height * 2,
                    Bitmap.Config.ARGB_8888
                )
                page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)

                page.close()
                renderer.close()
                fileDescriptor.close()
                tempFile.delete()

                bmp
            }
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
                CircularProgressIndicator()
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
            bitmap != null -> {
                Image(
                    bitmap = bitmap!!.asImageBitmap(),
                    contentDescription = "PDF preview",
                    modifier = Modifier.fillMaxSize()
                )
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
