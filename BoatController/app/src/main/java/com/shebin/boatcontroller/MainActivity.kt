package com.shebin.boatcontroller

import android.Manifest
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.annotation.SuppressLint
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.animation.OvershootInterpolator
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.*
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

class MainActivity : AppCompatActivity() {

    companion object {
        private const val REQUEST_PERMISSIONS = 1001
        // Standard SPP UUID for Bluetooth Classic serial communication
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    // UI elements
    private lateinit var tvMonitor: TextView
    private lateinit var monitorScrollView: ScrollView
    private lateinit var tvConnectionStatus: TextView
    private lateinit var statusIndicator: View
    private lateinit var btnScanConnect: MaterialButton
    private lateinit var btnToggleMode: MaterialButton
    private lateinit var btnForward: Button
    private lateinit var btnLeft: Button
    private lateinit var btnRight: Button
    private lateinit var btnUp: Button
    private lateinit var btnBack: Button

    // Bluetooth
    private var bluetoothAdapter: BluetoothAdapter? = null

    // Classic Bluetooth
    private var classicSocket: BluetoothSocket? = null
    private var classicOutputStream: OutputStream? = null
    private var classicInputStream: InputStream? = null

    // BLE
    private var bleManager: BleManager? = null

    // State
    private var isBleMode = false
    private var isConnected = false
    private val mainScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // Sound & Haptics
    private lateinit var soundPool: SoundPool
    private var pressSoundId = 0
    private var releaseSoundId = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()
        initSounds()
        initBluetooth()
        setupControlButtons()
        setupActionButtons()
    }

    private fun initSounds() {
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        soundPool = SoundPool.Builder()
            .setMaxStreams(2)
            .setAudioAttributes(audioAttributes)
            .build()

        pressSoundId = soundPool.load(this, R.raw.btn_press, 1)
        releaseSoundId = soundPool.load(this, R.raw.btn_release, 1)
    }

    private fun initViews() {
        tvMonitor = findViewById(R.id.tvMonitor)
        monitorScrollView = findViewById(R.id.monitorScrollView)
        tvConnectionStatus = findViewById(R.id.tvConnectionStatus)
        statusIndicator = findViewById(R.id.statusIndicator)
        btnScanConnect = findViewById(R.id.btnScanConnect)
        btnToggleMode = findViewById(R.id.btnToggleMode)
        btnForward = findViewById(R.id.btnForward)
        btnLeft = findViewById(R.id.btnLeft)
        btnRight = findViewById(R.id.btnRight)
        btnUp = findViewById(R.id.btnUp)
        btnBack = findViewById(R.id.btnBack)
    }

    private fun initBluetooth() {
        val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bluetoothAdapter = bluetoothManager.adapter

        if (bluetoothAdapter == null) {
            appendToMonitor("[ERROR] Bluetooth is not supported on this device.")
            btnScanConnect.isEnabled = false
            return
        }

        bleManager = BleManager(this)
        bleManager?.onDataReceived = { data ->
            runOnUiThread {
                appendToMonitor("[BLE RX] $data")
            }
        }
        bleManager?.onConnectionChanged = { connected ->
            runOnUiThread {
                isConnected = connected
                updateConnectionUI(connected, if (connected) "BLE Connected" else "BLE Disconnected")
            }
        }

        checkAndRequestPermissions()
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
            permissions.add(Manifest.permission.BLUETOOTH_SCAN)
        }
        permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION)

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), REQUEST_PERMISSIONS)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_PERMISSIONS) {
            val allGranted = grantResults.all { it == PackageManager.PERMISSION_GRANTED }
            if (!allGranted) {
                appendToMonitor("[WARN] Some permissions were denied. Bluetooth may not work properly.")
            }
        }
    }

    private fun setupActionButtons() {
        btnToggleMode.setOnClickListener {
            isBleMode = !isBleMode
            val modeText = if (isBleMode) "Mode: BLE" else "Mode: Classic"
            btnToggleMode.text = modeText
            appendToMonitor("[INFO] Switched to ${if (isBleMode) "BLE" else "Classic Bluetooth"} mode.")

            // Disconnect current connection when switching modes
            if (isConnected) {
                disconnect()
            }
        }

        btnScanConnect.setOnClickListener {
            if (isConnected) {
                disconnect()
            } else {
                startScan()
            }
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupControlButtons() {
        setupButton(btnForward, "F")
        setupButton(btnLeft, "L")
        setupButton(btnRight, "R")
        setupButton(btnUp, "U")
        setupButton(btnBack, "B")
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupButton(button: Button, command: String) {
        button.setOnTouchListener { view, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    // Subtle press sound
                    soundPool.play(pressSoundId, 0.3f, 0.3f, 1, 0, 1.0f)
                    // Haptic feedback
                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    // Press-down animation
                    animateButtonPress(view)
                    sendCommand(command)
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    // Subtle release sound (slightly higher pitch)
                    soundPool.play(releaseSoundId, 0.2f, 0.2f, 1, 0, 1.0f)
                    // Release animation (bounce back)
                    animateButtonRelease(view)
                    sendCommand("S")
                    true
                }
                else -> false
            }
        }
    }

    private fun animateButtonPress(view: View) {
        val scaleX = ObjectAnimator.ofFloat(view, "scaleX", 1f, 0.88f)
        val scaleY = ObjectAnimator.ofFloat(view, "scaleY", 1f, 0.88f)
        val alpha = ObjectAnimator.ofFloat(view, "alpha", 1f, 0.8f)
        AnimatorSet().apply {
            playTogether(scaleX, scaleY, alpha)
            duration = 100
            start()
        }
    }

    private fun animateButtonRelease(view: View) {
        val scaleX = ObjectAnimator.ofFloat(view, "scaleX", 0.88f, 1f)
        val scaleY = ObjectAnimator.ofFloat(view, "scaleY", 0.88f, 1f)
        val alpha = ObjectAnimator.ofFloat(view, "alpha", 0.8f, 1f)
        AnimatorSet().apply {
            playTogether(scaleX, scaleY, alpha)
            duration = 200
            interpolator = OvershootInterpolator(2.0f)
            start()
        }
    }

    private fun sendCommand(command: String) {
        if (!isConnected) {
            appendToMonitor("[WARN] Not connected. Command '$command' not sent.")
            return
        }

        appendToMonitor("[TX] $command")

        if (isBleMode) {
            bleManager?.sendData(command)
        } else {
            sendClassicData(command)
        }
    }

    // ==================== Classic Bluetooth ====================

    @SuppressLint("MissingPermission")
    private fun startScan() {
        val adapter = bluetoothAdapter ?: return

        if (!adapter.isEnabled) {
            appendToMonitor("[ERROR] Bluetooth is not enabled. Please enable Bluetooth.")
            Toast.makeText(this, "Please enable Bluetooth", Toast.LENGTH_SHORT).show()
            return
        }

        if (isBleMode) {
            startBleScan()
        } else {
            showPairedDevices()
        }
    }

    @SuppressLint("MissingPermission")
    private fun showPairedDevices() {
        val adapter = bluetoothAdapter ?: return
        val pairedDevices = adapter.bondedDevices?.toList() ?: emptyList()

        if (pairedDevices.isEmpty()) {
            appendToMonitor("[INFO] No paired devices found. Please pair your device first.")
            Toast.makeText(this, "No paired devices found", Toast.LENGTH_SHORT).show()
            return
        }

        appendToMonitor("[INFO] Found ${pairedDevices.size} paired device(s). Select one to connect.")
        showDeviceSelectionDialog(pairedDevices)
    }

    @SuppressLint("MissingPermission")
    private fun showDeviceSelectionDialog(devices: List<BluetoothDevice>) {
        val deviceNames = devices.map { "${it.name ?: "Unknown"}\n${it.address}" }.toTypedArray()

        AlertDialog.Builder(this, com.google.android.material.R.style.ThemeOverlay_MaterialComponents_Dialog_Alert)
            .setTitle("Select Device")
            .setItems(deviceNames) { _, which ->
                val device = devices[which]
                if (isBleMode) {
                    connectBle(device)
                } else {
                    connectClassic(device)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    @SuppressLint("MissingPermission")
    private fun connectClassic(device: BluetoothDevice) {
        appendToMonitor("[INFO] Connecting to ${device.name ?: device.address} (Classic)...")
        updateConnectionUI(false, "Connecting...")

        mainScope.launch(Dispatchers.IO) {
            try {
                // Cancel discovery to speed up connection
                bluetoothAdapter?.cancelDiscovery()

                val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                socket.connect()

                classicSocket = socket
                classicOutputStream = socket.outputStream
                classicInputStream = socket.inputStream

                withContext(Dispatchers.Main) {
                    isConnected = true
                    updateConnectionUI(true, "Classic: ${device.name ?: device.address}")
                    appendToMonitor("[INFO] Connected to ${device.name ?: device.address} (Classic)")
                }

                // Start listening for incoming data
                listenForClassicData()

            } catch (e: IOException) {
                withContext(Dispatchers.Main) {
                    isConnected = false
                    updateConnectionUI(false, "Connection Failed")
                    appendToMonitor("[ERROR] Classic connection failed: ${e.message}")
                }
            }
        }
    }

    private fun listenForClassicData() {
        mainScope.launch(Dispatchers.IO) {
            val buffer = ByteArray(1024)
            while (isConnected && classicInputStream != null) {
                try {
                    val bytes = classicInputStream?.read(buffer) ?: break
                    if (bytes > 0) {
                        val data = String(buffer, 0, bytes)
                        withContext(Dispatchers.Main) {
                            appendToMonitor("[Classic RX] $data")
                        }
                    }
                } catch (e: IOException) {
                    if (isConnected) {
                        withContext(Dispatchers.Main) {
                            disconnect()
                            appendToMonitor("[INFO] Classic connection lost.")
                        }
                    }
                    break
                }
            }
        }
    }

    private fun sendClassicData(data: String) {
        mainScope.launch(Dispatchers.IO) {
            try {
                classicOutputStream?.write(data.toByteArray())
                classicOutputStream?.flush()
            } catch (e: IOException) {
                withContext(Dispatchers.Main) {
                    appendToMonitor("[ERROR] Failed to send: ${e.message}")
                    disconnect()
                }
            }
        }
    }

    // ==================== BLE ====================

    @SuppressLint("MissingPermission")
    private fun startBleScan() {
        appendToMonitor("[INFO] Scanning for BLE devices...")
        bleManager?.startScan { devices ->
            runOnUiThread {
                if (devices.isEmpty()) {
                    appendToMonitor("[INFO] No BLE devices found.")
                    Toast.makeText(this, "No BLE devices found", Toast.LENGTH_SHORT).show()
                } else {
                    appendToMonitor("[INFO] Found ${devices.size} BLE device(s).")
                    showDeviceSelectionDialog(devices)
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun connectBle(device: BluetoothDevice) {
        appendToMonitor("[INFO] Connecting to ${device.name ?: device.address} (BLE)...")
        updateConnectionUI(false, "Connecting...")
        bleManager?.connect(device)
    }

    // ==================== Common ====================

    private fun disconnect() {
        if (isBleMode) {
            bleManager?.disconnect()
        } else {
            try {
                classicInputStream?.close()
                classicOutputStream?.close()
                classicSocket?.close()
            } catch (e: IOException) {
                // Ignore
            }
            classicSocket = null
            classicOutputStream = null
            classicInputStream = null
        }
        isConnected = false
        updateConnectionUI(false, "Disconnected")
        appendToMonitor("[INFO] Disconnected.")
    }

    private fun updateConnectionUI(connected: Boolean, statusText: String) {
        tvConnectionStatus.text = statusText
        if (connected) {
            tvConnectionStatus.setTextColor(ContextCompat.getColor(this, R.color.status_connected))
            statusIndicator.setBackgroundResource(R.drawable.status_indicator_connected)
            btnScanConnect.text = "Disconnect"
        } else {
            tvConnectionStatus.setTextColor(ContextCompat.getColor(this, R.color.status_disconnected))
            statusIndicator.setBackgroundResource(R.drawable.status_indicator_disconnected)
            btnScanConnect.text = "Scan & Connect"
        }
    }

    private fun appendToMonitor(message: String) {
        tvMonitor.append("$message\n")
        monitorScrollView.post {
            monitorScrollView.fullScroll(View.FOCUS_DOWN)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        disconnect()
        soundPool.release()
        mainScope.cancel()
    }
}
