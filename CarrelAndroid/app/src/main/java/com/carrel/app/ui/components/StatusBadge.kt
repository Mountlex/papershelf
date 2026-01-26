package com.carrel.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.carrel.app.core.network.models.PaperStatus
import com.carrel.app.ui.theme.*

@Composable
fun StatusBadge(
    status: PaperStatus,
    modifier: Modifier = Modifier
) {
    val (color, text) = when (status) {
        PaperStatus.SYNCED -> StatusSynced to "Synced"
        PaperStatus.PENDING -> StatusPending to "Pending"
        PaperStatus.BUILDING -> StatusBuilding to "Building"
        PaperStatus.ERROR -> StatusError to "Error"
        PaperStatus.UNKNOWN -> StatusUnknown to "Unknown"
    }

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(color.copy(alpha = 0.15f))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (status == PaperStatus.BUILDING) {
            CircularProgressIndicator(
                modifier = Modifier.size(8.dp),
                strokeWidth = 1.dp,
                color = color
            )
        } else {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(color)
            )
        }
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = color
        )
    }
}
