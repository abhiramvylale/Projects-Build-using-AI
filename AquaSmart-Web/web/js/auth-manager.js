/**
 * AquaSmart Irrigation — Firebase Cloud Dual-Role Authentication & User Management Engine
 * Manages:
 *  1. Main Operator (Admin) authentication & Master Credentials (synced as SHA-256 hash in /aquasmart/operator)
 *  2. Customer User directory (Username, Password, Assigned Machine ID, Machine Name -> /aquasmart/users)
 *  3. Global Real-Time Active Sessions tracking & remote Force-Logout (/aquasmart/sessions/<sessionId>)
 *  4. Strict Role Isolation: Customers only access their own account & session; only Operator reads directory.
 */

import {
  getFirebaseConfig,
  saveFirebaseConfig,
  isFirebaseCloudConfigured,
  DEFAULT_FIREBASE_CONFIG,
} from './firebase-config.js';

const STORAGE_KEY_MASTER = 'aquasmart_master_creds_v2';
const STORAGE_KEY_USERS = 'aquasmart_users_dir_v2';
const STORAGE_KEY_SESSIONS = 'aquasmart_active_sessions_v2';
const SESSION_KEY_CURRENT = 'aquasmart_current_session_v2';

export const DEFAULT_MASTER_CREDENTIALS = {
  username: 'admin',
  password: 'YOUR_OPERATOR_PASSWORD',
};

export const DEFAULT_DEMO_USER = {
  id: 'usr_default_1',
  username: 'customer1',
  password: 'YOUR_DEMO_USER_PASSWORD',
  fullName: 'Ramesh Kumar (Demo Customer)',
  deviceName: DEFAULT_FIREBASE_CONFIG.defaultDeviceName,
  machineId: DEFAULT_FIREBASE_CONFIG.defaultMachineId,
  createdAt: '2026-10-23T08:00:00Z',
  hwOnline: false,
};

const DEFAULT_INITIAL_SCHEDULES = [
  { id: 1, label: 'T1', startHour: 8, startMinute: 0, durationMinutes: 15, isEnabled: false },
  { id: 2, label: 'T2', startHour: 18, startMinute: 0, durationMinutes: 20, isEnabled: false },
];

const DEFAULT_USERS = [DEFAULT_DEMO_USER];
const ACTIVE_TIMEOUT_MS = 90 * 1000; // 90s heartbeat window

function sanitizeKey(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[.#$/[\]\s]+/g, '_');
}

export async function hashPassword(plain) {
  const text = `aquasmart_salt_v2:${String(plain || '')}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a_${(h >>> 0).toString(16)}`;
}

export class AuthManager {
  constructor() {
    this.listeners = new Set();
    this.heartbeatTimer = null;
    this.cloudSyncInFlight = false;
    this.machineHeartbeats = new Map(); // machineId -> { seq, localSeenMs }
    this.channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('aquasmart_auth_channel')
        : null;

    if (this.channel) {
      this.channel.onmessage = () => {
        this._syncLocalSessionValidity();
        this._notify();
      };
    }

    window.addEventListener('storage', () => {
      this._syncLocalSessionValidity();
      this._notify();
    });

    window.addEventListener('beforeunload', () => {
      const current = this.getCurrentSession();
      if (current) {
        const remaining = this.getActiveSessions().filter(
          (s) => s.sessionId !== current.sessionId
        );
        this._saveSessionsLocal(remaining);
        const dbUrl = this.getDatabaseUrl();
        if (dbUrl && current.sessionId) {
          fetch(`${dbUrl}/aquasmart/sessions/${encodeURIComponent(current.sessionId)}.json`, {
            method: 'DELETE',
            keepalive: true,
          }).catch(() => null);
        }
        if (this.channel) {
          this.channel.postMessage({ type: 'AUTH_UPDATED', ts: Date.now() });
        }
      }
    });

    this.inspectingUser = null;
    this._syncLocalSessionValidity();
    this._startSessionHeartbeat();

    // Only sync full operator directory on boot if currently logged in as Main Operator
    const current = this.getCurrentSession();
    if (isFirebaseCloudConfigured()) {
      if (current && current.role === 'operator') {
        this.syncFromFirebaseCloud();
      } else if (current && current.role === 'user') {
        this._heartbeatCustomerCloudSession(current);
      }
    }
  }

  // =========================================================================
  // Firebase Cloud REST Helpers
  // =========================================================================

  getDatabaseUrl() {
    return getFirebaseConfig().databaseUrl;
  }

  async setDatabaseUrl(newUrl) {
    const updated = saveFirebaseConfig({ databaseUrl: newUrl });
    if (updated.databaseUrl) {
      await this._seedFirebaseIfNeeded();
      await this.syncFromFirebaseCloud();
    }
    this._broadcastChange();
    return updated;
  }

  async _fbFetch(path, options = {}) {
    const dbUrl = this.getDatabaseUrl();
    if (!dbUrl) return null;
    const cleanPath = String(path).replace(/^\/+/, '');
    const res = await fetch(`${dbUrl}/aquasmart/${cleanPath}.json`, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `Firebase HTTP ${res.status}`);
    }
    return res.json();
  }

  async _seedFirebaseIfNeeded() {
    if (!isFirebaseCloudConfigured()) return;
    try {
      const remoteOp = await this._fbFetch('operator');
      if (!remoteOp) {
        const master = this.getMasterCredentials();
        const passwordHash =
          master.passwordHash || (await hashPassword(master.password || DEFAULT_MASTER_CREDENTIALS.password));
        await this._fbFetch('operator', {
          method: 'PUT',
          body: JSON.stringify({
            username: master.username,
            passwordHash,
            updatedAt: new Date().toISOString(),
          }),
        });
      }

      const remoteUsers = await this._fbFetch('users');
      if (!remoteUsers) {
        const localUsers = this.getUsers();
        const usersMap = {};
        for (const u of localUsers) {
          const passwordHash = u.passwordHash || (await hashPassword(u.password || ''));
          usersMap[sanitizeKey(u.username)] = { ...u, passwordHash };
        }
        if (Object.keys(usersMap).length > 0) {
          await this._fbFetch('users', {
            method: 'PUT',
            body: JSON.stringify(usersMap),
          });
        }
      }
    } catch (_) {
      // ignore seed errors
    }
  }

  _evaluateMachineOnline(machineId, infoObj, nowMs) {
    if (!infoObj) return false;
    const lastSeen = Number(infoObj.lastSeenEpochMs || 0);
    const seq = Number(infoObj.heartbeatSeq || 0);

    // Track monotonic heartbeat counter to stay immune to browser clock skew
    if (seq > 0) {
      const prev = this.machineHeartbeats.get(machineId);
      if (!prev) {
        this.machineHeartbeats.set(machineId, { seq, localSeenMs: 0 });
      } else if (seq !== prev.seq) {
        this.machineHeartbeats.set(machineId, { seq, localSeenMs: nowMs });
      }
    }

    const tracked = this.machineHeartbeats.get(machineId);
    const seqFresh = Boolean(tracked && tracked.localSeenMs > 0 && nowMs - tracked.localSeenMs < 16000);
    const timestampFresh =
      lastSeen > 0 && nowMs - lastSeen < 25000 && lastSeen - nowMs < 60000;

    return seqFresh || timestampFresh;
  }

  /**
   * Operator-only full directory, session, and fleet hardware status synchronization.
   */
  async syncFromFirebaseCloud() {
    if (!isFirebaseCloudConfigured() || this.cloudSyncInFlight) return;
    this.cloudSyncInFlight = true;
    try {
      const [remoteOp, remoteUsers, remoteSessions, remoteMachines] = await Promise.all([
        this._fbFetch('operator').catch(() => null),
        this._fbFetch('users').catch(() => null),
        this._fbFetch('sessions').catch(() => null),
        this._fbFetch('machines').catch(() => null),
      ]);

      if (remoteOp && remoteOp.username) {
        const existingLocal = this.getMasterCredentials();
        const mergedOp = {
          ...existingLocal,
          ...remoteOp,
          // Preserve local password display only if username/hash still matches local admin browser
          password:
            existingLocal.passwordHash === remoteOp.passwordHash ? existingLocal.password : '',
        };
        localStorage.setItem(STORAGE_KEY_MASTER, JSON.stringify(mergedOp));
      }

      if (remoteUsers && typeof remoteUsers === 'object') {
        const now = Date.now();
        const list = Object.values(remoteUsers)
          .filter((u) => u && u.username)
          .map((u) => {
            const mId = u.machineId || u.authToken || DEFAULT_FIREBASE_CONFIG.defaultMachineId;
            const mData = remoteMachines && remoteMachines[mId];
            const isOnline = this._evaluateMachineOnline(mId, mData?.info, now);
            return {
              ...u,
              machineId: mId,
              hwOnline: Boolean(isOnline),
            };
          });
        localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(list));
      }

      if (remoteSessions && typeof remoteSessions === 'object') {
        const now = Date.now();
        const activeList = Object.values(remoteSessions).filter(
          (s) => s && s.active && s.sessionId && now - s.lastActiveAt < ACTIVE_TIMEOUT_MS
        );
        this._saveSessionsLocal(activeList);
      } else if (remoteSessions === null) {
        this._saveSessionsLocal([]);
      }

      this._notify();
    } finally {
      this.cloudSyncInFlight = false;
    }
  }

  /**
   * Customer-isolated heartbeat: checks only this customer's user record & sessionId.
   * Respects Operator Force-Logout & Account Deletion without reading any other customer's data.
   */
  async _heartbeatCustomerCloudSession(session, isInitialLogin = false) {
    if (!isFirebaseCloudConfigured() || !session) return;
    try {
      if (!isInitialLogin) {
        const [remoteUser, remoteSess] = await Promise.all([
          this._fbFetch(`users/${sanitizeKey(session.username)}`).catch(() => undefined),
          this._fbFetch(`sessions/${encodeURIComponent(session.sessionId)}`).catch(() => undefined),
        ]);

        // If Operator deleted this user OR force-logged-out this session, log out immediately!
        if (remoteUser === null || remoteSess === null) {
          this._setCurrentSession(null);
          this._broadcastChange();
          return;
        }
      }

      const updatedSession = {
        ...session,
        lastActiveAt: Date.now(),
        active: true,
      };
      await this._fbFetch(`sessions/${encodeURIComponent(session.sessionId)}`, {
        method: 'PUT',
        body: JSON.stringify(updatedSession),
      });
    } catch (_) {
      // Transient offline tolerance — keep session alive until network returns
    }
  }

  // =========================================================================
  // Storage Helpers
  // =========================================================================

  getMasterCredentials() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MASTER);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.username && (parsed.password || parsed.passwordHash)) return parsed;
      }
    } catch (_) {
      // ignore
    }
    return { ...DEFAULT_MASTER_CREDENTIALS };
  }

  isUsingDefaultMasterCredentials() {
    if (isFirebaseCloudConfigured()) {
      const raw = localStorage.getItem(STORAGE_KEY_MASTER);
      if (!raw) return false; // Hide starter password hint on public cloud deployments
    }
    const current = this.getMasterCredentials();
    return (
      current.username === DEFAULT_MASTER_CREDENTIALS.username &&
      current.password === DEFAULT_MASTER_CREDENTIALS.password
    );
  }

  isDefaultDemoCustomerActive() {
    if (isFirebaseCloudConfigured()) {
      return false; // Hide demo password hint on live cloud deployments
    }
    const users = this.getUsers();
    return users.some(
      (u) =>
        u.username === DEFAULT_DEMO_USER.username &&
        u.password === DEFAULT_DEMO_USER.password
    );
  }

  async updateMasterCredentials(username, password) {
    const cleanUser = String(username || '').trim();
    const cleanPass = String(password || '').trim();
    if (!cleanUser || cleanPass.length < 4) {
      throw new Error('Master username and a password (min 4 chars) are required.');
    }
    const passwordHash = await hashPassword(cleanPass);
    const localCreds = {
      username: cleanUser,
      password: cleanPass,
      passwordHash,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY_MASTER, JSON.stringify(localCreds));

    if (isFirebaseCloudConfigured()) {
      // Store ONLY SHA-256 hash in Firebase Cloud (never plaintext master password)
      await this._fbFetch('operator', {
        method: 'PUT',
        body: JSON.stringify({
          username: cleanUser,
          passwordHash,
          updatedAt: localCreds.updatedAt,
        }),
      });
    }

    const current = this.getCurrentSession();
    if (current && current.role === 'operator') {
      const updatedSession = { ...current, username: cleanUser };
      this._setCurrentSession(updatedSession);
      await this._upsertActiveSession(updatedSession);
    }

    this._broadcastChange();
    return localCreds;
  }

  getUsers() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_USERS);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((u) => ({
            ...u,
            machineId: u.machineId || u.authToken || DEFAULT_FIREBASE_CONFIG.defaultMachineId,
          }));
        }
      }
    } catch (_) {
      // ignore
    }
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(DEFAULT_USERS));
    return structuredClone(DEFAULT_USERS);
  }

  _saveUsersLocal(users) {
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
    this._broadcastChange();
  }

  getActiveSessions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      const now = Date.now();
      return list.filter((s) => s && s.active && now - s.lastActiveAt < ACTIVE_TIMEOUT_MS);
    } catch (_) {
      return [];
    }
  }

  _saveSessionsLocal(sessions) {
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
  }

  getCurrentSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_CURRENT);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  _setCurrentSession(sessionObj) {
    try {
      if (!sessionObj) {
        sessionStorage.removeItem(SESSION_KEY_CURRENT);
      } else {
        sessionStorage.setItem(SESSION_KEY_CURRENT, JSON.stringify(sessionObj));
      }
    } catch (_) {
      // ignore storage errors
    }
  }

  // =========================================================================
  // Authentication (Main Operator vs Customer User — Cloud + Local)
  // =========================================================================

  async login(role, username, password) {
    const cleanUser = String(username || '').trim();
    const cleanPass = String(password || '');

    if (!cleanUser || !cleanPass) {
      throw new Error('Please enter both username and password.');
    }

    const inputHash = await hashPassword(cleanPass);

    if (role === 'operator') {
      let master = this.getMasterCredentials();

      if (isFirebaseCloudConfigured()) {
        const remoteOp = await this._fbFetch('operator').catch(() => null);
        if (remoteOp && remoteOp.username) {
          master = remoteOp;
        }
      }

      const defaultHash = await hashPassword(DEFAULT_MASTER_CREDENTIALS.password);
      const userMatches = cleanUser.toLowerCase() === master.username.toLowerCase();
      const passMatches =
        (master.passwordHash && inputHash === master.passwordHash) ||
        (master.password && cleanPass === master.password) ||
        (!master.passwordHash &&
          !master.password &&
          master.username === DEFAULT_MASTER_CREDENTIALS.username &&
          inputHash === defaultHash);

      if (!userMatches || !passMatches) {
        throw new Error('Invalid Main Operator username or master password.');
      }

      // Cache operator credentials locally on this admin device & seed fresh Firebase DB if needed
      const localMasterRecord = {
        username: master.username,
        password: cleanPass,
        passwordHash: inputHash,
      };
      localStorage.setItem(STORAGE_KEY_MASTER, JSON.stringify(localMasterRecord));

      if (isFirebaseCloudConfigured()) {
        await this._seedFirebaseIfNeeded();
        await this.syncFromFirebaseCloud();
      }

      const session = {
        sessionId: `sess_op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'operator',
        username: master.username,
        fullName: 'Main Operator (Admin)',
        deviceName: 'All Assigned Machines',
        machineId: DEFAULT_FIREBASE_CONFIG.defaultMachineId,
        loginAt: Date.now(),
        lastActiveAt: Date.now(),
        active: true,
      };
      this.inspectingUser = null;
      this._setCurrentSession(session);
      await this._upsertActiveSession(session);
      this._broadcastChange();
      return session;
    }

    // Role === 'user' (Customer Login — isolated single-user lookup on Firebase Cloud)
    let matched = null;

    if (isFirebaseCloudConfigured()) {
      const remoteUser = await this._fbFetch(`users/${sanitizeKey(cleanUser)}`).catch(() => null);
      if (
        remoteUser &&
        remoteUser.username &&
        ((remoteUser.passwordHash && remoteUser.passwordHash === inputHash) ||
          (remoteUser.password && remoteUser.password === cleanPass))
      ) {
        matched = remoteUser;
      } else if (!remoteUser && cleanUser.toLowerCase() === DEFAULT_DEMO_USER.username) {
        // Fallback only if Firebase hasn't been seeded yet and demo customer1 logs in
        if (cleanPass === DEFAULT_DEMO_USER.password) {
          matched = DEFAULT_DEMO_USER;
        }
      }
    } else {
      matched = this.getUsers().find(
        (u) =>
          u.username.toLowerCase() === cleanUser.toLowerCase() &&
          (u.password === cleanPass || (u.passwordHash && u.passwordHash === inputHash))
      );
    }

    if (!matched) {
      throw new Error('Invalid customer username or password.');
    }

    const assignedMachineId =
      matched.machineId || matched.authToken || DEFAULT_FIREBASE_CONFIG.defaultMachineId;

    const session = {
      sessionId: `sess_usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      userId: matched.id,
      username: matched.username,
      fullName: matched.fullName || matched.username,
      deviceName: matched.deviceName || 'AquaSmart Controller',
      machineId: assignedMachineId,
      loginAt: Date.now(),
      lastActiveAt: Date.now(),
      active: true,
    };

    this.inspectingUser = null;
    this._setCurrentSession(session);
    if (isFirebaseCloudConfigured()) {
      await this._heartbeatCustomerCloudSession(session, true);
    } else {
      await this._upsertActiveSession(session);
    }
    this._broadcastChange();
    return session;
  }

  async logout() {
    const current = this.getCurrentSession();
    if (current) {
      const sessions = this.getActiveSessions().filter(
        (s) => s.sessionId !== current.sessionId
      );
      this._saveSessionsLocal(sessions);
      if (isFirebaseCloudConfigured() && current.sessionId) {
        await this._fbFetch(`sessions/${encodeURIComponent(current.sessionId)}`, {
          method: 'DELETE',
        }).catch(() => null);
      }
    }
    this.inspectingUser = null;
    this._setCurrentSession(null);
    this._broadcastChange();
  }

  async forceLogoutUser(username) {
    const targetLower = String(username || '').toLowerCase();
    const currentSessions = this.getActiveSessions();
    const toRemove = currentSessions.filter((s) => s.username.toLowerCase() === targetLower);
    const remaining = currentSessions.filter((s) => s.username.toLowerCase() !== targetLower);
    this._saveSessionsLocal(remaining);

    if (isFirebaseCloudConfigured()) {
      await Promise.all(
        toRemove.map((s) =>
          this._fbFetch(`sessions/${encodeURIComponent(s.sessionId)}`, {
            method: 'DELETE',
          }).catch(() => null)
        )
      );
      // Also clean any remote sessions matching username not yet in local list
      const remoteSessions = await this._fbFetch('sessions').catch(() => null);
      if (remoteSessions && typeof remoteSessions === 'object') {
        const extraDeletes = Object.entries(remoteSessions)
          .filter(([, s]) => s && String(s.username || '').toLowerCase() === targetLower)
          .map(([key]) =>
            this._fbFetch(`sessions/${encodeURIComponent(key)}`, {
              method: 'DELETE',
            }).catch(() => null)
          );
        await Promise.all(extraDeletes);
      }
    }
    this._broadcastChange();
  }

  // =========================================================================
  // Operator User Management (Create / Delete / Inspect / Machine Status)
  // =========================================================================

  async createUser({ username, password, fullName, deviceName, machineId }) {
    const cleanUsername = String(username || '').trim();
    const cleanPassword = String(password || '').trim();
    const cleanName = String(fullName || '').trim() || cleanUsername;
    const cleanDevice = String(deviceName || '').trim() || 'AquaSmart Irrigation';
    const cleanMachineId =
      String(machineId || '')
        .trim()
        .replace(/[.#$/[\]\s]+/g, '-') || DEFAULT_FIREBASE_CONFIG.defaultMachineId;

    if (!cleanUsername) {
      throw new Error('Username is required.');
    }
    if (cleanPassword.length < 4) {
      throw new Error('Password must be at least 4 characters.');
    }

    if (isFirebaseCloudConfigured()) {
      await this.syncFromFirebaseCloud();
    }

    const users = this.getUsers();
    if (users.some((u) => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
      throw new Error(`Username "${cleanUsername}" is already assigned.`);
    }
    if (users.some((u) => String(u.machineId || '').toLowerCase() === cleanMachineId.toLowerCase())) {
      throw new Error(
        `Machine ID "${cleanMachineId}" is already assigned to another customer. Each customer unit must have its own unique Machine ID.`
      );
    }

    const passwordHash = await hashPassword(cleanPassword);

    const newUser = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      username: cleanUsername,
      password: cleanPassword,
      passwordHash,
      fullName: cleanName,
      deviceName: cleanDevice,
      machineId: cleanMachineId,
      createdAt: new Date().toISOString(),
      hwOnline: false,
    };

    users.push(newUser);
    this._saveUsersLocal(users);

    if (isFirebaseCloudConfigured()) {
      await this._fbFetch(`users/${sanitizeKey(cleanUsername)}`, {
        method: 'PUT',
        body: JSON.stringify(newUser),
      });

      const existingMachine = await this._fbFetch(`machines/${encodeURIComponent(cleanMachineId)}/info`).catch(
        () => null
      );
      if (!existingMachine) {
        await this._fbFetch(`machines/${encodeURIComponent(cleanMachineId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            info: {
              machineId: cleanMachineId,
              deviceName: cleanDevice,
              assignedUser: cleanUsername,
              lastSeenEpochMs: 0,
              heartbeatSeq: 0,
            },
            state: {
              master: 1,
              valve: 0,
              temp: 26.4,
              time: '--:--:--',
              schedulesJson: JSON.stringify(DEFAULT_INITIAL_SCHEDULES),
              schedulesRev: 1,
              terminalRx: '',
              terminalRxId: 0,
              terminalTx: '',
              terminalTxId: 0,
            },
          }),
        }).catch(() => null);
      }
    }

    return newUser;
  }

  async deleteUser(userId) {
    const users = this.getUsers();
    const target = users.find((u) => u.id === userId);
    if (!target) return;
    if (this.inspectingUser && this.inspectingUser.id === userId) {
      this.inspectingUser = null;
    }
    const remaining = users.filter((u) => u.id !== userId);
    this._saveUsersLocal(remaining);

    if (isFirebaseCloudConfigured()) {
      await this._fbFetch(`users/${sanitizeKey(target.username)}`, {
        method: 'DELETE',
      }).catch(() => null);
    }

    await this.forceLogoutUser(target.username);
  }

  startInspectingUser(userId) {
    const user = this.getUsers().find((u) => u.id === userId);
    if (!user) return null;
    this.inspectingUser = { ...user };
    this._notify();
    return this.inspectingUser;
  }

  stopInspectingUser() {
    this.inspectingUser = null;
    this._notify();
  }

  async refreshHardwareStatuses() {
    if (isFirebaseCloudConfigured()) {
      await this.syncFromFirebaseCloud();
      return this.getUsers();
    }
    this._notify();
    return this.getUsers();
  }

  // =========================================================================
  // Session Heartbeat & Subscriptions
  // =========================================================================

  async _upsertActiveSession(session) {
    const updatedSession = {
      ...session,
      lastActiveAt: Date.now(),
      active: true,
    };
    const sessions = this.getActiveSessions().filter(
      (s) => s.sessionId !== session.sessionId
    );
    sessions.push(updatedSession);
    this._saveSessionsLocal(sessions);

    if (isFirebaseCloudConfigured() && session.sessionId) {
      await this._fbFetch(`sessions/${encodeURIComponent(session.sessionId)}`, {
        method: 'PUT',
        body: JSON.stringify(updatedSession),
      }).catch(() => null);
    }
  }

  _syncLocalSessionValidity() {
    if (isFirebaseCloudConfigured()) return; // Cloud mode validates via _heartbeatCustomerCloudSession
    const current = this.getCurrentSession();
    if (!current) return;
    if (current.role === 'user') {
      const activeList = this.getActiveSessions();
      const userStillExists = this.getUsers().some(
        (u) => u.username.toLowerCase() === current.username.toLowerCase()
      );
      const sessionStillActive = activeList.some(
        (s) => s.sessionId === current.sessionId
      );
      if (!userStillExists || !sessionStillActive) {
        this._setCurrentSession(null);
      }
    }
  }

  _startSessionHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(async () => {
      const current = this.getCurrentSession();
      if (!current) return;

      if (isFirebaseCloudConfigured()) {
        if (current.role === 'operator') {
          await this._upsertActiveSession(current);
          await this.syncFromFirebaseCloud();
        } else {
          await this._heartbeatCustomerCloudSession(current, false);
        }
      } else {
        await this._upsertActiveSession(current);
        this._syncLocalSessionValidity();
      }
    }, 10000);
  }

  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.getSnapshot());
    return () => this.listeners.delete(callback);
  }

  getSnapshot() {
    const currentSession = this.getCurrentSession();
    const isOperator = Boolean(currentSession && currentSession.role === 'operator');
    const cloudActive = isFirebaseCloudConfigured();
    return {
      currentSession,
      inspectingUser: this.inspectingUser,
      users: isOperator || !cloudActive ? this.getUsers() : [],
      activeSessions: isOperator || !cloudActive ? this.getActiveSessions() : [],
      masterCredentials: isOperator || !cloudActive ? this.getMasterCredentials() : { username: '' },
      firebaseConfig: getFirebaseConfig(),
      isCloudConfigured: cloudActive,
    };
  }

  _broadcastChange() {
    if (this.channel) {
      this.channel.postMessage({ type: 'AUTH_UPDATED', ts: Date.now() });
    }
    this._notify();
  }

  _notify() {
    const snap = this.getSnapshot();
    for (const cb of this.listeners) {
      cb(snap);
    }
  }
}

export const authManager = new AuthManager();
