package com.aquasmart.app.ui.dashboard.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aquasmart.app.ui.theme.Teal500
import com.aquasmart.app.ui.theme.White60
import com.aquasmart.app.ui.theme.White87

@Composable
fun MasterToggle(
    isEnabled: Boolean,
    onToggle: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text("System Master", color = White87, style = MaterialTheme.typography.titleMedium)
            Text(if (isEnabled) "Active" else "Disabled", color = if (isEnabled) Teal500 else White60)
        }
        Switch(
            checked = isEnabled,
            onCheckedChange = onToggle,
            colors = SwitchDefaults.colors(checkedThumbColor = Teal500, checkedTrackColor = Teal500.copy(alpha = 0.5f))
        )
    }
}
