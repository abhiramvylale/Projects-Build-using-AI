package com.aquasmart.app.data.repository

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.aquasmart.app.data.ble.BluetoothDeviceModel
import com.aquasmart.app.data.ble.BleManager
import com.aquasmart.app.data.ble.ConnectionState
import com.aquasmart.app.data.local.ScheduleDao
import com.aquasmart.app.data.local.ScheduleEntity
import com.aquasmart.app.domain.model.DeviceState
import com.aquasmart.app.domain.model.Schedule
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DeviceRepository @Inject constructor(
    private val bleManager: BleManager,
    private val scheduleDao: ScheduleDao,
    private val dataStore: DataStore<Preferences>
) {
    companion object {
        private val LAST_CONNECTED_DEVICE_KEY = stringPreferencesKey("last_connected_device")
    }

    fun observeConnectionState(): Flow<ConnectionState> = bleManager.connectionState

    fun observeScannedDevices(): Flow<List<BluetoothDeviceModel>> = bleManager.scannedDevices

    fun startScan() {
        bleManager.startScan()
    }

    fun stopScan() {
        bleManager.stopScan()
    }

    fun connectToDevice(device: BluetoothDeviceModel) {
        bleManager.connect(device)
    }

    fun observeDeviceState(): Flow<DeviceState> = bleManager.deviceState

    fun disconnect() {
        bleManager.disconnect()
    }

    fun toggleValve(open: Boolean) {
        bleManager.toggleValve(open)
    }

    fun setMasterToggle(enabled: Boolean) {
        bleManager.setMasterToggle(enabled)
    }

    suspend fun saveSchedule(schedule: Schedule) {
        scheduleDao.insert(
            ScheduleEntity(
                id = schedule.id,
                label = schedule.label,
                startHour = schedule.startHour,
                startMinute = schedule.startMinute,
                durationMinutes = schedule.durationMinutes,
                isEnabled = schedule.isEnabled
            )
        )
        bleManager.sendSchedule(schedule)
    }

    suspend fun deleteSchedule(schedule: Schedule) {
        scheduleDao.delete(
            ScheduleEntity(
                id = schedule.id,
                label = schedule.label,
                startHour = schedule.startHour,
                startMinute = schedule.startMinute,
                durationMinutes = schedule.durationMinutes,
                isEnabled = false
            )
        )
        bleManager.sendSchedule(schedule.copy(isEnabled = false))
    }

    fun getSchedules(): Flow<List<Schedule>> {
        return scheduleDao.getAll().map { entities ->
            if (entities.isEmpty()) {
                listOf(
                    Schedule(id = 1, label = "T1", startHour = 6, startMinute = 0, durationMinutes = 30, isEnabled = true)
                )
            } else {
                entities.map { entity ->
                    Schedule(
                        id = entity.id,
                        label = entity.label,
                        startHour = entity.startHour,
                        startMinute = entity.startMinute,
                        durationMinutes = entity.durationMinutes,
                        isEnabled = entity.isEnabled
                    )
                }
            }
        }
    }

    fun syncAllSchedules(schedules: List<Schedule>) {
        bleManager.syncAllSchedules(schedules)
    }

    fun syncPhoneTime() {
        bleManager.syncPhoneTime()
    }

    suspend fun saveLastConnectedDevice(address: String) {
        dataStore.edit { preferences ->
            preferences[LAST_CONNECTED_DEVICE_KEY] = address
        }
    }

    suspend fun getLastConnectedDevice(): String? {
        val preferences = dataStore.data.first()
        return preferences[LAST_CONNECTED_DEVICE_KEY]
    }
}
