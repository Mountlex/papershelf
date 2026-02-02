package com.carrel.app.features.gallery

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.staggeredgrid.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.carrel.app.core.auth.AuthManager
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.ConvexService
import com.carrel.app.core.network.models.Paper

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GalleryScreen(
    convexClient: ConvexClient,
    convexService: ConvexService,
    authManager: AuthManager,
    onPaperClick: (String) -> Unit,
    onSettingsClick: () -> Unit,
    onRepositoriesClick: () -> Unit
) {
    val viewModel = remember { GalleryViewModel(convexClient, convexService, authManager) }
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Papers") },
                actions = {
                    if (uiState.isLoading && !uiState.isRefreshing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        IconButton(onClick = { viewModel.refresh() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                        }
                    }
                    IconButton(onClick = onRepositoriesClick) {
                        Icon(Icons.Default.Folder, contentDescription = "Repositories")
                    }
                    IconButton(onClick = onSettingsClick) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                }
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = uiState.isRefreshing,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (uiState.papers.isEmpty() && !uiState.isLoading) {
                EmptyState()
            } else {
                PaperGrid(
                    papers = uiState.papers,
                    onPaperClick = onPaperClick,
                    onBuildClick = { viewModel.buildPaper(it) },
                    onForceRebuildClick = { viewModel.buildPaper(it, force = true) },
                    onDeleteClick = { viewModel.deletePaper(it) }
                )
            }
        }
    }

    // Error snackbar
    uiState.error?.let { error ->
        LaunchedEffect(error) {
            // Show snackbar or handle error
        }
    }
}

@Composable
private fun EmptyState() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "No Papers",
                style = MaterialTheme.typography.headlineSmall
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Add repositories on the web to see your papers here.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun PaperGrid(
    papers: List<Paper>,
    onPaperClick: (String) -> Unit,
    onBuildClick: (Paper) -> Unit,
    onForceRebuildClick: (Paper) -> Unit,
    onDeleteClick: (Paper) -> Unit
) {
    LazyVerticalStaggeredGrid(
        columns = StaggeredGridCells.Adaptive(160.dp),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalItemSpacing = 16.dp
    ) {
        items(papers, key = { it.id }) { paper ->
            PaperCard(
                paper = paper,
                onClick = { onPaperClick(paper.id) },
                onBuildClick = { onBuildClick(paper) },
                onForceRebuildClick = { onForceRebuildClick(paper) },
                onDeleteClick = { onDeleteClick(paper) }
            )
        }
    }
}
