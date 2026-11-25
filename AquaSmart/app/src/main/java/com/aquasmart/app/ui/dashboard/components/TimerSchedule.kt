package com.aquasmart.app.ui.dashboard.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.*
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aquasmart.app.domain.model.Schedule
import com.aquasmart.app.ui.theme.Navy900
import com.aquasmart.app.ui.theme.Teal500
import com.aquasmart.app.ui.theme.White87

@Composable
fun TimerSchedule(
    schedules: List<Schedule>,
    selectedScheduleId: Int,
    onSelectSchedule: (Int) -> Unit,
    onSaveSchedule: (Schedule) -> Unit,
    onAddNewSchedule: () -> Unit,
    onDeleteSchedule: (Schedule) -> Unit,
    onSyncAll: (List<Schedule>) -> Unit,
    isSettingSchedule: Boolean
) {
    val selectedSchedule = schedules.find { it.id == selectedScheduleId }

    if (selectedSchedule == null) {
        Column(modifier = Modifier.padding(16.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Teal500)
        }
    } else {
        TimerScheduleContent(
            selectedSchedule = selectedSchedule,
            schedules = schedules,
            selectedScheduleId = selectedScheduleId,
            onSelectSchedule = onSelectSchedule,
            onSaveSchedule = onSaveSchedule,
            onAddNewSchedule = onAddNewSchedule,
            onDeleteSchedule = onDeleteSchedule,
            onSyncAll = onSyncAll,
            isSettingSchedule = isSettingSchedule
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimerScheduleContent(
    selectedSchedule: Schedule,
    schedules: List<Schedule>,
    selectedScheduleId: Int,
    onSelectSchedule: (Int) -> Unit,
    onSaveSchedule: (Schedule) -> Unit,
    onAddNewSchedule: () -> Unit,
    onDeleteSchedule: (Schedule) -> Unit,
    onSyncAll: (List<Schedule>) -> Unit,
    isSettingSchedule: Boolean
) {
    var hour by remember(selectedSchedule) { mutableStateOf(selectedSchedule.startHour.toString()) }
    var minute by remember(selectedSchedule) { mutableStateOf(selectedSchedule.startMinute.toString()) }
    var duration by remember(selectedSchedule) { mutableStateOf(selectedSchedule.durationMinutes.toString()) }
    var isEnabled by remember(selectedSchedule) { mutableStateOf(selectedSchedule.isEnabled) }

    Column(modifier = Modifier.padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Irrigation Schedule", color = White87, style = MaterialTheme.typography.titleMedium)
            IconButton(onClick = onAddNewSchedule) {
                Icon(Icons.Default.Add, contentDescription = "Add", tint = Teal500)
            }
        }
        
        ScrollableTabRow(
            selectedTabIndex = schedules.indexOfFirst { it.id == selectedScheduleId }.coerceAtLeast(0),
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
            edgePadding = 0.dp,
            indicator = { tabPositions ->
                val index = schedules.indexOfFirst { it.id == selectedScheduleId }.coerceAtLeast(0)
                if (index < tabPositions.size) {
                    TabRowDefaults.SecondaryIndicator(
                        Modifier.tabIndicatorOffset(tabPositions[index])
                    )
                }
            }
        ) {
            schedules.forEach { sched ->
                Tab(
                    selected = sched.id == selectedScheduleId,
                    onClick = { onSelectSchedule(sched.id) },
                    text = { Text(sched.label) }
                )
            }
        }
        
        Spacer(modifier = Modifier.height(16.dp))

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = hour,
                onValueChange = { hour = it },
                label = { Text("Hour (0-23)") },
                modifier = Modifier.weight(1f),
                colors = OutlinedTextFieldDefaults.colors(focusedTextColor = White87, unfocusedTextColor = White87)
            )
            OutlinedTextField(
                value = minute,
                onValueChange = { minute = it },
                label = { Text("Min (0-59)") },
                modifier = Modifier.weight(1f),
                colors = OutlinedTextFieldDefaults.colors(focusedTextColor = White87, unfocusedTextColor = White87)
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = duration,
            onValueChange = { duration = it },
            label = { Text("Duration (minutes)") },
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(focusedTextColor = White87, unfocusedTextColor = White87)
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = isEnabled, onCheckedChange = { isEnabled = it })
                Text("Enable Timer", color = White87)
            }
            IconButton(onClick = { onDeleteSchedule(selectedSchedule) }) {
                Icon(Icons.Default.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.error)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
        
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    val h = hour.toIntOrNull() ?: 0
                    val m = minute.toIntOrNull() ?: 0
                    val d = duration.toIntOrNull() ?: 0
                    onSaveSchedule(selectedSchedule.copy(startHour = h, startMinute = m, durationMinutes = d, isEnabled = isEnabled))
                },
                enabled = !isSettingSchedule,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Teal500, contentColor = Navy900)
            ) {
                Text(if (isSettingSchedule) "Saving..." else "Save")
            }
            
            Button(
                onClick = { onSyncAll(schedules) },
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)
            ) {
                Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("Sync All")
            }
        }
    }
}
