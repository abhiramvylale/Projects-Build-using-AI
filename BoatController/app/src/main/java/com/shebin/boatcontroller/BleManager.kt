package com.shebin.boatcontroller

import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.UUID

/**
 * BleManager handles all Bluetooth Low Energy (BLE) operations
 * including scanning, connecting, sending data, and receiving data.
 *
 * Typical BLE modules (HM-10, ESP32, etc.) use the following service/characteristic UUIDs.
 * If your module uses different UUIDs, update them here.
 */
class BleManager(private val context: Context) {

    companion object {
        // Common BLE UART service UUID (HM-10 / CC2541 compatible)
        private val SERVICE_UUID = UUID.fromString("0000FFE0-0000-1000-8000-00805F9B34FB")
        // Common BLE UART characteristic UUID
        private val CHARACTERISTIC_UUID = UUID.fromString("0000FFE1-0000-1000-8000-00805F9B34FB")
        // Client Characteristic Configuration Descriptor
        private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB")

        private const val SCAN_TIMEOUT_MS = 10000L // 10 seconds
    }

    // Callbacks
    var onDataReceived: ((String) -> Unit)? = null
    var onConnectionChanged: ((Boolean) -> Unit)? = null

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager.adapter
    private var bleScanner: BluetoothLeScanner? = null
    private var bluetoothGatt: BluetoothGatt? = null
    private var writeCharacteristic: BluetoothGattCharacteristic? = null
    private val handler = Handler(Looper.getMainLooper())

    private val scannedDevices = mutableListOf<BluetoothDevice>()
    private val scannedAddresses = mutableSetOf<String>()

    // ==================== Scanning ====================

    @SuppressLint("MissingPermission")
    fun startScan(onComplete: (List<BluetoothDevice>) -> Unit) {
        val adapter = bluetoothAdapter ?: run {
            onComplete(emptyList())
            return
        }

        bleScanner = adapter.bluetoothLeScanner
        if (bleScanner == null) {
            onComplete(emptyList())
            return
        }

        scannedDevices.clear()
        scannedAddresses.clear()

        val scanCallback = object : ScanCallback() {
            @SuppressLint("MissingPermission")
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device
                val address = device.address
                if (address !in scannedAddresses) {
                    scannedAddresses.add(address)
                    scannedDevices.add(device)
                }
            }

            override fun onScanFailed(errorCode: Int) {
                handler.post { onComplete(emptyList()) }
            }
        }

        bleScanner?.startScan(scanCallback)

        // Stop scan after timeout
        handler.postDelayed({
            bleScanner?.stopScan(scanCallback)
            onComplete(scannedDevices.toList())
        }, SCAN_TIMEOUT_MS)
    }

    // ==================== Connection ====================

    @SuppressLint("MissingPermission")
    fun connect(device: BluetoothDevice) {
        bluetoothGatt?.close()
        bluetoothGatt = device.connectGatt(context, false, gattCallback)
    }

    @SuppressLint("MissingPermission")
    fun disconnect() {
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
        writeCharacteristic = null
        onConnectionChanged?.invoke(false)
    }

    private val gattCallback = object : BluetoothGattCallback() {

        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothGatt.STATE_CONNECTED -> {
                    gatt.discoverServices()
                }
                BluetoothGatt.STATE_DISCONNECTED -> {
                    handler.post {
                        writeCharacteristic = null
                        onConnectionChanged?.invoke(false)
                    }
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                val service = gatt.getService(SERVICE_UUID)
                if (service != null) {
                    val characteristic = service.getCharacteristic(CHARACTERISTIC_UUID)
                    if (characteristic != null) {
                        writeCharacteristic = characteristic

                        // Enable notifications for receiving data
                        gatt.setCharacteristicNotification(characteristic, true)
                        val descriptor = characteristic.getDescriptor(CCCD_UUID)
                        if (descriptor != null) {
                            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            gatt.writeDescriptor(descriptor)
                        }

                        handler.post { onConnectionChanged?.invoke(true) }
                    } else {
                        handler.post {
                            onConnectionChanged?.invoke(false)
                        }
                    }
                } else {
                    // Try to find any writable characteristic
                    findWritableCharacteristic(gatt)
                }
            }
        }

        @Deprecated("Deprecated in API 33, but needed for backward compatibility")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            val data = characteristic.value?.let { String(it) } ?: return
            handler.post { onDataReceived?.invoke(data) }
        }
    }

    @SuppressLint("MissingPermission")
    private fun findWritableCharacteristic(gatt: BluetoothGatt) {
        for (service in gatt.services) {
            for (char in service.characteristics) {
                val props = char.properties
                if (props and BluetoothGattCharacteristic.PROPERTY_WRITE != 0 ||
                    props and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0
                ) {
                    writeCharacteristic = char

                    // Also try to enable notifications if supported
                    if (props and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) {
                        gatt.setCharacteristicNotification(char, true)
                        val descriptor = char.getDescriptor(CCCD_UUID)
                        if (descriptor != null) {
                            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            gatt.writeDescriptor(descriptor)
                        }
                    }

                    handler.post { onConnectionChanged?.invoke(true) }
                    return
                }
            }
        }
        handler.post { onConnectionChanged?.invoke(false) }
    }

    // ==================== Data Transmission ====================

    @SuppressLint("MissingPermission")
    fun sendData(data: String) {
        val characteristic = writeCharacteristic ?: return
        val gatt = bluetoothGatt ?: return

        characteristic.value = data.toByteArray()

        // Use WRITE_NO_RESPONSE for faster control commands
        val props = characteristic.properties
        characteristic.writeType = if (props and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) {
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        } else {
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        }

        gatt.writeCharacteristic(characteristic)
    }
}
