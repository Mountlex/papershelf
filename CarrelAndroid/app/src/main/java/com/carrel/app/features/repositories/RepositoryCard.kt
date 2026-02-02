package com.carrel.app.features.repositories

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.carrel.app.core.network.models.PaperSyncStatus
import com.carrel.app.core.network.models.Repository
import com.carrel.app.core.network.models.RepositoryProvider
import com.carrel.app.core.network.models.RepositorySyncStatus
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun RepositoryCard(
    repository: Repository,
    isRefreshing: Boolean = false,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Header: Provider icon and name
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f)
                ) {
                    ProviderIcon(provider = repository.provider)

                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = repository.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = repository.provider.displayName,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Spacer(modifier = Modifier.width(8.dp))

                if (isRefreshing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp
                    )
                } else {
                    StatusBadge(
                        syncStatus = repository.syncStatus,
                        paperSyncStatus = repository.paperSyncStatus
                    )
                }
            }

            // Stats row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Paper count
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Description,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "${repository.paperCountInt}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                // Error count (if any)
                if (repository.papersWithErrorsInt > 0) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Text(
                            text = "${repository.papersWithErrorsInt}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }

                Spacer(modifier = Modifier.weight(1f))

                // Latest commit time
                repository.lastCommitTime?.let { timestamp ->
                    Text(
                        text = formatTimestamp(timestamp.toLong()),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                    )
                }
            }
        }
    }
}

@Composable
private fun ProviderIcon(provider: RepositoryProvider) {
    val iconText = when (provider) {
        RepositoryProvider.GITHUB -> "GH"
        RepositoryProvider.GITLAB -> "GL"
        RepositoryProvider.SELFHOSTED_GITLAB -> "GL"
        RepositoryProvider.OVERLEAF -> "OL"
        RepositoryProvider.GENERIC -> "Git"
    }

    val backgroundColor = when (provider) {
        RepositoryProvider.GITHUB -> Color(0xFF24292E)
        RepositoryProvider.GITLAB -> Color(0xFFFC6D26)
        RepositoryProvider.SELFHOSTED_GITLAB -> Color(0xFFFC6D26)
        RepositoryProvider.OVERLEAF -> Color(0xFF47A141)
        RepositoryProvider.GENERIC -> MaterialTheme.colorScheme.primary
    }

    Box(
        modifier = Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(backgroundColor),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = iconText,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = Color.White
        )
    }
}

@Composable
private fun StatusBadge(
    syncStatus: RepositorySyncStatus,
    paperSyncStatus: PaperSyncStatus
) {
    val (color, text) = when {
        syncStatus == RepositorySyncStatus.ERROR -> Color(0xFFEF4444) to "Error"
        paperSyncStatus == PaperSyncStatus.IN_SYNC -> Color(0xFF22C55E) to paperSyncStatus.displayText
        paperSyncStatus == PaperSyncStatus.NEEDS_SYNC -> Color(0xFFF59E0B) to paperSyncStatus.displayText
        else -> MaterialTheme.colorScheme.onSurfaceVariant to paperSyncStatus.displayText
    }

    Surface(
        shape = CircleShape,
        color = color.copy(alpha = 0.12f)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(color)
            )
            Text(
                text = text,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Medium,
                color = color
            )
        }
    }
}

private fun formatTimestamp(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    val seconds = diff / 1000
    val minutes = seconds / 60
    val hours = minutes / 60
    val days = hours / 24

    return when {
        seconds < 60 -> "just now"
        minutes < 60 -> "${minutes}m ago"
        hours < 24 -> "${hours}h ago"
        days < 7 -> "${days}d ago"
        else -> {
            val date = Date(timestamp)
            val formatter = SimpleDateFormat("MMM d, yyyy", Locale.getDefault())
            formatter.format(date)
        }
    }
}
