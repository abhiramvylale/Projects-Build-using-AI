package com.aquasmart.app.ui.dashboard.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aquasmart.app.ui.theme.Navy900
import com.aquasmart.app.ui.theme.Teal500
import com.aquasmart.app.ui.theme.White87

@Composable
fun ManualControl(
    isValveOpen: Boolean,
    isMasterEnabled: Boolean,
    onToggleValve: (Boolean) -> Unit
) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text("Manual Override", color = White87, style = MaterialTheme.typography.titleMedium)
        Spacer(modifier = Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onToggleValve(true) },
                enabled = isMasterEnabled && !isValveOpen,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Teal500, contentColor = Navy900)
            ) {
                Text("OPEN VALVE")
            }
            Button(
                onClick = { onToggleValve(false) },
                enabled = isMasterEnabled && isValveOpen,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
            ) {
                Text("CLOSE VALVE")
            }
        }
    }
}
