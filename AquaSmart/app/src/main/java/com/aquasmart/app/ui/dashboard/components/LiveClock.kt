package com.aquasmart.app.ui.dashboard.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aquasmart.app.ui.theme.Teal500
import com.aquasmart.app.ui.theme.White87

@Composable
fun LiveClock(timeString: String) {
    Column(
        modifier = Modifier.padding(16.dp).fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(Icons.Default.Schedule, contentDescription = null, tint = Teal500, modifier = Modifier.size(24.dp))
        Spacer(modifier = Modifier.height(8.dp))
        Text(timeString, color = White87, style = MaterialTheme.typography.titleLarge)
        Text("Device Time", color = Teal500, style = MaterialTheme.typography.labelSmall)
    }
}
