package com.aquasmart.app.ui.terminal

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aquasmart.app.data.ble.BleManager
import com.aquasmart.app.data.ble.ConnectionState
import com.aquasmart.app.domain.model.terminal.TerminalMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

data class TerminalUiState(
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val deviceName: String = "",
    val messages: List<TerminalMessage> = emptyList(),
    val isHexMode: Boolean = false,
    val newlineMode: String = "\\r\\n"
)

@HiltViewModel
class TerminalViewModel @Inject constructor(
    private val bleManager: BleManager
) : ViewModel() {

    val uiState: StateFlow<TerminalUiState> = combine(
        bleManager.connectionState,
        bleManager.deviceName,
        bleManager.messages
    ) { conn, name, msgs ->
        TerminalUiState(
            connectionState = conn,
            deviceName = name,
            messages = msgs,
            isHexMode = bleManager.isHexMode,
            newlineMode = bleManager.newlineMode
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), TerminalUiState())

    fun sendCommand(text: String) {
        if (text.isNotEmpty()) {
            bleManager.sendText(text)
        }
    }

    fun disconnect() {
        bleManager.disconnect()
    }
    
    fun clearTerminal() {
        bleManager.clearMessages()
    }
    
    fun toggleHexMode(enabled: Boolean) {
        bleManager.isHexMode = enabled
    }
    
    fun setNewlineMode(mode: String) {
        bleManager.newlineMode = mode
    }
}
