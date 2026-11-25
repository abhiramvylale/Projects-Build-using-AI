package com.aquasmart.app.ui.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BluetoothConnected
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.aquasmart.app.data.ble.ConnectionState
import com.aquasmart.app.domain.model.terminal.TerminalMessage
import com.aquasmart.app.ui.theme.*
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(
    viewModel: TerminalViewModel = hiltViewModel(),
    onNavigateToScanner: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    var inputText by remember { mutableStateOf("") }
    val timeFormat = remember { SimpleDateFormat("HH:mm:ss.SSS", Locale.US) }
    
    var showMenu by remember { mutableStateOf(false) }
    
    // Auto scroll to bottom
    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = if (uiState.deviceName.isNotBlank()) uiState.deviceName else "Terminal",
                            style = MaterialTheme.typography.titleMedium,
                            color = White87
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(if (uiState.connectionState == ConnectionState.CONNECTED) SuccessGreen else ErrorRed)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = uiState.connectionState.name,
                                style = MaterialTheme.typography.bodySmall,
                                color = White60
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Navy900,
                    titleContentColor = White87
                ),
                actions = {
                    IconButton(onClick = viewModel::clearTerminal) {
                        Icon(Icons.Default.Delete, contentDescription = "Clear", tint = White60)
                    }
                    IconButton(onClick = { showMenu = !showMenu }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings", tint = White60)
                    }
                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false },
                        modifier = Modifier.background(Navy800)
                    ) {
                        DropdownMenuItem(
                            text = { Text("Hex Mode: ${if (uiState.isHexMode) "ON" else "OFF"}", color = White87) },
                            onClick = {
                                viewModel.toggleHexMode(!uiState.isHexMode)
                                showMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Newline: ${uiState.newlineMode.replace("\r", "\\r").replace("\n", "\\n")}", color = White87) },
                            onClick = {
                                val next = when(uiState.newlineMode) {
                                    "\r\n" -> "\n"
                                    "\n" -> "\r"
                                    "\r" -> ""
                                    else -> "\r\n"
                                }
                                viewModel.setNewlineMode(next)
                                showMenu = false
                            }
                        )
                    }
                    IconButton(onClick = {
                        viewModel.disconnect()
                        onNavigateToScanner()
                    }) {
                        Icon(Icons.Default.Close, contentDescription = "Disconnect", tint = ErrorRed)
                    }
                }
            )
        },
        bottomBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Navy800)
                    .navigationBarsPadding()
                    .imePadding()
                    .padding(8.dp)
            ) {
                // Macros
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val macros = listOf("M1" to "AT\\r\\n", "M2" to "INFO\\r\\n", "M3" to "STATUS\\r\\n")
                    macros.forEach { (label, cmd) ->
                        Button(
                            onClick = { 
                                val unescaped = cmd.replace("\\r", "\r").replace("\\n", "\n")
                                viewModel.sendCommand(unescaped) 
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = DarkCard),
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(0.dp)
                        ) {
                            Text(label, color = Teal400, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                // Input Row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("Enter command...", color = White38) },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = DarkCard,
                            unfocusedContainerColor = DarkCard,
                            focusedBorderColor = Teal500,
                            unfocusedBorderColor = Navy700,
                            focusedTextColor = White87,
                            unfocusedTextColor = White87
                        ),
                        shape = RoundedCornerShape(16.dp),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(
                            onSend = {
                                viewModel.sendCommand(inputText)
                                inputText = ""
                            }
                        )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    FloatingActionButton(
                        onClick = {
                            viewModel.sendCommand(inputText)
                            inputText = ""
                        },
                        containerColor = Teal500,
                        contentColor = Navy900,
                        shape = CircleShape
                    ) {
                        Icon(Icons.Default.Send, contentDescription = "Send")
                    }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .background(Navy900)
                .padding(padding)
                .padding(8.dp),
            verticalArrangement = Arrangement.Top
        ) {
            items(uiState.messages) { msg ->
                val timeStr = timeFormat.format(Date(msg.timestamp))
                val color = if (msg.isSent) Teal400 else White87
                val prefix = if (msg.isSent) "→" else "←"
                
                Text(
                    text = "[$timeStr] $prefix ${msg.text.trimEnd()}",
                    color = color,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 2.dp)
                )
            }
        }
    }
}
