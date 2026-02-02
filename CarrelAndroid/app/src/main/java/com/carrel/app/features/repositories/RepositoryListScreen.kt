package com.carrel.app.features.repositories

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.carrel.app.core.auth.AuthManager
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.models.Repository

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RepositoryListScreen(
    convexClient: ConvexClient,
    authManager: AuthManager,
    onRepositoryClick: (Repository) -> Unit,
    onBackClick: () -> Unit
) {
    val viewModel = remember { RepositoryListViewModel(convexClient, authManager) }
    val uiState by viewModel.uiState.collectAsState()

    var repositoryToDelete by remember { mutableStateOf<Repository?>(null) }

    val snackbarHostState = remember { SnackbarHostState() }

    // Load repositories when screen appears
    LaunchedEffect(Unit) {
        viewModel.loadRepositories()
    }

    // Show toast messages
    LaunchedEffect(uiState.toastMessage) {
        uiState.toastMessage?.let { message ->
            snackbarHostState.showSnackbar(message)
            viewModel.clearToast()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Repositories") },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (uiState.isCheckingAll) {
                        CircularProgressIndicator(
                            modifier = Modifier
                                .size(24.dp)
                                .padding(end = 12.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        IconButton(
                            onClick = { viewModel.checkAllRepositories() },
                            enabled = !uiState.isCheckingAll
                        ) {
                            Icon(Icons.Default.Sync, contentDescription = "Check all repositories")
                        }
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = uiState.isRefreshing,
            onRefresh = { viewModel.checkAllRepositories() },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                uiState.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                uiState.repositories.isEmpty() -> {
                    EmptyState()
                }
                else -> {
                    RepositoryList(
                        repositories = uiState.repositories,
                        refreshingRepoId = uiState.refreshingRepoId,
                        onRepositoryClick = onRepositoryClick,
                        onRefreshClick = { viewModel.refreshRepository(it) },
                        onDeleteClick = { repositoryToDelete = it }
                    )
                }
            }
        }
    }

    // Delete confirmation dialog
    repositoryToDelete?.let { repository ->
        AlertDialog(
            onDismissRequest = { repositoryToDelete = null },
            title = { Text("Delete Repository?") },
            text = {
                Text("This will also delete all ${repository.paperCount} tracked papers from \"${repository.name}\". This action cannot be undone.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.deleteRepository(repository)
                        repositoryToDelete = null
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { repositoryToDelete = null }) {
                    Text("Cancel")
                }
            }
        )
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
                text = "No Repositories",
                style = MaterialTheme.typography.headlineSmall
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Add repositories on the web to see them here.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun RepositoryList(
    repositories: List<Repository>,
    refreshingRepoId: String?,
    onRepositoryClick: (Repository) -> Unit,
    onRefreshClick: (Repository) -> Unit,
    onDeleteClick: (Repository) -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(repositories, key = { it.id }) { repository ->
            SwipeableRepositoryCard(
                repository = repository,
                isRefreshing = refreshingRepoId == repository.id,
                onClick = { onRepositoryClick(repository) },
                onRefreshClick = { onRefreshClick(repository) },
                onDeleteClick = { onDeleteClick(repository) }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeableRepositoryCard(
    repository: Repository,
    isRefreshing: Boolean,
    onClick: () -> Unit,
    onRefreshClick: () -> Unit,
    onDeleteClick: () -> Unit
) {
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { dismissValue ->
            when (dismissValue) {
                SwipeToDismissBoxValue.EndToStart -> {
                    onDeleteClick()
                    false // Don't dismiss, show confirmation dialog instead
                }
                else -> false
            }
        }
    )

    SwipeToDismissBox(
        state = dismissState,
        backgroundContent = {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                contentAlignment = Alignment.CenterEnd
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onRefreshClick) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = "Refresh",
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                    IconButton(onClick = onDeleteClick) {
                        Icon(
                            Icons.Default.Delete,
                            contentDescription = "Delete",
                            tint = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
        },
        content = {
            RepositoryCard(
                repository = repository,
                isRefreshing = isRefreshing,
                modifier = Modifier.clickable(onClick = onClick)
            )
        },
        enableDismissFromStartToEnd = false,
        enableDismissFromEndToStart = true
    )
}
