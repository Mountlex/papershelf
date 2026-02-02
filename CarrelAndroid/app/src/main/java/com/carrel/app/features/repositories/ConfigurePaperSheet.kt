package com.carrel.app.features.repositories

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.automirrored.filled.TextSnippet
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.carrel.app.core.network.ConvexService
import com.carrel.app.core.network.models.Compiler
import com.carrel.app.core.network.models.Repository
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfigurePaperSheet(
    repository: Repository,
    filePath: String,
    convexService: ConvexService,
    onDismiss: () -> Unit,
    onSuccess: () -> Unit
) {
    val scope = rememberCoroutineScope()

    val fileName = filePath.split("/").last()
    val isTexFile = filePath.endsWith(".tex")

    // Auto-populate title from filename (without extension)
    var title by remember {
        mutableStateOf(
            if (fileName.contains(".")) {
                fileName.substringBeforeLast(".")
            } else {
                fileName
            }
        )
    }
    var selectedCompiler by remember { mutableStateOf(Compiler.PDFLATEX) }
    var isAdding by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val canAddPaper = title.isNotBlank() && !isAdding

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        // Header
        Text(
            text = "Add Paper",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold
        )

        // File info section
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            ),
            shape = RoundedCornerShape(12.dp)
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = if (isTexFile) Icons.AutoMirrored.Filled.TextSnippet else Icons.Default.Description,
                    contentDescription = null,
                    tint = if (isTexFile) Color(0xFF22C55E) else Color(0xFFEF4444),
                    modifier = Modifier.size(32.dp)
                )

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = fileName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = filePath,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }

        // Title field
        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            label = { Text("Title") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )

        // Compiler picker (only for .tex files)
        if (isTexFile) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Compiler",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    Compiler.entries.forEachIndexed { index, compiler ->
                        SegmentedButton(
                            selected = selectedCompiler == compiler,
                            onClick = { selectedCompiler = compiler },
                            shape = SegmentedButtonDefaults.itemShape(
                                index = index,
                                count = Compiler.entries.size
                            )
                        ) {
                            Text(compiler.displayName)
                        }
                    }
                }
            }
        }

        // Error message
        errorMessage?.let { error ->
            Text(
                text = error,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall
            )
        }

        // Buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedButton(
                onClick = onDismiss,
                modifier = Modifier.weight(1f)
            ) {
                Text("Cancel")
            }

            Button(
                onClick = {
                    scope.launch {
                        isAdding = true
                        errorMessage = null

                        val pdfSourceType = if (isTexFile) "compile" else "committed"
                        val compilerValue = if (isTexFile) selectedCompiler.value else null

                        convexService.addTrackedFile(
                            repositoryId = repository.id,
                            filePath = filePath,
                            title = title,
                            pdfSourceType = pdfSourceType,
                            compiler = compilerValue
                        ).onSuccess { result ->
                            // Trigger build in background
                            launch {
                                convexService.buildPaper(result.paperId)
                            }
                            onSuccess()
                        }.onFailure { exception ->
                            errorMessage = if (exception.message?.contains("already exists") == true) {
                                "File already tracked"
                            } else {
                                "Failed to add paper"
                            }
                            isAdding = false
                        }
                    }
                },
                enabled = canAddPaper,
                modifier = Modifier.weight(1f)
            ) {
                if (isAdding) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text(if (isAdding) "Adding..." else "Add Paper")
            }
        }
    }
}
