package com.aquasmart.app.domain.model

data class Schedule(
    val id: Int = 0,
    val label: String = "",
    val startHour: Int = 0,
    val startMinute: Int = 0,
    val durationMinutes: Int = 0,
    val isEnabled: Boolean = false
)
