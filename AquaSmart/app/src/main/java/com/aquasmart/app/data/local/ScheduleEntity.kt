package com.aquasmart.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "schedules")
data class ScheduleEntity(
    @PrimaryKey val id: Int,
    val label: String,
    val startHour: Int,
    val startMinute: Int,
    val durationMinutes: Int,
    val isEnabled: Boolean
)
