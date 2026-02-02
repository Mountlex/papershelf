package com.carrel.app.features.repositories

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.TextSnippet
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.models.Repository
import com.carrel.app.core.network.models.RepositoryFile

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddPaperFromRepoScreen(
    repository: Repository,
    convexClient: ConvexClient,
    onBackClick: () -> Unit,
    onPaperAdded: () -> Unit
) {
    val viewModel = remember { AddPaperFromRepoViewModel(repository, convexClient) }
    val uiState by viewModel.uiState.collectAsState()

    var selectedFilePath by remember { mutableStateOf<String?>(null) }

    // Load files when screen appears
    LaunchedEffect(Unit) {
        viewModel.loadFiles()
    }

    // Bottom sheet for configuring paper
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    if (selectedFilePath != null) {
        ModalBottomSheet(
            onDismissRequest = { selectedFilePath = null },
            sheetState = sheetState
        ) {
            ConfigurePaperSheet(
                repository = repository,
                filePath = selectedFilePath!!,
                convexClient = convexClient,
                onDismiss = { selectedFilePath = null },
                onSuccess = {
                    selectedFilePath = null
                    onPaperAdded()
                }
            )
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Add Paper") },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Breadcrumb navigation
            BreadcrumbNavigation(
                breadcrumbs = uiState.breadcrumbs,
                onNavigateToRoot = { viewModel.navigateToBreadcrumb(-1) },
                onNavigateToBreadcrumb = { viewModel.navigateToBreadcrumb(it) },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )

            HorizontalDivider()

            // Content
            when {
                uiState.isLoadingFiles -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            CircularProgressIndicator()
                            Text(
                                text = "Loading files...",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                uiState.loadError != null -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Warning,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.error
                            )
                            Text(
                                text = "Failed to Load",
                                style = MaterialTheme.typography.titleMedium
                            )
                            Text(
                                text = uiState.loadError ?: "Unknown error",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Button(onClick = { viewModel.loadFiles() }) {
                                Text("Retry")
                            }
                        }
                    }
                }

                uiState.files.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Icon(
                                imageVector = Icons.Default.Folder,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = "No Files",
                                style = MaterialTheme.typography.titleMedium
                            )
                            Text(
                                text = "No .tex or .pdf files found in this directory.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                else -> {
                    FileList(
                        files = uiState.files,
                        currentPath = uiState.currentPath,
                        isTracked = { viewModel.isFileTracked(it) },
                        onNavigateUp = { viewModel.navigateUp() },
                        onFolderClick = { viewModel.navigateToFolder(it) },
                        onFileClick = { selectedFilePath = it.path }
                    )
                }
            }
        }
    }
}

@Composable
private fun BreadcrumbNavigation(
    breadcrumbs: List<String>,
    onNavigateToRoot: () -> Unit,
    onNavigateToBreadcrumb: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Root button
        FilterChip(
            selected = false,
            onClick = onNavigateToRoot,
            label = {
                Icon(
                    imageVector = Icons.Default.Home,
                    contentDescription = "Home",
                    modifier = Modifier.size(16.dp)
                )
            }
        )

        if (breadcrumbs.isNotEmpty()) {
            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
        }

        breadcrumbs.forEachIndexed { index, name ->
            FilterChip(
                selected = false,
                onClick = { onNavigateToBreadcrumb(index) },
                label = { Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            )

            if (index < breadcrumbs.size - 1) {
                Icon(
                    imageVector = Icons.Default.ChevronRight,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                )
            }
        }
    }
}

@Composable
private fun FileList(
    files: List<RepositoryFile>,
    currentPath: String,
    isTracked: (String) -> Boolean,
    onNavigateUp: () -> Unit,
    onFolderClick: (RepositoryFile) -> Unit,
    onFileClick: (RepositoryFile) -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Back button if not at root
        if (currentPath.isNotEmpty()) {
            item(key = "..") {
                FileRow(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    iconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    name = "..",
                    isTracked = false,
                    onClick = onNavigateUp
                )
            }
        }

        items(files, key = { it.path }) { file ->
            if (file.isDirectory) {
                FileRow(
                    icon = Icons.Default.Folder,
                    iconColor = Color(0xFF3B82F6),
                    name = file.name,
                    isTracked = false,
                    onClick = { onFolderClick(file) }
                )
            } else {
                val tracked = isTracked(file.path)
                FileRow(
                    icon = if (file.isTexFile) Icons.AutoMirrored.Filled.TextSnippet else Icons.Default.Description,
                    iconColor = if (tracked) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else if (file.isTexFile) {
                        Color(0xFF22C55E)
                    } else {
                        Color(0xFFEF4444)
                    },
                    name = file.name,
                    isTracked = tracked,
                    onClick = if (tracked) null else {{ onFileClick(file) }}
                )
            }
        }
    }
}

@Composable
private fun FileRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconColor: Color,
    name: String,
    isTracked: Boolean,
    onClick: (() -> Unit)?
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) {
                    Modifier.clickable(onClick = onClick)
                } else {
                    Modifier
                }
            ),
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = iconColor
            )

            Text(
                text = name,
                style = MaterialTheme.typography.bodyLarge,
                color = if (isTracked) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )

            if (isTracked) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "Already tracked",
                    modifier = Modifier.size(20.dp),
                    tint = Color(0xFF22C55E)
                )
            }
        }
    }
}
