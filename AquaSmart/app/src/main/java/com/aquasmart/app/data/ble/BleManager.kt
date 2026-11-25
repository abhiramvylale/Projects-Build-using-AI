package com.aquasmart.app.data.ble

import android.annotation.SuppressLint
import android.app.Application
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothSocket
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.util.Log
import com.aquasmart.app.domain.model.terminal.TerminalMessage
import com.aquasmart.app.domain.model.DeviceState
import com.aquasmart.app.domain.model.Schedule
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.StandardCharsets
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

enum class ConnectionState {
    DISCONNECTED, CONNECTING, CONNECTED, DISCONNECTING
}

enum class DeviceType {
    CLASSIC, BLE
}

data class BluetoothDeviceModel(
    val name: String,
    val address: String,
    val type: DeviceType,
    val rssi: Int = 0
)

@SuppressLint("MissingPermission")
@Singleton
class BleManager @Inject constructor(
    private val application: Application
) {
    private val TAG = "BluetoothTerminal"

    private val bluetoothManager = application.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? get() = bluetoothManager.adapter
    private val bluetoothLeScanner get() = bluetoothAdapter?.bluetoothLeScanner

    // BLE
    private var bluetoothGatt: BluetoothGatt? = null
    private var writeCharacteristic: BluetoothGattCharacteristic? = null
    private var notifyCharacteristic: BluetoothGattCharacteristic? = null

    // Classic
    private val SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private var classicSocket: BluetoothSocket? = null
    private var classicInputStream: InputStream? = null
    private var classicOutputStream: OutputStream? = null
    private var classicReadJob: Job? = null
    
    private val coroutineScope = CoroutineScope(Dispatchers.IO)

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _scannedDevices = MutableStateFlow<List<BluetoothDeviceModel>>(emptyList())
    val scannedDevices: StateFlow<List<BluetoothDeviceModel>> = _scannedDevices.asStateFlow()

    private val _messages = MutableStateFlow<List<TerminalMessage>>(emptyList())
    val messages: StateFlow<List<TerminalMessage>> = _messages.asStateFlow()

    private val _deviceState = MutableStateFlow(DeviceState())
    val deviceState: StateFlow<DeviceState> = _deviceState.asStateFlow()

    private val _deviceName = MutableStateFlow("")
    val deviceName: StateFlow<String> = _deviceName.asStateFlow()

    private val scannedDevicesMap = mutableMapOf<String, BluetoothDeviceModel>()
    
    // Config
    var newlineMode = "\r\n"
    var isHexMode = false

    companion object {
        val NUS_SERVICE_UUID: UUID = UUID.fromString("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
        val NUS_RX_UUID: UUID = UUID.fromString("6E400002-B5A3-F393-E0A9-E50E24DCCA9E") 
        val NUS_TX_UUID: UUID = UUID.fromString("6E400003-B5A3-F393-E0A9-E50E24DCCA9E")

        val HM10_SERVICE_UUID: UUID = UUID.fromString("0000FFE0-0000-1000-8000-00805F9B34FB")
        val HM10_CHAR_UUID: UUID = UUID.fromString("0000FFE1-0000-1000-8000-00805F9B34FB")

        val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB")
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device ?: return
            val address = device.address ?: return
            val name = result.scanRecord?.deviceName ?: device.name ?: "Unknown BLE Device"

            val model = BluetoothDeviceModel(name, address, DeviceType.BLE, result.rssi)
            scannedDevicesMap[address] = model
            updateDeviceList()
        }
        
        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "BLE scan failed: $errorCode")
        }
    }
    
    private fun updateDeviceList() {
        val paired = bluetoothAdapter?.bondedDevices?.map {
            BluetoothDeviceModel(it.name ?: "Unknown Classic Device", it.address, DeviceType.CLASSIC)
        } ?: emptyList()
        
        val ble = scannedDevicesMap.values.filter { bleDevice ->
            paired.none { it.address == bleDevice.address }
        }.sortedByDescending { it.rssi }
        
        _scannedDevices.value = paired + ble
    }

    fun startScan() {
        if (bluetoothAdapter?.isEnabled != true) return
        scannedDevicesMap.clear()
        updateDeviceList()

        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        try {
            bluetoothLeScanner?.startScan(null, settings, scanCallback)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting BLE scan", e)
        }
    }

    fun stopScan() {
        try {
            bluetoothLeScanner?.stopScan(scanCallback)
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping BLE scan", e)
        }
    }

    fun connect(deviceModel: BluetoothDeviceModel) {
        val adapter = bluetoothAdapter ?: return
        stopScan()
        
        _connectionState.value = ConnectionState.CONNECTING
        _deviceName.value = deviceModel.name
        
        try {
            val device = adapter.getRemoteDevice(deviceModel.address)
            if (deviceModel.type == DeviceType.CLASSIC) {
                connectClassic(device)
            } else {
                connectBle(device)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Connection failed", e)
            _connectionState.value = ConnectionState.DISCONNECTED
        }
    }
    
    private fun connectClassic(device: BluetoothDevice) {
        coroutineScope.launch {
            try {
                classicSocket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                bluetoothAdapter?.cancelDiscovery()
                classicSocket?.connect()
                
                classicInputStream = classicSocket?.inputStream
                classicOutputStream = classicSocket?.outputStream
                
                _connectionState.value = ConnectionState.CONNECTED
                startClassicReadLoop()
            } catch (e: IOException) {
                Log.e(TAG, "Classic connect failed", e)
                disconnect()
            }
        }
    }
    
    private fun startClassicReadLoop() {
        classicReadJob = coroutineScope.launch {
            val buffer = ByteArray(1024)
            while (true) {
                try {
                    val bytes = classicInputStream?.read(buffer) ?: -1
                    if (bytes > 0) {
                        val data = buffer.copyOfRange(0, bytes)
                        handleIncomingBytes(data)
                    }
                } catch (e: IOException) {
                    disconnect()
                    break
                }
            }
        }
    }

    private fun connectBle(device: BluetoothDevice) {
        bluetoothGatt = device.connectGatt(application, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                _connectionState.value = ConnectionState.CONNECTED
                gatt.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                disconnect()
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            writeCharacteristic = null
            notifyCharacteristic = null

            val nusService = gatt.getService(NUS_SERVICE_UUID)
            if (nusService != null) {
                writeCharacteristic = nusService.getCharacteristic(NUS_RX_UUID)
                notifyCharacteristic = nusService.getCharacteristic(NUS_TX_UUID)
            }

            if (writeCharacteristic == null || notifyCharacteristic == null) {
                val hm10Service = gatt.getService(HM10_SERVICE_UUID)
                if (hm10Service != null) {
                    val hm10Char = hm10Service.getCharacteristic(HM10_CHAR_UUID)
                    writeCharacteristic = hm10Char
                    notifyCharacteristic = hm10Char
                }
            }

            if (notifyCharacteristic == null || writeCharacteristic == null) {
                for (service in gatt.services) {
                    for (ch in service.characteristics) {
                        val props = ch.properties
                        if (notifyCharacteristic == null && ((props and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0 || (props and BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0)) {
                            notifyCharacteristic = ch
                        }
                        if (writeCharacteristic == null && ((props and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0 || (props and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)) {
                            writeCharacteristic = ch
                        }
                    }
                }
            }

            notifyCharacteristic?.let { ch ->
                gatt.setCharacteristicNotification(ch, true)
                val descriptor = ch.getDescriptor(CCCD_UUID)
                if (descriptor != null) {
                    val value = if ((ch.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) BluetoothGattDescriptor.ENABLE_INDICATION_VALUE else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gatt.writeDescriptor(descriptor, value)
                    } else {
                        @Suppress("DEPRECATION")
                        descriptor.value = value
                        @Suppress("DEPRECATION")
                        gatt.writeDescriptor(descriptor)
                    }
                }
            }
            gatt.requestMtu(512)
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            characteristic.value?.let { handleIncomingBytes(it) }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            handleIncomingBytes(value)
        }
    }

    private fun handleIncomingBytes(bytes: ByteArray) {
        if (bytes.isEmpty()) return
        val text = if (isHexMode) {
            bytes.joinToString(" ") { String.format("%02X", it) }
        } else {
            String(bytes, StandardCharsets.UTF_8)
        }
        
        appendMessage(text, isSent = false)
        if (!isHexMode) {
            parseUartLine(text)
        }
    }

    private fun parseUartLine(line: String) {
        val timeRegex = Regex("""(?:TIME:?\s*)?([0-2]?[0-9]:[0-5][0-9](?::[0-5][0-9])?)""", RegexOption.IGNORE_CASE)
        val timeMatch = timeRegex.find(line)
        if (timeMatch != null && (line.contains("TIME", ignoreCase = true) || line.matches(Regex("""^[0-2]?[0-9]:[0-5][0-9](?::[0-5][0-9])?$""")))) {
            val extractedTime = timeMatch.groupValues[1]
            val fullTime = if (extractedTime.count { it == ':' } == 1) "$extractedTime:00" else extractedTime
            _deviceState.update { it.copy(deviceTime = fullTime) }
        }

        val tempRegex = Regex("""TEMP:?\s*(-?\d+(?:\.\d+)?)""", RegexOption.IGNORE_CASE)
        val tempMatch = tempRegex.find(line)
        if (tempMatch != null && (line.contains("TEMP", ignoreCase = true) || line.trim().endsWith("C", ignoreCase = true))) {
            tempMatch.groupValues[1].toFloatOrNull()?.let { temp ->
                _deviceState.update { it.copy(temperatureCelsius = temp) }
            }
        }

        if (line.contains("RELAY:ON", ignoreCase = true) || line.contains("RELAY: ON", ignoreCase = true) || line.contains("VALVE: ON", ignoreCase = true)) {
            _deviceState.update { it.copy(isValveOpen = true) }
        } else if (line.contains("RELAY:OFF", ignoreCase = true) || line.contains("RELAY: OFF", ignoreCase = true) || line.contains("VALVE: OFF", ignoreCase = true)) {
            _deviceState.update { it.copy(isValveOpen = false) }
        }

        if (line.contains("SYS: ACTIVE", ignoreCase = true) || line.contains("MASTER: ON", ignoreCase = true) || line.contains("MASTER: 1", ignoreCase = true)) {
            _deviceState.update { it.copy(isMasterEnabled = true) }
        } else if (line.contains("SYS: OFF", ignoreCase = true) || line.contains("MASTER: OFF", ignoreCase = true) || line.contains("MASTER: 0", ignoreCase = true)) {
            _deviceState.update { it.copy(isMasterEnabled = false) }
        }
    }

    fun syncPhoneTime() {
        val now = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        sendText("TIME:$now")
    }

    fun toggleValve(open: Boolean) {
        _deviceState.update { it.copy(isValveOpen = open) }
        sendText(if (open) "RELAY:ON" else "RELAY:OFF")
    }

    fun setMasterToggle(enabled: Boolean) {
        _deviceState.update { it.copy(isMasterEnabled = enabled) }
        sendText(if (enabled) "MASTER:ON" else "MASTER:OFF")
    }

    fun sendSchedule(schedule: Schedule) {
        coroutineScope.launch {
            if (schedule.isEnabled) {
                val startHour = schedule.startHour
                val startMin = schedule.startMinute
                
                // Calculate end time
                var endMin = startMin + schedule.durationMinutes
                var endHour = startHour + (endMin / 60)
                endMin %= 60
                endHour %= 24
                
                val onCmd = String.format(Locale.US, "%sON:%02d:%02d:00", schedule.label, startHour, startMin)
                val offCmd = String.format(Locale.US, "%sOFF:%02d:%02d:00", schedule.label, endHour, endMin)
                
                sendText(onCmd)
                kotlinx.coroutines.delay(400) // Delay to let microcontroller process
                sendText(offCmd)
            } else {
                val offCmd = String.format(Locale.US, "%sOFF:00:00:00", schedule.label)
                sendText(offCmd)
            }
        }
    }

    fun syncAllSchedules(schedules: List<Schedule>) {
        coroutineScope.launch {
            sendText("SYNC:START")
            kotlinx.coroutines.delay(400)
            schedules.forEach { 
                sendSchedule(it) 
                kotlinx.coroutines.delay(1000) // Wait for both ON and OFF to send
            }
            sendText("SYNC:DONE")
        }
    }


    fun disconnect() {
        _connectionState.value = ConnectionState.DISCONNECTING
        
        try { classicReadJob?.cancel() } catch (e: Exception) {}
        try { classicInputStream?.close() } catch (e: Exception) {}
        try { classicOutputStream?.close() } catch (e: Exception) {}
        try { classicSocket?.close() } catch (e: Exception) {}
        classicSocket = null
        
        try {
            bluetoothGatt?.disconnect()
            bluetoothGatt?.close()
        } catch (e: Exception) {}
        bluetoothGatt = null
        writeCharacteristic = null
        notifyCharacteristic = null
        
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    fun sendText(text: String) {
        val payload = if (isHexMode) {
            try {
                val clean = text.replace(" ", "")
                clean.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            } catch (e: Exception) {
                appendMessage("Error: Invalid Hex", isSent = true)
                return
            }
        } else {
            (text + newlineMode).toByteArray(StandardCharsets.UTF_8)
        }
        
        sendBytes(payload)
        appendMessage(text, isSent = true)
    }

    private fun sendBytes(bytes: ByteArray) {
        if (classicSocket != null) {
            coroutineScope.launch {
                try {
                    classicOutputStream?.write(bytes)
                } catch (e: IOException) {
                    disconnect()
                }
            }
        } else if (bluetoothGatt != null && writeCharacteristic != null) {
            val gatt = bluetoothGatt!!
            val ch = writeCharacteristic!!
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val writeType = if ((ch.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                gatt.writeCharacteristic(ch, bytes, writeType)
            } else {
                @Suppress("DEPRECATION")
                ch.value = bytes
                @Suppress("DEPRECATION")
                gatt.writeCharacteristic(ch)
            }
        }
    }
    
    private fun appendMessage(text: String, isSent: Boolean) {
        _messages.update { current ->
            val newMsg = TerminalMessage(text = text, isSent = isSent)
            val newList = current.toMutableList()
            // if we are receiving and the last message was also receiving and not too long ago, we could append.
            // But for simplicity of terminal, we just add new items. 
            // In a real terminal, we might buffer lines, but let's just append the raw block as a message.
            newList.add(newMsg)
            if (newList.size > 500) newList.takeLast(500) else newList
        }
    }
    
    fun clearMessages() {
        _messages.value = emptyList()
    }
}
