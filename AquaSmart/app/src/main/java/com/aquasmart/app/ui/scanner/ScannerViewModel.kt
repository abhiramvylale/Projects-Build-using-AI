package com.aquasmart.app.ui.scanner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aquasmart.app.data.ble.BluetoothDeviceModel
import com.aquasmart.app.data.ble.ConnectionState
import com.aquasmart.app.data.repository.DeviceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ScannerUiState(
    val isScanning: Boolean = false,
    val devices: List<BluetoothDeviceModel> = emptyList(),
    val error: String? = null,
    val isConnecting: Boolean = false
)

@HiltViewModel
class ScannerViewModel @Inject constructor(
    private val repository: DeviceRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ScannerUiState())
    val uiState: StateFlow<ScannerUiState> = _uiState.asStateFlow()

    private val _connectedEvent = MutableSharedFlow<Unit>()
    val connectedEvent = _connectedEvent.asSharedFlow()

    init {
        viewModelScope.launch {
            repository.observeScannedDevices().collect { deviceList ->
                _uiState.update { it.copy(devices = deviceList) }
            }
        }

        viewModelScope.launch {
            repository.observeConnectionState().collect { state ->
                when (state) {
                    ConnectionState.CONNECTED -> {
                        _uiState.update { it.copy(isConnecting = false) }
                        _connectedEvent.emit(Unit)
                    }
                    ConnectionState.CONNECTING -> {
                        _uiState.update { it.copy(isConnecting = true) }
                    }
                    ConnectionState.DISCONNECTED -> {
                        _uiState.update { it.copy(isConnecting = false) }
                    }
                    ConnectionState.DISCONNECTING -> {
                        _uiState.update { it.copy(isConnecting = false) }
                    }
                }
            }
        }
    }

    fun startScan() {
        _uiState.update { it.copy(isScanning = true, error = null) }
        repository.startScan()
    }

    fun stopScan() {
        _uiState.update { it.copy(isScanning = false) }
        repository.stopScan()
    }

    fun connectToDevice(device: BluetoothDeviceModel) {
        _uiState.update { it.copy(isConnecting = true, error = null) }
        viewModelScope.launch {
            repository.saveLastConnectedDevice(device.address)
            repository.connectToDevice(device)
        }
    }
}
