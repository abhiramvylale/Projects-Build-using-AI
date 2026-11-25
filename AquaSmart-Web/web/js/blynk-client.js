/**
 * AquaSmart Irrigation — Firebase Realtime Cloud Bridge & State Manager (Replaced Blynk)
 *
 * Syncs each customer's assigned ESP32-C3 machine via Firebase Realtime Database REST API:
 *   GET / PATCH  https://<project-id>-default-rtdb.firebaseio.com/aquasmart/machines/<machineId>.json
 *
 * Unlimited devices supported on Firebase Free Tier (no 2-device limit).
 */

import {
  getFirebaseConfig,
  saveFirebaseConfig,
  DEFAULT_FIREBASE_CONFIG,
} from './firebase-config.js';

export const DEFAULT_BLYNK_CONFIG = {
  databaseUrl: DEFAULT_FIREBASE_CONFIG.databaseUrl,
  projectId: DEFAULT_FIREBASE_CONFIG.projectId,
  machineId: DEFAULT_FIREBASE_CONFIG.defaultMachineId,
  deviceName: DEFAULT_FIREBASE_CONFIG.defaultDeviceName,
  pollIntervalMs: 2000,
  simulatorMode: false,
};

export const PINS = {
  MASTER_SWITCH: 'master',         // 0 or 1 (System Master Switch)
  VALVE_RELAY: 'valve',            // 0 or 1 (GPIO 3 Relay Valve Open/Close)
  TEMPERATURE: 'temp',             // Float (°C)
  DEVICE_TIME: 'time',             // String ("HH:mm:ss")
  SCHEDULES_JSON: 'schedulesJson', // JSON string of schedules
  TERMINAL_LOG: 'terminalTx',      // String command / terminal log
};

const STORAGE_KEY_SCHEDULES_PREFIX = 'aquasmart_schedules_v2_';

const DEFAULT_SCHEDULES = [
  { id: 1, label: 'T1', startHour: 8, startMinute: 0, durationMinutes: 15, isEnabled: false },
  { id: 2, label: 'T2', startHour: 18, startMinute: 0, durationMinutes: 20, isEnabled: false },
];

export class BlynkClient {
  constructor() {
    const fbCfg = getFirebaseConfig();
    this.config = {
      ...DEFAULT_BLYNK_CONFIG,
      databaseUrl: fbCfg.databaseUrl,
      projectId: fbCfg.projectId,
    };
    this.listeners = new Set();
    this.pollTimer = null;
    this.simClockTimer = null;
    this.lastReceivedRxId = 0;
    this.lastReceivedRxText = '';
    this.lastObservedHeartbeatSeq = null;
    this.lastHeartbeatLocalMs = 0;

    const initialSchedules = this._loadSchedules(this.config.machineId);

    this.state = {
      connectionState: 'DISCONNECTED', // 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'
      isHardwareOnline: false,
      isSimulator: false,
      deviceName: this.config.deviceName || 'AquaSmart Controller',
      machineId: this.config.machineId || 'AQ-ESP32-001',
      databaseUrl: this.config.databaseUrl || '',
      lastSyncTime: null,
      lastError: null,

      // Device telemetry
      isMasterEnabled: true,
      isValveOpen: false,
      temperatureCelsius: 26.4,
      deviceTime: '--:--:--',

      // Datastream snapshot for diagnostics
      pins: {
        V0: 1,
        V1: 0,
        V2: 26.4,
        V3: '--:--:--',
        V4: JSON.stringify(initialSchedules),
        V5: '',
      },

      // Schedules
      schedules: initialSchedules,
      selectedScheduleId: initialSchedules[0]?.id || 1,
      isSettingSchedule: false,

      // Terminal state
      messages: [],
      isHexMode: false,
      newlineMode: '\r\n',
    };
  }

  _getScheduleStorageKey(machineId) {
    const clean = String(machineId || DEFAULT_BLYNK_CONFIG.machineId).trim();
    return `${STORAGE_KEY_SCHEDULES_PREFIX}${clean}`;
  }

  /**
   * Binds the client cleanly to a logged-in customer's assigned Machine ID and Firebase URL.
   */
  bindAccount({ machineId, deviceName, databaseUrl }) {
    const fbCfg = getFirebaseConfig();
    const nextMachineId = String(machineId || DEFAULT_BLYNK_CONFIG.machineId).trim();
    const nextName = String(deviceName || 'AquaSmart Irrigation').trim();
    const nextDbUrl = String(databaseUrl || fbCfg.databaseUrl || '')
      .trim()
      .replace(/\/+$/, '');

    this.stopPolling();
    this.config = {
      ...this.config,
      databaseUrl: nextDbUrl,
      machineId: nextMachineId,
      deviceName: nextName,
      simulatorMode: false,
    };

    const userSchedules = this._loadSchedules(nextMachineId);
    this.lastReceivedRxId = 0;
    this.lastReceivedRxText = '';
    this.lastObservedHeartbeatSeq = null;
    this.lastHeartbeatLocalMs = 0;

    this.state = {
      ...this.state,
      connectionState: 'CONNECTING',
      isHardwareOnline: false,
      isSimulator: false,
      deviceName: nextName,
      machineId: nextMachineId,
      databaseUrl: nextDbUrl,
      lastSyncTime: null,
      lastError: null,
      isMasterEnabled: true,
      isValveOpen: false,
      deviceTime: '--:--:--',
      pins: {
        V0: 1,
        V1: 0,
        V2: this.state.temperatureCelsius,
        V3: '--:--:--',
        V4: JSON.stringify(userSchedules),
        V5: '',
      },
      schedules: userSchedules,
      selectedScheduleId: userSchedules[0]?.id || 1,
      isSettingSchedule: false,
      messages: [],
    };

    this.startPolling();
  }

  saveConfig(newConfig) {
    const machineChanged =
      newConfig.machineId !== undefined && newConfig.machineId !== this.config.machineId;

    if (newConfig.databaseUrl !== undefined) {
      saveFirebaseConfig({ databaseUrl: newConfig.databaseUrl });
    }

    const fbCfg = getFirebaseConfig();
    this.config = {
      ...this.config,
      ...newConfig,
      databaseUrl: fbCfg.databaseUrl,
    };

    this.state.isSimulator = Boolean(this.config.simulatorMode);
    this.state.deviceName = this.config.deviceName || 'AquaSmart Controller';
    this.state.machineId = this.config.machineId || 'AQ-ESP32-001';
    this.state.databaseUrl = this.config.databaseUrl || '';

    if (machineChanged) {
      this.lastObservedHeartbeatSeq = null;
      this.lastHeartbeatLocalMs = 0;
      const scopedSchedules = this._loadSchedules(this.config.machineId);
      this.state.schedules = scopedSchedules;
      this.state.selectedScheduleId = scopedSchedules[0]?.id || 1;
      this.state.pins.V4 = JSON.stringify(scopedSchedules);
    }

    this.appendMessage(
      `SYS: Config updated (${
        this.state.isSimulator
          ? 'Simulator Mode'
          : `Firebase Cloud — Machine ${this.state.machineId}`
      })`,
      false
    );
    this.restartPolling();
  }

  _loadSchedules(machineId = this.config?.machineId) {
    try {
      const saved = localStorage.getItem(this._getScheduleStorageKey(machineId));
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {
      // ignore
    }
    return structuredClone(DEFAULT_SCHEDULES);
  }

  _persistSchedules(schedules) {
    this.state.schedules = schedules;
    this.state.pins.V4 = JSON.stringify(schedules);
    try {
      localStorage.setItem(
        this._getScheduleStorageKey(this.config.machineId),
        JSON.stringify(schedules)
      );
    } catch (_) {
      // ignore
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.state);
    return () => this.listeners.delete(callback);
  }

  _notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  appendMessage(text, isSent = false, isError = false) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: String(text),
      isSent,
      isError,
      timestamp: new Date(),
    };
    const next = [...this.state.messages, entry];
    this.state.messages = next.length > 500 ? next.slice(next.length - 500) : next;
    this._notify();
  }

  clearMessages() {
    this.state.messages = [];
    this._notify();
  }

  // =========================================================================
  // Polling & Simulator Loop
  // =========================================================================

  startPolling() {
    this.stopPolling();
    this.state.connectionState = 'CONNECTING';
    this._notify();

    if (this.config.simulatorMode) {
      this._startSimulator();
      return;
    }

    this.pollOnce();
    this.pollTimer = setInterval(() => this.pollOnce(), this.config.pollIntervalMs);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.simClockTimer) {
      clearInterval(this.simClockTimer);
      this.simClockTimer = null;
    }
  }

  restartPolling() {
    this.stopPolling();
    this.startPolling();
  }

  _startSimulator() {
    this.state.connectionState = 'CONNECTED';
    this.state.isHardwareOnline = true;
    this.state.lastError = null;
    this.appendMessage(
      `SYS: Virtual ESP32-C3 Simulator Ready (Machine ID: ${this.state.machineId})`,
      false
    );

    const tick = () => {
      const nowStr = new Date().toTimeString().split(' ')[0];
      const jitter = (Math.sin(Date.now() / 10000) * 0.4).toFixed(1);
      const temp = Number((26.5 + Number(jitter)).toFixed(1));
      this.state.deviceTime = nowStr;
      this.state.temperatureCelsius = temp;
      this.state.pins.V2 = temp;
      this.state.pins.V3 = nowStr;
      this.state.lastSyncTime = new Date();
      this._notify();
    };
    tick();
    this.simClockTimer = setInterval(tick, 1000);
  }

  async pollOnce() {
    if (this.config.simulatorMode) return;

    const fbCfg = getFirebaseConfig();
    const dbUrl = (this.config.databaseUrl || fbCfg.databaseUrl || '').trim().replace(/\/+$/, '');
    this.state.databaseUrl = dbUrl;
    const machineId = (this.config.machineId || 'AQ-ESP32-001').trim();

    if (!dbUrl) {
      const wasConnecting = this.state.connectionState === 'CONNECTING';
      this.state.connectionState = 'DISCONNECTED';
      this.state.isHardwareOnline = false;
      this.state.lastError = 'Firebase Database URL not configured yet (set in Operator Console)';
      if (wasConnecting) {
        this.appendMessage(
          'SYS: Ready for Firebase Cloud URL (or click "Switch to Simulator Mode" to test offline)',
          false
        );
      }
      this._notify();
      return;
    }

    try {
      const res = await fetch(
        `${dbUrl}/aquasmart/machines/${encodeURIComponent(machineId)}.json`,
        { cache: 'no-store' }
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Firebase HTTP ${res.status}`);
      }

      const data = await res.json();
      const now = Date.now();

      // If this machine node hasn't been created in Firebase yet, initialize it once
      if (!data) {
        const initialPayload = {
          info: {
            machineId,
            deviceName: this.state.deviceName,
            lastSeenEpochMs: 0,
            heartbeatSeq: 0,
          },
          state: {
            master: this.state.isMasterEnabled ? 1 : 0,
            valve: this.state.isValveOpen ? 1 : 0,
            temp: this.state.temperatureCelsius,
            time: this.state.deviceTime,
            schedulesJson: JSON.stringify(this.state.schedules),
            schedulesRev: 1,
            terminalRx: '',
            terminalRxId: 0,
            terminalTx: '',
            terminalTxId: 0,
          },
        };
        await fetch(`${dbUrl}/aquasmart/machines/${encodeURIComponent(machineId)}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(initialPayload),
        });
      }

      const info = data?.info || {};
      const st = data?.state || {};

      // Dual online detection: Firebase Server Timestamp ({".sv":"timestamp"}) + monotonic heartbeatSeq
      const lastSeen = Number(info.lastSeenEpochMs || 0);
      const seq = Number(info.heartbeatSeq || 0);
      if (seq > 0) {
        if (this.lastObservedHeartbeatSeq === null) {
          this.lastObservedHeartbeatSeq = seq;
        } else if (seq !== this.lastObservedHeartbeatSeq) {
          this.lastObservedHeartbeatSeq = seq;
          this.lastHeartbeatLocalMs = now;
        }
      }
      const seqFresh = this.lastHeartbeatLocalMs > 0 && now - this.lastHeartbeatLocalMs < 15000;
      const timestampFresh = lastSeen > 0 && now - lastSeen < 25000 && lastSeen - now < 60000;
      const isOnline = Boolean(seqFresh || timestampFresh);

      if (st.master !== undefined) {
        this.state.isMasterEnabled = Number(st.master) === 1;
        this.state.pins.V0 = Number(st.master) === 1 ? 1 : 0;
      }

      if (st.valve !== undefined) {
        this.state.isValveOpen = Number(st.valve) === 1;
        this.state.pins.V1 = Number(st.valve) === 1 ? 1 : 0;
      }

      if (st.temp !== undefined) {
        const parsedTemp = parseFloat(st.temp);
        if (!Number.isNaN(parsedTemp)) {
          this.state.temperatureCelsius = parsedTemp;
          this.state.pins.V2 = parsedTemp;
        }
      }

      if (st.time && st.time !== '--:--:--') {
        this.state.deviceTime = String(st.time);
        this.state.pins.V3 = String(st.time);
      }

      if (st.schedulesJson && !this.state.isSettingSchedule) {
        try {
          const remoteSchedules =
            typeof st.schedulesJson === 'string'
              ? JSON.parse(st.schedulesJson)
              : st.schedulesJson;
          if (Array.isArray(remoteSchedules) && remoteSchedules.length > 0) {
            this._persistSchedules(remoteSchedules);
          }
        } catch (_) {
          // ignore invalid JSON
        }
      }

      const rxText = String(st.terminalRx || '').trim();
      const rxId = Number(st.terminalRxId || 0);
      if (
        rxText &&
        (rxId !== this.lastReceivedRxId || (rxId === 0 && rxText !== this.lastReceivedRxText))
      ) {
        // Skip replaying stale historical terminalRx message on initial page open unless rxId changes
        const isFirstPollSnapshot = this.state.connectionState !== 'CONNECTED';
        this.lastReceivedRxId = rxId || Date.now();
        this.lastReceivedRxText = rxText;
        this.state.pins.V5 = rxText;
        if (!isFirstPollSnapshot) {
          this.appendMessage(rxText, false);
          this.parseUartLine(rxText);
        }
      }

      const prevState = this.state.connectionState;
      const prevHwOnline = this.state.isHardwareOnline;
      this.state.isHardwareOnline = isOnline;
      this.state.connectionState = 'CONNECTED';
      this.state.lastSyncTime = new Date();
      this.state.lastError = null;

      if (prevState !== 'CONNECTED' || prevHwOnline !== isOnline) {
        this.appendMessage(
          `SYS: Firebase Cloud synced (${machineId}) — ESP32-C3 is ${
            isOnline ? 'ONLINE' : 'OFFLINE'
          }`,
          false
        );
      }
      this._notify();
    } catch (err) {
      this.state.connectionState = 'DISCONNECTED';
      this.state.isHardwareOnline = false;
      this.state.lastError = err.message || 'Failed to reach Firebase Cloud';
      this._notify();
    }
  }

  async _patchMachineState(patchObj, logText) {
    this.appendMessage(logText, true);

    if (this.config.simulatorMode) {
      this._applyLocalPatch(patchObj);
      setTimeout(() => {
        this.appendMessage(`OK (Sim): ${logText}`, false);
      }, 80);
      return true;
    }

    const fbCfg = getFirebaseConfig();
    const dbUrl = (this.config.databaseUrl || fbCfg.databaseUrl || '').trim().replace(/\/+$/, '');
    const machineId = (this.config.machineId || 'AQ-ESP32-001').trim();

    if (!dbUrl) {
      this._applyLocalPatch(patchObj);
      this.appendMessage(
        `LOCAL-ACK: ${logText} (Set Firebase Database URL in Operator Console for cloud sync)`,
        false
      );
      return true;
    }

    try {
      const res = await fetch(
        `${dbUrl}/aquasmart/machines/${encodeURIComponent(machineId)}/state.json`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchObj),
        }
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(errBody || `HTTP ${res.status}`);
      }

      this._applyLocalPatch(patchObj);
      this.appendMessage(`ACK: ${logText}`, false);
      return true;
    } catch (err) {
      this.appendMessage(`ERR: ${err.message}`, false, true);
      this.state.lastError = err.message;
      this._notify();
      return false;
    }
  }

  _applyLocalPatch(patchObj) {
    if (patchObj.master !== undefined) {
      this.state.isMasterEnabled = Number(patchObj.master) === 1;
      this.state.pins.V0 = Number(patchObj.master) === 1 ? 1 : 0;
    }
    if (patchObj.valve !== undefined) {
      this.state.isValveOpen = Number(patchObj.valve) === 1;
      this.state.pins.V1 = Number(patchObj.valve) === 1 ? 1 : 0;
    }
    if (patchObj.temp !== undefined) {
      this.state.temperatureCelsius = parseFloat(patchObj.temp) || 0;
      this.state.pins.V2 = this.state.temperatureCelsius;
    }
    if (patchObj.time !== undefined) {
      this.state.deviceTime = String(patchObj.time);
      this.state.pins.V3 = this.state.deviceTime;
    }
    if (patchObj.schedulesJson !== undefined) {
      this.state.pins.V4 = patchObj.schedulesJson;
    }
    if (patchObj.terminalTx !== undefined) {
      this.state.pins.V5 = patchObj.terminalTx;
    }
    this._notify();
  }

  async writePin(pin, value, commandLabel = null) {
    const logText = commandLabel || `${pin}=${value}`;
    if (pin === PINS.TERMINAL_LOG) {
      return this._patchMachineState(
        { terminalTx: String(value).trim(), terminalTxId: Date.now() },
        logText
      );
    }
    return this._patchMachineState({ [pin]: value }, logText);
  }

  // =========================================================================
  // UART Line Parser
  // =========================================================================

  parseUartLine(line) {
    if (!line) return;

    const timeMatch = line.match(/(?:TIME:?\s*)?([0-2]?[0-9]:[0-5][0-9](?::[0-5][0-9])?)/i);
    if (
      timeMatch &&
      (/TIME/i.test(line) || /^[0-2]?[0-9]:[0-5][0-9](?::[0-5][0-9])?$/.test(line.trim()))
    ) {
      const extracted = timeMatch[1];
      const fullTime = (extracted.match(/:/g) || []).length === 1 ? `${extracted}:00` : extracted;
      this.state.deviceTime = fullTime;
      this.state.pins.V3 = fullTime;
    }

    const tempMatch = line.match(/TEMP:?\s*(-?\d+(?:\.\d+)?)/i);
    if (tempMatch && (/TEMP/i.test(line) || /C$/i.test(line.trim()))) {
      const temp = parseFloat(tempMatch[1]);
      if (!Number.isNaN(temp)) {
        this.state.temperatureCelsius = temp;
        this.state.pins.V2 = temp;
      }
    }

    if (/RELAY:\s*ON|VALVE:\s*ON/i.test(line)) {
      this.state.isValveOpen = true;
      this.state.pins.V1 = 1;
    } else if (/RELAY:\s*OFF|VALVE:\s*OFF/i.test(line)) {
      this.state.isValveOpen = false;
      this.state.pins.V1 = 0;
    }

    if (/SYS:\s*ACTIVE|MASTER:\s*ON|MASTER:\s*1/i.test(line)) {
      this.state.isMasterEnabled = true;
      this.state.pins.V0 = 1;
    } else if (/SYS:\s*OFF|MASTER:\s*OFF|MASTER:\s*0/i.test(line)) {
      this.state.isMasterEnabled = false;
      this.state.pins.V0 = 0;
    }

    this._notify();
  }

  // =========================================================================
  // High-Level AquaSmart Actions
  // =========================================================================

  async setMasterToggle(enabled) {
    const val = enabled ? 1 : 0;
    const cmd = enabled ? 'MASTER:ON' : 'MASTER:OFF';
    const patch = { master: val };
    if (!enabled && this.state.isValveOpen) {
      patch.valve = 0;
    }
    return this._patchMachineState(patch, cmd);
  }

  async toggleValve(open) {
    const val = open ? 1 : 0;
    const cmd = open ? 'RELAY:ON' : 'RELAY:OFF';
    return this._patchMachineState({ valve: val }, cmd);
  }

  async syncBrowserTime() {
    const now = new Date().toTimeString().split(' ')[0];
    return this._patchMachineState(
      { time: now, terminalTx: `TIME:${now}`, terminalTxId: Date.now() },
      `TIME:${now}`
    );
  }

  // =========================================================================
  // Irrigation Schedule Engine (Atomic Cloud Sync via schedulesJson + schedulesRev)
  // =========================================================================

  selectSchedule(id) {
    this.state.selectedScheduleId = Number(id);
    this._notify();
  }

  addNewSchedule() {
    const current = this.state.schedules;
    if (current.length >= 8) {
      this.appendMessage('ERR: Maximum 8 hardware timer slots (T1–T8) supported.', false, true);
      return null;
    }
    const usedIds = new Set(current.map((s) => s.id));
    let nextId = 1;
    while (usedIds.has(nextId)) nextId++;

    const newSched = {
      id: nextId,
      label: `T${nextId}`,
      startHour: 8,
      startMinute: 0,
      durationMinutes: 15,
      isEnabled: false,
    };
    const updated = [...current, newSched].sort((a, b) => a.id - b.id);
    this._persistSchedules(updated);
    this.state.selectedScheduleId = nextId;
    this.appendMessage(`SYS: Added timer schedule ${newSched.label}`, false);
    this._notify();
    return newSched;
  }

  _formatScheduleSummary(schedule) {
    const pad = (n) => String(n).padStart(2, '0');
    if (!schedule.isEnabled) {
      return `${schedule.label}:DISABLE`;
    }
    const endTotalMin = schedule.startMinute + schedule.durationMinutes;
    const endHour = (schedule.startHour + Math.floor(endTotalMin / 60)) % 24;
    const endMin = endTotalMin % 60;
    return `${schedule.label}ON:${pad(schedule.startHour)}:${pad(schedule.startMinute)}:00 → ${
      schedule.label
    }OFF:${pad(endHour)}:${pad(endMin)}:00`;
  }

  async deleteSchedule(id) {
    if (this.state.schedules.length <= 1) {
      this.appendMessage('ERR: At least one timer schedule must remain.', false, true);
      return;
    }
    const target = this.state.schedules.find((s) => s.id === id);
    const updated = this.state.schedules.filter((s) => s.id !== id);
    this._persistSchedules(updated);
    if (this.state.selectedScheduleId === id) {
      this.state.selectedScheduleId = updated[0].id;
    }
    await this._patchMachineState(
      {
        schedulesJson: JSON.stringify(updated),
        schedulesRev: Date.now(),
      },
      `DELETE_TIMER (${target ? target.label : id} disabled & removed)`
    );
    this._notify();
  }

  async saveSchedule(schedule) {
    this.state.isSettingSchedule = true;
    this._notify();

    try {
      const updated = this.state.schedules.map((s) =>
        s.id === schedule.id ? { ...schedule } : s
      );
      if (!updated.some((s) => s.id === schedule.id)) {
        updated.push({ ...schedule });
      }
      this._persistSchedules(updated);

      const summary = this._formatScheduleSummary(schedule);
      await this._patchMachineState(
        {
          schedulesJson: JSON.stringify(updated),
          schedulesRev: Date.now(),
        },
        `SAVE_TIMER (${summary})`
      );
    } finally {
      this.state.isSettingSchedule = false;
      this._notify();
    }
  }

  async syncAllSchedules() {
    if (this.state.isSettingSchedule) return;
    this.state.isSettingSchedule = true;
    this._notify();

    try {
      await this._patchMachineState(
        {
          schedulesJson: JSON.stringify(this.state.schedules),
          schedulesRev: Date.now(),
        },
        `FIREBASE_SYNC_ALL (${this.state.schedules.length} timers synced to NVS)`
      );
    } finally {
      this.state.isSettingSchedule = false;
      this._notify();
    }
  }

  // =========================================================================
  // Terminal Screen Actions
  // =========================================================================

  toggleHexMode(enabled) {
    this.state.isHexMode = Boolean(enabled);
    this._notify();
  }

  cycleNewlineMode() {
    const order = ['\r\n', '\n', '\r', ''];
    const idx = order.indexOf(this.state.newlineMode);
    this.state.newlineMode = order[(idx + 1) % order.length];
    this._notify();
  }

  async sendTerminalCommand(rawInput) {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) return;

    let decodedText = trimmed;
    let displayLabel = trimmed;

    if (this.state.isHexMode) {
      const cleanHex = trimmed.replace(/\s+/g, '');
      if (cleanHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleanHex)) {
        this.appendMessage('Error: Invalid Hex (use pairs like 41 54 0D 0A)', true, true);
        return;
      }
      const bytes = cleanHex.match(/.{1,2}/g).map((b) => parseInt(b, 16));
      decodedText = String.fromCharCode(...bytes).trim();
      const formattedHex = cleanHex.toUpperCase().match(/.{1,2}/g).join(' ');
      displayLabel = `[HEX] ${formattedHex}`;
    } else if (this.state.newlineMode) {
      const escapedEnding = this.state.newlineMode.replace('\r', '\\r').replace('\n', '\\n');
      displayLabel = `${trimmed} (${escapedEnding})`;
    }

    const upper = decodedText.toUpperCase();

    if (upper === 'MASTER:ON' || upper === 'MASTER:1') {
      await this.setMasterToggle(true);
      return;
    }
    if (upper === 'MASTER:OFF' || upper === 'MASTER:0') {
      await this.setMasterToggle(false);
      return;
    }
    if (upper === 'RELAY:ON' || upper === 'VALVE:ON') {
      await this.toggleValve(true);
      return;
    }
    if (upper === 'RELAY:OFF' || upper === 'VALVE:OFF') {
      await this.toggleValve(false);
      return;
    }
    if (upper.startsWith('TIME:')) {
      const timeVal = decodedText.slice(5).trim();
      await this._patchMachineState(
        { time: timeVal, terminalTx: `TIME:${timeVal}`, terminalTxId: Date.now() },
        `TIME:${timeVal}`
      );
      return;
    }

    await this.writePin(PINS.TERMINAL_LOG, decodedText, displayLabel);

    const needsLocalEcho = this.config.simulatorMode || !this.state.isHardwareOnline;
    if (needsLocalEcho) {
      if (upper === 'AT') {
        setTimeout(() => this.appendMessage('OK (AquaSmart ESP32-C3 UART Ready)', false), 120);
      } else if (upper === 'INFO') {
        setTimeout(
          () =>
            this.appendMessage(
              `DEVICE:${this.state.deviceName} | MCU:ESP32-C3 | GPIO3:RELAY | ID:${this.state.machineId}`,
              false
            ),
          120
        );
      } else if (upper === 'STATUS') {
        setTimeout(
          () =>
            this.appendMessage(
              `SYS:${this.state.isMasterEnabled ? 'ACTIVE' : 'OFF'} | RELAY:${
                this.state.isValveOpen ? 'ON' : 'OFF'
              } | TEMP:${this.state.temperatureCelsius.toFixed(1)}C | TIME:${this.state.deviceTime}`,
              false
            ),
          120
        );
      } else {
        this.parseUartLine(decodedText);
      }
    }
  }
}

export const blynkClient = new BlynkClient();
