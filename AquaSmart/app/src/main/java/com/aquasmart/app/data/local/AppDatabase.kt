package com.aquasmart.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(entities = [ScheduleEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun scheduleDao(): ScheduleDao
}
