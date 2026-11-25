package com.aquasmart.app.domain.model

data class DeviceState(
    val isConnected: Boolean = false,
    val deviceName: String = "",
    val macAddress: String = "",
    val deviceTime: String = "--:--:--",
    val temperatureCelsius: Float = 0f,
    val isValveOpen: Boolean = false,
    val isMasterEnabled: Boolean = false
)
