package com.aquasmart.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BluetoothConnected
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.aquasmart.app.data.ble.ConnectionState
import com.aquasmart.app.ui.dashboard.components.*
import com.aquasmart.app.ui.theme.*

@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel = hiltViewModel(),
    onNavigateToScanner: () -> Unit,
    onNavigateToTerminal: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Navy900)
            .systemBarsPadding()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Top Section: Connection status bar & actions
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(if (uiState.connectionState == ConnectionState.CONNECTED) SuccessGreen else ErrorRed)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Text(
                        text = if (uiState.deviceState.deviceName.isNotBlank()) uiState.deviceState.deviceName else "AquaSmart Controller",
                        color = White87,
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = when (uiState.connectionState) {
                            ConnectionState.CONNECTED -> "BLE Connected (UART Active)"
                            ConnectionState.CONNECTING -> "Connecting..."
                            ConnectionState.DISCONNECTING -> "Disconnecting..."
                            ConnectionState.DISCONNECTED -> "Disconnected"
                        },
                        color = if (uiState.connectionState == ConnectionState.CONNECTED) Teal400 else White60,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                if (uiState.connectionState == ConnectionState.CONNECTED) {
                    IconButton(onClick = { viewModel.syncTime() }) {
                        Icon(Icons.Default.Sync, contentDescription = "Sync Time to Device", tint = Teal500)
                    }
                    IconButton(onClick = onNavigateToTerminal) {
                        Icon(Icons.Default.Terminal, contentDescription = "Terminal Preview", tint = Teal500)
                    }
                }

                IconButton(onClick = {
                    viewModel.disconnect()
                    onNavigateToScanner()
                }) {
                    Icon(Icons.Default.Settings, contentDescription = "Device Settings / Scanner", tint = White60)
                }
            }
        }

        // App Title Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = DarkCard),
            shape = RoundedCornerShape(16.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(Icons.Default.WaterDrop, contentDescription = null, tint = Teal500, modifier = Modifier.size(44.dp))
                Spacer(modifier = Modifier.height(6.dp))
                Text(text = "AquaSmart", color = White87, style = MaterialTheme.typography.headlineMedium)
                Text(text = "Smart Irrigation Controller", color = White60, style = MaterialTheme.typography.bodyMedium)
            }
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = DarkCard),
            shape = RoundedCornerShape(16.dp),
        ) {
            MasterToggle(
                isEnabled = uiState.deviceState.isMasterEnabled,
                onToggle = viewModel::toggleMaster
            )
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = DarkCard),
            shape = RoundedCornerShape(16.dp),
        ) {
            TimerSchedule(
                schedules = uiState.schedules,
                selectedScheduleId = uiState.selectedScheduleId,
                onSelectSchedule = viewModel::selectSchedule,
                onSaveSchedule = viewModel::saveSchedule,
                onAddNewSchedule = viewModel::addNewSchedule,
                onDeleteSchedule = viewModel::deleteSchedule,
                onSyncAll = viewModel::syncAllSchedules,
                isSettingSchedule = uiState.isSettingSchedule
            )
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = DarkCard),
            shape = RoundedCornerShape(16.dp),
        ) {
            ManualControl(
                isValveOpen = uiState.deviceState.isValveOpen,
                isMasterEnabled = uiState.deviceState.isMasterEnabled,
                onToggleValve = viewModel::toggleValve
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Card(
                modifier = Modifier.weight(1f),
                colors = CardDefaults.cardColors(containerColor = DarkCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                LiveClock(timeString = uiState.currentTime)
            }

            Card(
                modifier = Modifier.weight(1f),
                colors = CardDefaults.cardColors(containerColor = DarkCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                TempDisplay(temperatureCelsius = uiState.deviceState.temperatureCelsius)
            }
        }
        Spacer(modifier = Modifier.height(16.dp))
    }
}
