package com.aquasmart.app.domain.model.terminal

data class TerminalMessage(
    val id: Long = System.currentTimeMillis(),
    val text: String,
    val isSent: Boolean,
    val timestamp: Long = System.currentTimeMillis()
)
