package com.aquasmart.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aquasmart.app.data.ble.ConnectionState
import com.aquasmart.app.data.repository.DeviceRepository
import com.aquasmart.app.domain.model.DeviceState
import com.aquasmart.app.domain.model.Schedule
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DashboardUiState(
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val deviceState: DeviceState = DeviceState(),
    val schedules: List<Schedule> = emptyList(),
    val selectedScheduleId: Int = 1,
    val isSettingSchedule: Boolean = false,
    val currentTime: String = "--:--:--"
)

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val repository: DeviceRepository
) : ViewModel() {

    private val _selectedScheduleId = MutableStateFlow(1)
    private val _isSettingSchedule = MutableStateFlow(false)

    val uiState: StateFlow<DashboardUiState> = combine(
        repository.observeConnectionState(),
        repository.observeDeviceState(),
        repository.getSchedules(),
        _selectedScheduleId,
        _isSettingSchedule
    ) { connState, devState, schedules, selectedId, isSetting ->
        val validSelectedId = if (schedules.any { it.id == selectedId }) selectedId else schedules.firstOrNull()?.id ?: 1
        
        DashboardUiState(
            connectionState = connState,
            deviceState = devState,
            schedules = schedules,
            selectedScheduleId = validSelectedId,
            isSettingSchedule = isSetting,
            currentTime = devState.deviceTime
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), DashboardUiState())

    fun toggleMaster(enabled: Boolean) {
        repository.setMasterToggle(enabled)
    }

    fun toggleValve(open: Boolean) {
        repository.toggleValve(open)
    }

    fun selectSchedule(id: Int) {
        _selectedScheduleId.value = id
    }

    fun saveSchedule(schedule: Schedule) {
        viewModelScope.launch {
            _isSettingSchedule.value = true
            repository.saveSchedule(schedule)
            _isSettingSchedule.value = false
        }
    }

    fun addNewSchedule() {
        viewModelScope.launch {
            val current = uiState.value.schedules
            val nextId = (current.maxOfOrNull { it.id } ?: 0) + 1
            val newSched = Schedule(id = nextId, label = "T$nextId", startHour = 8, startMinute = 0, durationMinutes = 15, isEnabled = false)
            repository.saveSchedule(newSched)
            _selectedScheduleId.value = nextId
        }
    }

    fun deleteSchedule(schedule: Schedule) {
        viewModelScope.launch {
            repository.deleteSchedule(schedule)
            val current = uiState.value.schedules
            if (current.isNotEmpty()) {
                _selectedScheduleId.value = current.first().id
            }
        }
    }

    fun syncAllSchedules(schedules: List<Schedule>) {
        repository.syncAllSchedules(schedules)
    }

    fun syncTime() {
        repository.syncPhoneTime()
    }

    fun disconnect() {
        repository.disconnect()
    }
}
