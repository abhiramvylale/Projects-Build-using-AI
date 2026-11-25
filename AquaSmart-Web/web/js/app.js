/**
 * AquaSmart Irrigation Web App — Complete Firebase Cloud Controller (Phases 1–6)
 * Integrates:
 *  - Dual-Role Login Gateway (Customer User Toggle vs Main Operator Toggle)
 *  - Main Operator Console (Firebase Cloud Sync, Active Users, User & Machine Provisioning)
 *  - Customer Irrigation Dashboard, Initial Wi-Fi Setup Wizard & Interactive Serial Terminal
 */

import { blynkClient, DEFAULT_BLYNK_CONFIG } from './blynk-client.js';
import {
  authManager,
  DEFAULT_DEMO_USER,
} from './auth-manager.js';

// Progressive enhancement for <input type="checkbox" switch>
if (!('switch' in HTMLInputElement.prototype)) {
  document.querySelectorAll('input[type="checkbox"][switch]').forEach((el) => {
    el.setAttribute('role', 'switch');
    el.classList.add('fallback-switch');
  });
}

// Progressive enhancement fallback for <dialog closedby="any"> (light-dismiss-a-dialog)
if (!('closedBy' in HTMLDialogElement.prototype)) {
  document.querySelectorAll('dialog[closedby="any"]').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (isDialogContent) return;
      dialog.close();
    });
  });
}

const dom = {
  // Top-level Portals
  loginGatewayView: document.getElementById('login-gateway-view'),
  operatorConsoleView: document.getElementById('operator-console-view'),
  customerPortalShell: document.getElementById('customer-portal-shell'),

  // Login Gateway Elements
  tabRoleUser: document.getElementById('tab-role-user'),
  tabRoleOperator: document.getElementById('tab-role-operator'),
  loginRoleTitle: document.getElementById('login-role-title'),
  loginRoleDesc: document.getElementById('login-role-desc'),
  loginUsernameLabel: document.getElementById('login-username-label'),
  loginPasswordLabel: document.getElementById('login-password-label'),
  loginForm: document.getElementById('login-form'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('current-password'),
  loginErrorMsg: document.getElementById('login-error-msg'),
  btnLoginSubmit: document.getElementById('btn-login-submit'),
  loginHintBox: document.getElementById('login-hint-box'),
  loginHintText: document.getElementById('login-hint-text'),
  btnFillDemo: document.getElementById('btn-fill-demo'),

  // Main Operator Console Elements
  btnOpRefresh: document.getElementById('btn-op-refresh'),
  btnOpLogout: document.getElementById('btn-op-logout'),
  statActiveUsers: document.getElementById('stat-active-users'),
  statTotalUsers: document.getElementById('stat-total-users'),
  statOnlineMachines: document.getElementById('stat-online-machines'),
  firebaseStatusBadge: document.getElementById('firebase-status-badge'),
  firebaseConfigForm: document.getElementById('firebase-config-form'),
  operatorDbUrl: document.getElementById('operator-db-url'),
  firebaseConfigFeedback: document.getElementById('firebase-config-feedback'),
  activeSessionsTbody: document.getElementById('active-sessions-tbody'),
  usersDirTbody: document.getElementById('users-dir-tbody'),
  createUserForm: document.getElementById('create-user-form'),
  newUserUsername: document.getElementById('new-user-username'),
  newUserPassword: document.getElementById('new-user-password'),
  newUserFullname: document.getElementById('new-user-fullname'),
  newUserDevicename: document.getElementById('new-user-devicename'),
  newUserToken: document.getElementById('new-user-token'),
  createUserFeedback: document.getElementById('create-user-feedback'),
  masterCredsForm: document.getElementById('master-creds-form'),
  masterUserInput: document.getElementById('master-user-input'),
  masterPassInput: document.getElementById('master-pass-input'),
  masterCredsFeedback: document.getElementById('master-creds-feedback'),

  // Operator Preview Banner inside Customer Portal
  operatorInspectBanner: document.getElementById('operator-inspect-banner'),
  inspectBannerText: document.getElementById('inspect-banner-text'),
  btnExitInspect: document.getElementById('btn-exit-inspect'),

  // Customer Portal Header Bar & Wi-Fi Onboarding
  statusDot: document.getElementById('status-dot'),
  deviceName: document.getElementById('device-name'),
  connectionSubtitle: document.getElementById('connection-subtitle'),
  loggedInUserPill: document.getElementById('logged-in-user-pill'),
  hwStatusPill: document.getElementById('hw-status-pill'),
  btnWifiWizard: document.getElementById('btn-wifi-wizard'),
  onboardingWifiCard: document.getElementById('onboarding-wifi-card'),
  onboardingMachineId: document.getElementById('onboarding-machine-id'),
  btnOpenWifiWizardBanner: document.getElementById('btn-open-wifi-wizard-banner'),
  btnSyncTime: document.getElementById('btn-sync-time'),
  btnToggleTerminal: document.getElementById('btn-toggle-terminal'),
  btnTerminalLabel: document.getElementById('btn-terminal-label'),
  btnRefreshNow: document.getElementById('btn-refresh-now'),
  btnOpenSettings: document.getElementById('btn-open-settings'),
  btnUserLogout: document.getElementById('btn-user-logout'),
  customerWelcomeSubtitle: document.getElementById('customer-welcome-subtitle'),

  dashboardView: document.getElementById('dashboard-view'),
  terminalView: document.getElementById('terminal-view'),

  // System Master Card
  masterSwitch: document.getElementById('master-switch'),
  masterStatusText: document.getElementById('master-status-text'),
  masterStatusIcon: document.getElementById('master-status-icon'),
  masterStatusLabel: document.getElementById('master-status-label'),

  // Irrigation Schedule Card
  btnAddSchedule: document.getElementById('btn-add-schedule'),
  scheduleTabs: document.getElementById('schedule-tabs'),
  scheduleForm: document.getElementById('schedule-form'),
  activeScheduleLegend: document.getElementById('active-schedule-legend'),
  schedHour: document.getElementById('sched-hour'),
  schedMinute: document.getElementById('sched-minute'),
  schedDuration: document.getElementById('sched-duration'),
  schedEnabled: document.getElementById('sched-enabled'),
  scheduleWindowText: document.getElementById('schedule-window-text'),
  scheduleEnabledBadge: document.getElementById('schedule-enabled-badge'),
  scheduleFormError: document.getElementById('schedule-form-error'),
  btnDeleteSchedule: document.getElementById('btn-delete-schedule'),
  btnSaveSchedule: document.getElementById('btn-save-schedule'),
  btnSyncAllSchedules: document.getElementById('btn-sync-all-schedules'),

  // Manual Override Card
  valveStatusPill: document.getElementById('valve-status-pill'),
  btnValveOpen: document.getElementById('btn-valve-open'),
  btnValveClose: document.getElementById('btn-valve-close'),
  interlockHint: document.getElementById('interlock-hint'),

  // Telemetry Row
  liveClockValue: document.getElementById('live-clock-value'),
  clockSourceSub: document.getElementById('clock-source-sub'),
  tempValue: document.getElementById('temp-value'),
  tempStatusSub: document.getElementById('temp-status-sub'),

  // Interactive Terminal Screen
  btnHexMode: document.getElementById('btn-hex-mode'),
  btnNewlineMode: document.getElementById('btn-newline-mode'),
  btnClearTerminal: document.getElementById('btn-clear-terminal'),
  terminalViewport: document.getElementById('terminal-viewport'),
  terminalForm: document.getElementById('terminal-form'),
  terminalInput: document.getElementById('terminal-input'),

  // Diagnostics & Datastream Inspector
  btnToggleSim: document.getElementById('btn-toggle-sim'),
  valV0: document.getElementById('val-v0'),
  valV1: document.getElementById('val-v1'),
  valV2: document.getElementById('val-v2'),
  valV3: document.getElementById('val-v3'),
  lastSyncLabel: document.getElementById('last-sync-label'),
  logPreview: document.getElementById('log-preview'),

  // Wi-Fi Setup Wizard Modal
  wifiWizardModal: document.getElementById('wifi-wizard-modal'),
  wizardMachineLabel: document.getElementById('wizard-machine-label'),
  linkOpenCaptivePortal: document.getElementById('link-open-captive-portal'),

  // Settings Modal
  settingsModal: document.getElementById('settings-modal'),
  inputTemplateId: document.getElementById('input-template-id'),
  inputTemplateName: document.getElementById('input-template-name'),
  inputAuthToken: document.getElementById('input-auth-token'),
  inputSimMode: document.getElementById('input-sim-mode'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  btnResetDefaults: document.getElementById('btn-reset-defaults'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
};

let selectedLoginRole = 'user'; // 'user' | 'operator'
let activeBoundAccountKey = null;
let loadedScheduleSignature = null;
let lastRenderedMessageSignature = '';

function formatTime(date) {
  if (!date) return '--:--:--';
  return date.toTimeString().split(' ')[0];
}

let deviceClockBaselineSec = null;
let deviceClockReceivedAtMs = 0;
let lastObservedRawDeviceTime = null;

function parseHmsToSeconds(hms) {
  if (!hms || typeof hms !== 'string') return null;
  const parts = hms.split(':').map((p) => parseInt(p, 10));
  if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    const hh = parts[0];
    const mm = parts[1];
    const ss = parts.length > 2 && !Number.isNaN(parts[2]) ? parts[2] : 0;
    return (hh * 3600 + mm * 60 + ss) % 86400;
  }
  return null;
}

function formatSecondsToHms(totalSec) {
  const norm = ((totalSec % 86400) + 86400) % 86400;
  const hh = String(Math.floor(norm / 3600)).padStart(2, '0');
  const mm = String(Math.floor((norm % 3600) / 60)).padStart(2, '0');
  const ss = String(norm % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function updateLiveClockDisplay(state) {
  if (!dom.liveClockValue) return;

  const raw = state?.deviceTime;
  if (raw && raw !== '--:--:--') {
    if (raw !== lastObservedRawDeviceTime) {
      lastObservedRawDeviceTime = raw;
      const parsed = parseHmsToSeconds(raw);
      if (parsed !== null) {
        deviceClockBaselineSec = parsed;
        deviceClockReceivedAtMs = Date.now();
      }
    }
  } else {
    deviceClockBaselineSec = null;
    lastObservedRawDeviceTime = null;
  }

  if (deviceClockBaselineSec !== null) {
    const elapsedSec = Math.floor((Date.now() - deviceClockReceivedAtMs) / 1000);
    const currentClockSec = (deviceClockBaselineSec + elapsedSec) % 86400;
    dom.liveClockValue.textContent = formatSecondsToHms(currentClockSec);

    if (dom.clockSourceSub) {
      if (state?.isHardwareOnline) {
        dom.clockSourceSub.textContent = `● Synced with ${state.machineId} (ESP32-C3 Hardware Clock)`;
      } else {
        dom.clockSourceSub.textContent = `○ ${state?.machineId || 'Machine'} Offline — Clock ticking locally (Pending Sync)`;
      }
    }
  } else {
    dom.liveClockValue.textContent = formatTime(new Date());
    if (dom.clockSourceSub) {
      dom.clockSourceSub.textContent = 'Browser Time (Click Sync Time to push to ESP32-C3)';
    }
  }
}

function formatTimeMs(date) {
  if (!date) return '--:--:--.000';
  const base = date.toTimeString().split(' ')[0];
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${base}.${ms}`;
}

function formatRelativeAgo(timestampMs) {
  if (!timestampMs) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 5) return 'Active now';
  if (diffSec < 60) return `${diffSec}s ago`;
  return `${Math.floor(diffSec / 60)}m ago`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function suggestNextMachineId(users) {
  let maxNum = 0;
  for (const u of users) {
    const m = String(u.machineId || '').match(/(\d+)$/);
    if (m) {
      const parsed = parseInt(m[1], 10);
      if (!Number.isNaN(parsed) && parsed > maxNum) maxNum = parsed;
    }
  }
  const nextNum = Math.max(users.length + 1, maxNum + 1);
  return `AQ-ESP32-${String(nextNum).padStart(3, '0')}`;
}

function setHintCredentialsDOM(container, prefixText, username, password) {
  const userCode = document.createElement('code');
  userCode.textContent = username;
  const passCode = document.createElement('code');
  passCode.textContent = password;
  container.replaceChildren(
    document.createTextNode(`${prefixText}: Username `),
    userCode,
    document.createTextNode(' / Password '),
    passCode
  );
}

function openWifiWizardModal() {
  const mId = blynkClient.state.machineId || 'AQ-ESP32-001';
  const dbUrl = authManager.getDatabaseUrl() || '';
  dom.wizardMachineLabel.textContent = mId;

  const params = new URLSearchParams();
  params.set('machineId', mId);
  if (dbUrl) {
    params.set('dbUrl', dbUrl);
  }
  dom.linkOpenCaptivePortal.href = `http://192.168.4.1/?${params.toString()}`;
  dom.wifiWizardModal.showModal();
}

// =========================================================================
// Login Role Toggle UI
// =========================================================================

function setLoginRole(role) {
  selectedLoginRole = role === 'operator' ? 'operator' : 'user';
  const isOp = selectedLoginRole === 'operator';

  dom.tabRoleUser.setAttribute('aria-selected', String(!isOp));
  dom.tabRoleOperator.setAttribute('aria-selected', String(isOp));

  dom.loginRoleTitle.textContent = isOp
    ? 'Main Operator (Master Admin) Sign In'
    : 'Customer User Sign In';
  dom.loginRoleDesc.textContent = isOp
    ? 'Sign in with the Master Operator username and password to view active logged-in users and assign new customer hardware units.'
    : 'Sign in with your assigned customer username and password to connect and control your irrigation machine.';

  dom.loginUsernameLabel.textContent = isOp ? 'Master Operator Username' : 'Customer Username';
  dom.loginPasswordLabel.textContent = isOp ? 'Master Password' : 'Password';
  dom.btnLoginSubmit.textContent = isOp
    ? 'Sign In as Main Operator'
    : 'Sign In as Customer User';

  if (isOp) {
    dom.loginHintBox.hidden = true;
    dom.btnFillDemo.hidden = true;
  } else if (authManager.isDefaultDemoCustomerActive()) {
    dom.loginHintBox.hidden = false;
    setHintCredentialsDOM(
      dom.loginHintText,
      'Starter Customer Login',
      DEFAULT_DEMO_USER.username,
      DEFAULT_DEMO_USER.password
    );
    dom.btnFillDemo.hidden = false;
  } else {
    dom.loginHintBox.hidden = false;
    dom.loginHintText.textContent =
      'Enter the customer username and password assigned by your Main Operator.';
    dom.btnFillDemo.hidden = true;
  }

  dom.loginErrorMsg.textContent = '';
}

// =========================================================================
// Main Operator Console Renderer
// =========================================================================

function renderOperatorConsole(snap) {
  const { users, activeSessions, masterCredentials, firebaseConfig, isCloudConfigured } = snap;

  // Firebase status pill & input
  if (document.activeElement !== dom.operatorDbUrl) {
    dom.operatorDbUrl.value = firebaseConfig?.databaseUrl || '';
  }
  if (isCloudConfigured) {
    dom.firebaseStatusBadge.className = 'status-pill online';
    dom.firebaseStatusBadge.textContent = '● Firebase Cloud Synced';
  } else {
    dom.firebaseStatusBadge.className = 'status-pill offline';
    dom.firebaseStatusBadge.textContent = '○ Local Mode (Paste Firebase URL Below)';
  }

  // Populate master credentials inputs if not focused
  if (document.activeElement !== dom.masterUserInput) {
    dom.masterUserInput.value = masterCredentials.username || '';
  }
  if (document.activeElement !== dom.masterPassInput) {
    dom.masterPassInput.value = masterCredentials.password || '';
    dom.masterPassInput.placeholder = masterCredentials.password
      ? ''
      : 'Enter new master password to update';
  }

  // Keep suggested next Machine ID & Name fresh when form is untouched
  if (
    dom.newUserUsername.value.trim() === '' &&
    document.activeElement !== dom.newUserToken &&
    document.activeElement !== dom.newUserDevicename
  ) {
    const nextSuggestedId = suggestNextMachineId(users);
    const nextNumMatch = nextSuggestedId.match(/(\d+)$/);
    const nextNum = nextNumMatch ? parseInt(nextNumMatch[1], 10) : users.length + 1;
    dom.newUserToken.value = nextSuggestedId;
    dom.newUserDevicename.value = `AquaSmart Irrigation #${nextNum}`;
  }

  // Stats
  dom.statActiveUsers.textContent = String(activeSessions.length);
  dom.statTotalUsers.textContent = String(users.length);
  dom.statOnlineMachines.textContent = String(users.filter((u) => u.hwOnline).length);

  // 1. Active Logged-In Sessions Table
  if (activeSessions.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.color = 'var(--white-60)';
    td.textContent = 'No active user sessions at the moment.';
    tr.appendChild(td);
    dom.activeSessionsTbody.replaceChildren(tr);
  } else {
    dom.activeSessionsTbody.replaceChildren(
      ...activeSessions.map((sess) => {
        const tr = document.createElement('tr');

        const thUser = document.createElement('th');
        thUser.scope = 'row';
        thUser.textContent = sess.username;

        const tdRole = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = sess.role === 'operator' ? 'status-pill sim' : 'status-pill online';
        badge.textContent =
          sess.role === 'operator' ? '🛡 Main Operator' : `👤 ${sess.fullName || 'Customer'}`;
        tdRole.appendChild(badge);

        const tdMachine = document.createElement('td');
        tdMachine.textContent =
          sess.role === 'operator'
            ? 'All Assigned Machines'
            : `${sess.deviceName || 'AquaSmart'} (${sess.machineId || 'AQ-ESP32-001'})`;

        const tdActive = document.createElement('td');
        tdActive.textContent = `● ${formatRelativeAgo(sess.lastActiveAt)}`;

        const tdAction = document.createElement('td');
        if (sess.role !== 'operator') {
          const btnKick = document.createElement('button');
          btnKick.type = 'button';
          btnKick.className = 'btn-sm btn-sm-danger';
          btnKick.textContent = 'Force Logout';
          btnKick.addEventListener('click', () => {
            authManager.forceLogoutUser(sess.username);
          });
          tdAction.appendChild(btnKick);
        } else {
          tdAction.textContent = 'Current Admin';
        }

        tr.append(thUser, tdRole, tdMachine, tdActive, tdAction);
        return tr;
      })
    );
  }

  // 2. Registered Users Directory Table
  if (users.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.color = 'var(--white-60)';
    td.textContent = 'No customer accounts assigned yet. Use the form above to assign a user.';
    tr.appendChild(td);
    dom.usersDirTbody.replaceChildren(tr);
  } else {
    dom.usersDirTbody.replaceChildren(
      ...users.map((u) => {
        const tr = document.createElement('tr');

        const thUser = document.createElement('th');
        thUser.scope = 'row';
        const isCurrentlyLoggedIn = activeSessions.some(
          (s) => s.role === 'user' && s.username.toLowerCase() === u.username.toLowerCase()
        );
        thUser.textContent = `${isCurrentlyLoggedIn ? '🟢 ' : ''}${u.username}`;

        const tdCustomer = document.createElement('td');
        const nameDiv = document.createElement('div');
        nameDiv.style.fontWeight = '600';
        nameDiv.textContent = u.fullName || u.username;
        const machineDiv = document.createElement('div');
        machineDiv.style.fontSize = '0.78rem';
        machineDiv.style.color = 'var(--teal-300)';
        machineDiv.textContent = `Machine: ${u.deviceName}`;
        tdCustomer.append(nameDiv, machineDiv);

        const tdCreds = document.createElement('td');
        tdCreds.style.fontFamily = 'var(--font-mono)';
        tdCreds.style.fontSize = '0.8rem';
        const passLine = document.createElement('div');
        passLine.textContent = `Pass: ${u.password}`;
        const idLine = document.createElement('div');
        idLine.style.color = 'var(--teal-300)';
        idLine.textContent = `ID: ${u.machineId || 'AQ-ESP32-001'}`;
        tdCreds.append(passLine, idLine);

        const tdStatus = document.createElement('td');
        const hwBadge = document.createElement('span');
        hwBadge.className = u.hwOnline ? 'status-pill online' : 'status-pill offline';
        hwBadge.textContent = u.hwOnline ? '● ESP32 ONLINE' : '○ ESP32 OFFLINE';
        tdStatus.appendChild(hwBadge);

        const tdActions = document.createElement('td');
        const actionWrap = document.createElement('div');
        actionWrap.className = 'table-actions';

        const btnOpenDash = document.createElement('button');
        btnOpenDash.type = 'button';
        btnOpenDash.className = 'btn-sm';
        btnOpenDash.textContent = 'Open Dashboard';
        btnOpenDash.addEventListener('click', () => {
          authManager.startInspectingUser(u.id);
        });

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-sm btn-sm-danger';
        btnDel.textContent = 'Delete';
        btnDel.addEventListener('click', () => {
          authManager.deleteUser(u.id);
        });

        actionWrap.append(btnOpenDash, btnDel);
        tdActions.appendChild(actionWrap);

        tr.append(thUser, tdCustomer, tdCreds, tdStatus, tdActions);
        return tr;
      })
    );
  }
}

// =========================================================================
// Route Guard & Portal Switcher
// =========================================================================

function renderAuthAndRoute(snap) {
  const { currentSession, inspectingUser, firebaseConfig } = snap;

  // 1. Not Logged In -> Lock Application & Show Login Gateway
  if (!currentSession) {
    dom.loginGatewayView.hidden = false;
    dom.operatorConsoleView.hidden = true;
    dom.customerPortalShell.hidden = true;
    activeBoundAccountKey = null;
    blynkClient.stopPolling();
    setLoginRole(selectedLoginRole);
    return;
  }

  // 2. Logged in as Main Operator (and not currently previewing a customer's dashboard)
  if (currentSession.role === 'operator' && !inspectingUser) {
    dom.loginGatewayView.hidden = true;
    dom.operatorConsoleView.hidden = false;
    dom.customerPortalShell.hidden = true;
    activeBoundAccountKey = null;
    blynkClient.stopPolling();
    renderOperatorConsole(snap);
    return;
  }

  // 3. Logged in as Customer User OR Operator previewing a specific customer's machine
  const targetAccount = inspectingUser || currentSession;

  dom.loginGatewayView.hidden = true;
  dom.operatorConsoleView.hidden = true;
  dom.customerPortalShell.hidden = false;

  const assignedMachineId =
    targetAccount.machineId || targetAccount.authToken || DEFAULT_BLYNK_CONFIG.machineId;

  // Operator Preview Banner
  if (inspectingUser) {
    dom.operatorInspectBanner.hidden = false;
    dom.inspectBannerText.textContent = `${inspectingUser.fullName} (${inspectingUser.username}) — Machine: ${inspectingUser.deviceName} [${assignedMachineId}]`;
    dom.btnOpenSettings.hidden = false;
  } else {
    dom.operatorInspectBanner.hidden = true;
    dom.btnOpenSettings.hidden = true;
  }

  dom.loggedInUserPill.textContent = `👤 ${targetAccount.username} (${assignedMachineId})`;
  dom.customerWelcomeSubtitle.textContent = `${targetAccount.fullName} — ${targetAccount.deviceName} (${assignedMachineId})`;
  dom.onboardingMachineId.textContent = assignedMachineId;

  // Bind Firebase Client cleanly when switching to a customer's account
  const dbUrl = firebaseConfig?.databaseUrl || '';
  const accountKey = `${targetAccount.username}:${assignedMachineId}:${targetAccount.deviceName}:${dbUrl}`;
  if (activeBoundAccountKey !== accountKey) {
    activeBoundAccountKey = accountKey;
    loadedScheduleSignature = null;
    lastRenderedMessageSignature = '';
    blynkClient.bindAccount({
      machineId: assignedMachineId,
      deviceName: targetAccount.deviceName || 'AquaSmart Irrigation',
      databaseUrl: dbUrl,
    });
  }
}

// =========================================================================
// Customer Dashboard & Terminal Renderers
// =========================================================================

function updateSchedulePreviewUI() {
  const selected = blynkClient.state.schedules.find(
    (s) => s.id === blynkClient.state.selectedScheduleId
  );
  const label = selected ? selected.label : 'T1';
  const h = parseInt(dom.schedHour.value, 10);
  const m = parseInt(dom.schedMinute.value, 10);
  const d = parseInt(dom.schedDuration.value, 10);
  const enabled = dom.schedEnabled.checked;

  if (
    !Number.isNaN(h) &&
    h >= 0 &&
    h <= 23 &&
    !Number.isNaN(m) &&
    m >= 0 &&
    m <= 59 &&
    !Number.isNaN(d) &&
    d >= 1
  ) {
    const endTotalMin = m + d;
    const endHour = (h + Math.floor(endTotalMin / 60)) % 24;
    const endMin = endTotalMin % 60;
    dom.scheduleWindowText.textContent = `${label}ON:${pad2(h)}:${pad2(m)}:00 → ${label}OFF:${pad2(
      endHour
    )}:${pad2(endMin)}:00 (${d}m)`;
  } else {
    dom.scheduleWindowText.textContent = `${label}: Enter valid hour, minute & duration`;
  }

  if (enabled) {
    dom.scheduleEnabledBadge.className = 'status-pill online';
    dom.scheduleEnabledBadge.textContent = '● Timer Enabled';
  } else {
    dom.scheduleEnabledBadge.className = 'status-pill offline';
    dom.scheduleEnabledBadge.textContent = '○ Timer Disabled';
  }
}

function validateScheduleField(inputEl) {
  const val = inputEl.value.trim();
  const num = Number(val);
  let errMsg = '';

  if (inputEl === dom.schedHour) {
    if (val === '' || !Number.isInteger(num) || num < 0 || num > 23) {
      errMsg = 'Hour must be a whole number between 0 and 23.';
    }
  } else if (inputEl === dom.schedMinute) {
    if (val === '' || !Number.isInteger(num) || num < 0 || num > 59) {
      errMsg = 'Minute must be a whole number between 0 and 59.';
    }
  } else if (inputEl === dom.schedDuration) {
    if (val === '' || !Number.isInteger(num) || num < 1 || num > 1440) {
      errMsg = 'Duration must be between 1 and 1440 minutes.';
    }
  }

  inputEl.setCustomValidity(errMsg);
  return errMsg;
}

function renderScheduleSection(state) {
  dom.scheduleTabs.replaceChildren(
    ...state.schedules.map((sched) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.setAttribute('role', 'tab');
      const isSelected = sched.id === state.selectedScheduleId;
      btn.setAttribute('aria-selected', String(isSelected));

      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = sched.isEnabled ? '●' : '○';
      dot.style.color = sched.isEnabled ? 'var(--teal-400)' : 'var(--white-38)';

      const txt = document.createElement('span');
      txt.textContent = sched.label;

      btn.append(dot, txt);
      btn.addEventListener('click', () => {
        loadedScheduleSignature = null;
        blynkClient.selectSchedule(sched.id);
      });
      return btn;
    })
  );

  const selected =
    state.schedules.find((s) => s.id === state.selectedScheduleId) || state.schedules[0];

  const isEditingScheduleField =
    document.activeElement === dom.schedHour ||
    document.activeElement === dom.schedMinute ||
    document.activeElement === dom.schedDuration;

  const scheduleSig = selected
    ? `${selected.id}:${selected.startHour}:${selected.startMinute}:${selected.durationMinutes}:${Boolean(
        selected.isEnabled
      )}`
    : '';

  if (selected && loadedScheduleSignature !== scheduleSig && !isEditingScheduleField) {
    loadedScheduleSignature = scheduleSig;
    dom.activeScheduleLegend.textContent = selected.label;
    dom.schedHour.value = String(selected.startHour);
    dom.schedMinute.value = String(selected.startMinute);
    dom.schedDuration.value = String(selected.durationMinutes);
    dom.schedEnabled.checked = Boolean(selected.isEnabled);
    dom.schedHour.setCustomValidity('');
    dom.schedMinute.setCustomValidity('');
    dom.schedDuration.setCustomValidity('');
    dom.scheduleFormError.textContent = '';
    updateSchedulePreviewUI();
  }

  dom.btnSaveSchedule.disabled = state.isSettingSchedule;
  dom.btnSyncAllSchedules.disabled = state.isSettingSchedule;
  dom.btnSaveSchedule.textContent = state.isSettingSchedule ? 'Saving...' : 'Save Timer';
  dom.btnDeleteSchedule.disabled = state.schedules.length <= 1 || state.isSettingSchedule;
}

function renderTerminalSection(state) {
  dom.btnHexMode.textContent = `Hex Mode: ${state.isHexMode ? 'ON' : 'OFF'}`;
  dom.btnHexMode.setAttribute('aria-pressed', String(state.isHexMode));
  dom.btnHexMode.classList.toggle('active-view', state.isHexMode);

  const escapedNewline = state.newlineMode
    .replace('\r', '\\r')
    .replace('\n', '\\n');
  dom.btnNewlineMode.textContent = `Newline: ${escapedNewline || 'None'}`;

  const lastMsgId = state.messages.length > 0 ? state.messages[state.messages.length - 1].id : '';
  const currentSignature = `${state.messages.length}:${lastMsgId}`;

  if (currentSignature !== lastRenderedMessageSignature) {
    lastRenderedMessageSignature = currentSignature;

    dom.terminalViewport.replaceChildren(
      ...state.messages.map((msg) => {
        const row = document.createElement('div');
        row.className = 'log-entry';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'log-time';
        timeSpan.textContent = `[${formatTimeMs(msg.timestamp)}]`;

        const prefix = msg.isSent ? '→' : '←';
        const textSpan = document.createElement('span');
        textSpan.className = msg.isError ? 'log-err' : msg.isSent ? 'log-tx' : 'log-rx';
        textSpan.textContent = `${prefix} ${msg.text}`;

        row.append(timeSpan, textSpan);
        return row;
      })
    );
    dom.terminalViewport.scrollTop = dom.terminalViewport.scrollHeight;
  }
}

function renderBlynkState(state) {
  dom.deviceName.textContent = state.deviceName || 'AquaSmart Controller';

  dom.statusDot.className = 'status-dot';
  dom.connectionSubtitle.className = 'connection-subtitle';

  // Show the First-Time Wi-Fi Setup Onboarding Banner whenever hardware is offline & not in Simulator
  dom.onboardingWifiCard.hidden = Boolean(state.isHardwareOnline || state.isSimulator);

  if (state.isSimulator) {
    dom.statusDot.classList.add('connected');
    dom.connectionSubtitle.classList.add('connected');
    dom.connectionSubtitle.textContent = `Simulator Active (Machine: ${state.machineId})`;
    dom.hwStatusPill.className = 'status-pill sim';
    dom.hwStatusPill.textContent = '⚡ SIMULATOR MODE';
    dom.btnToggleSim.textContent = 'Switch to Live Firebase Cloud';
  } else if (state.connectionState === 'CONNECTED') {
    if (state.isHardwareOnline) {
      dom.statusDot.classList.add('connected');
      dom.connectionSubtitle.classList.add('connected');
      dom.connectionSubtitle.textContent = `Wi-Fi Connected (Firebase Cloud — ${state.machineId})`;
      dom.hwStatusPill.className = 'status-pill online';
      dom.hwStatusPill.textContent = '● ESP32-C3 ONLINE';
    } else {
      dom.statusDot.classList.add('connecting');
      dom.connectionSubtitle.textContent = `Firebase Cloud Ready — Waiting for ${state.machineId} Wi-Fi`;
      dom.hwStatusPill.className = 'status-pill offline';
      dom.hwStatusPill.textContent = '○ ESP32-C3 OFFLINE';
    }
    dom.btnToggleSim.textContent = 'Switch to Simulator Mode';
  } else if (state.connectionState === 'CONNECTING') {
    dom.statusDot.classList.add('connecting');
    dom.connectionSubtitle.textContent = 'Connecting to Firebase Cloud...';
    dom.hwStatusPill.className = 'status-pill offline';
    dom.hwStatusPill.textContent = '… CONNECTING';
  } else {
    dom.connectionSubtitle.textContent = state.lastError
      ? `${state.lastError}`
      : 'Disconnected';
    dom.hwStatusPill.className = 'status-pill offline';
    dom.hwStatusPill.textContent = '○ STANDBY';
  }

  dom.masterSwitch.checked = Boolean(state.isMasterEnabled);
  dom.masterSwitch.setAttribute('aria-checked', String(Boolean(state.isMasterEnabled)));

  if (state.isMasterEnabled) {
    dom.masterStatusText.className = 'master-status-text active';
    dom.masterStatusIcon.textContent = '●';
    dom.masterStatusLabel.textContent = 'Active (System Master Enabled)';
  } else {
    dom.masterStatusText.className = 'master-status-text';
    dom.masterStatusIcon.textContent = '○';
    dom.masterStatusLabel.textContent = 'Disabled';
  }

  renderScheduleSection(state);

  dom.btnValveOpen.disabled = !(state.isMasterEnabled && !state.isValveOpen);
  dom.btnValveClose.disabled = !(state.isMasterEnabled && state.isValveOpen);

  if (state.isValveOpen) {
    dom.valveStatusPill.className = 'status-pill online';
    dom.valveStatusPill.textContent = '● VALVE OPEN (FLOWING)';
  } else {
    dom.valveStatusPill.className = 'status-pill offline';
    dom.valveStatusPill.textContent = '○ VALVE CLOSED';
  }

  if (!state.isMasterEnabled) {
    dom.interlockHint.className = 'interlock-hint locked';
    dom.interlockHint.innerHTML =
      '<span aria-hidden="true">🔒</span><span>Safety Interlock: Enable <strong>System Master</strong> above to unlock manual valve controls.</span>';
  } else {
    dom.interlockHint.className = 'interlock-hint';
    dom.interlockHint.innerHTML = state.isValveOpen
      ? '<span aria-hidden="true">💧</span><span>Irrigation valve is currently <strong>OPEN</strong> (2h auto-shutoff watchdog active).</span>'
      : '<span aria-hidden="true">✓</span><span>System Master active — ready for manual valve control.</span>';
  }

  updateLiveClockDisplay(state);

  const temp = Number(state.temperatureCelsius);
  dom.tempValue.textContent = `${temp.toFixed(1)}°C`;
  if (temp > 35) {
    dom.tempStatusSub.textContent = '▲ High Temperature';
  } else if (temp < 10) {
    dom.tempStatusSub.textContent = '▼ Low Temperature';
  } else {
    dom.tempStatusSub.textContent = '● Optimal Range';
  }

  renderTerminalSection(state);

  const v0Active = Number(state.pins.V0) === 1;
  dom.valV0.textContent = `${state.pins.V0} (${v0Active ? 'ON / ACTIVE' : 'OFF'})`;
  dom.valV1.textContent = `${state.pins.V1} (${state.isValveOpen ? 'OPEN' : 'CLOSED'})`;
  dom.valV2.textContent = `${temp.toFixed(1)} °C`;
  dom.valV3.textContent = state.deviceTime || '--:--:--';

  dom.lastSyncLabel.textContent = state.lastSyncTime
    ? `Last synced: ${formatTime(state.lastSyncTime)}`
    : 'Not synced yet';

  const recentLogs = state.messages.slice(-15);
  dom.logPreview.replaceChildren(
    ...recentLogs.map((msg) => {
      const row = document.createElement('div');
      row.className = 'log-entry';

      const t = document.createElement('span');
      t.className = 'log-time';
      t.textContent = `[${formatTime(msg.timestamp)}]`;

      const body = document.createElement('span');
      body.className = msg.isError ? 'log-err' : msg.isSent ? 'log-tx' : 'log-rx';
      body.textContent = `${msg.isSent ? '→' : '←'} ${msg.text}`;

      row.append(t, body);
      return row;
    })
  );
  dom.logPreview.scrollTop = dom.logPreview.scrollHeight;
}

// =========================================================================
// Event Listeners Initialization
// =========================================================================

function initEvents() {
  // 1. Login Gateway Role Toggle
  dom.tabRoleUser.addEventListener('click', () => setLoginRole('user'));
  dom.tabRoleOperator.addEventListener('click', () => setLoginRole('operator'));

  dom.btnFillDemo.addEventListener('click', () => {
    if (selectedLoginRole === 'user' && authManager.isDefaultDemoCustomerActive()) {
      dom.loginUsername.value = DEFAULT_DEMO_USER.username;
      dom.loginPassword.value = DEFAULT_DEMO_USER.password;
    }
    dom.loginErrorMsg.textContent = '';
  });

  dom.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    dom.loginErrorMsg.textContent = '';
    dom.btnLoginSubmit.disabled = true;
    try {
      const session = await authManager.login(
        selectedLoginRole,
        dom.loginUsername.value,
        dom.loginPassword.value
      );
      dom.loginPassword.value = '';
      if (session.role === 'operator') {
        authManager.refreshHardwareStatuses();
      }
    } catch (err) {
      dom.loginErrorMsg.textContent = `⚠ ${err.message}`;
    } finally {
      dom.btnLoginSubmit.disabled = false;
    }
  });

  // 2. Main Operator Console Actions
  dom.btnOpRefresh.addEventListener('click', () => {
    authManager.refreshHardwareStatuses();
  });

  dom.btnOpLogout.addEventListener('click', () => {
    authManager.logout();
  });

  dom.firebaseConfigForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    dom.firebaseConfigFeedback.className = 'form-success-msg';
    dom.firebaseConfigFeedback.textContent = 'Connecting to Firebase Cloud...';
    try {
      const cfg = await authManager.setDatabaseUrl(dom.operatorDbUrl.value);
      if (cfg.databaseUrl) {
        dom.firebaseConfigFeedback.className = 'form-success-msg';
        dom.firebaseConfigFeedback.textContent = `✓ Connected & synced with Firebase Cloud (${cfg.databaseUrl}).`;
      } else {
        dom.firebaseConfigFeedback.className = 'form-error-msg';
        dom.firebaseConfigFeedback.textContent = 'Switched to Local Browser Mode (no Firebase URL set).';
      }
    } catch (err) {
      dom.firebaseConfigFeedback.className = 'form-error-msg';
      dom.firebaseConfigFeedback.textContent = `⚠ Firebase error: ${err.message}`;
    }
  });

  dom.createUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    dom.createUserFeedback.className = 'form-error-msg';
    dom.createUserFeedback.textContent = '';

    try {
      const created = await authManager.createUser({
        username: dom.newUserUsername.value,
        password: dom.newUserPassword.value,
        fullName: dom.newUserFullname.value,
        deviceName: dom.newUserDevicename.value,
        machineId: dom.newUserToken.value,
      });

      const allUsers = authManager.getUsers();
      dom.newUserUsername.value = '';
      dom.newUserPassword.value = '';
      dom.newUserFullname.value = '';
      dom.newUserDevicename.value = `AquaSmart Irrigation #${allUsers.length + 1}`;
      dom.newUserToken.value = suggestNextMachineId(allUsers);

      dom.createUserFeedback.className = 'form-success-msg';
      dom.createUserFeedback.textContent = `✓ Assigned customer "${created.username}" to Machine ID "${created.machineId}".`;
      authManager.refreshHardwareStatuses();
    } catch (err) {
      dom.createUserFeedback.className = 'form-error-msg';
      dom.createUserFeedback.textContent = `⚠ ${err.message}`;
    }
  });

  dom.masterCredsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const updated = await authManager.updateMasterCredentials(
        dom.masterUserInput.value,
        dom.masterPassInput.value
      );
      dom.masterCredsFeedback.className = 'form-success-msg';
      dom.masterCredsFeedback.textContent = `✓ Master Operator credentials updated (Username: ${updated.username}).`;
    } catch (err) {
      dom.masterCredsFeedback.className = 'form-error-msg';
      dom.masterCredsFeedback.textContent = `⚠ ${err.message}`;
    }
  });

  dom.btnExitInspect.addEventListener('click', () => {
    authManager.stopInspectingUser();
  });

  dom.btnUserLogout.addEventListener('click', () => {
    authManager.logout();
  });

  // 3. Customer Portal Controls & Wi-Fi Setup Wizard
  dom.btnWifiWizard.addEventListener('click', openWifiWizardModal);
  dom.btnOpenWifiWizardBanner.addEventListener('click', openWifiWizardModal);

  dom.btnToggleTerminal.addEventListener('click', () => {
    const isTerminalVisible = !dom.terminalView.hidden;
    dom.terminalView.hidden = isTerminalVisible;
    dom.dashboardView.hidden = !isTerminalVisible;
    dom.btnToggleTerminal.setAttribute('aria-pressed', String(!isTerminalVisible));
    dom.btnToggleTerminal.classList.toggle('active-view', !isTerminalVisible);
    dom.btnTerminalLabel.textContent = isTerminalVisible ? 'Terminal' : 'Dashboard';
    if (!isTerminalVisible) {
      dom.terminalViewport.scrollTop = dom.terminalViewport.scrollHeight;
      dom.terminalInput.focus();
    }
  });

  dom.masterSwitch.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    blynkClient.setMasterToggle(enabled);
  });

  [dom.schedHour, dom.schedMinute, dom.schedDuration].forEach((inputEl) => {
    inputEl.addEventListener('input', () => {
      inputEl.setCustomValidity('');
      dom.scheduleFormError.textContent = '';
      updateSchedulePreviewUI();
    });

    inputEl.addEventListener('blur', () => {
      const err = validateScheduleField(inputEl);
      if (err) {
        dom.scheduleFormError.textContent = `⚠ ${err}`;
      }
      updateSchedulePreviewUI();
    });
  });

  dom.schedEnabled.addEventListener('change', () => {
    updateSchedulePreviewUI();
  });

  dom.btnAddSchedule.addEventListener('click', () => {
    loadedScheduleSignature = null;
    blynkClient.addNewSchedule();
  });

  dom.btnDeleteSchedule.addEventListener('click', () => {
    const id = blynkClient.state.selectedScheduleId;
    loadedScheduleSignature = null;
    blynkClient.deleteSchedule(id);
  });

  dom.scheduleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = [dom.schedHour, dom.schedMinute, dom.schedDuration];
    for (const field of fields) {
      const err = validateScheduleField(field);
      if (err) {
        dom.scheduleFormError.textContent = `⚠ ${err}`;
        field.focus();
        return;
      }
    }

    const selected = blynkClient.state.schedules.find(
      (s) => s.id === blynkClient.state.selectedScheduleId
    );
    if (!selected) return;

    await blynkClient.saveSchedule({
      ...selected,
      startHour: parseInt(dom.schedHour.value.trim(), 10),
      startMinute: parseInt(dom.schedMinute.value.trim(), 10),
      durationMinutes: parseInt(dom.schedDuration.value.trim(), 10),
      isEnabled: dom.schedEnabled.checked,
    });
  });

  dom.btnSyncAllSchedules.addEventListener('click', () => {
    blynkClient.syncAllSchedules();
  });

  dom.btnValveOpen.addEventListener('click', () => {
    if (blynkClient.state.isMasterEnabled) {
      blynkClient.toggleValve(true);
    }
  });

  dom.btnValveClose.addEventListener('click', () => {
    if (blynkClient.state.isMasterEnabled) {
      blynkClient.toggleValve(false);
    }
  });

  dom.btnHexMode.addEventListener('click', () => {
    blynkClient.toggleHexMode(!blynkClient.state.isHexMode);
  });

  dom.btnNewlineMode.addEventListener('click', () => {
    blynkClient.cycleNewlineMode();
  });

  dom.btnClearTerminal.addEventListener('click', () => {
    lastRenderedMessageSignature = '';
    blynkClient.clearMessages();
  });

  document.querySelectorAll('[data-macro]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-macro');
      blynkClient.sendTerminalCommand(cmd);
    });
  });

  dom.terminalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = dom.terminalInput.value.trim();
    if (!text) return;
    blynkClient.sendTerminalCommand(text);
    dom.terminalInput.value = '';
  });

  dom.btnSyncTime.addEventListener('click', () => {
    blynkClient.syncBrowserTime();
  });

  dom.btnRefreshNow.addEventListener('click', () => {
    blynkClient.pollOnce();
  });

  dom.btnToggleSim.addEventListener('click', () => {
    blynkClient.saveConfig({ simulatorMode: !blynkClient.config.simulatorMode });
  });

  setInterval(() => {
    updateLiveClockDisplay(blynkClient.state);
    const snap = authManager.getSnapshot();
    if (snap.currentSession && snap.currentSession.role === 'operator' && !snap.inspectingUser) {
      renderOperatorConsole(snap);
    }
  }, 1000);

  // Settings Modal
  dom.btnOpenSettings.addEventListener('click', () => {
    dom.inputTemplateId.value = authManager.getDatabaseUrl() || '';
    dom.inputTemplateName.value = blynkClient.config.deviceName || '';
    dom.inputAuthToken.value = blynkClient.config.machineId || 'AQ-ESP32-001';
    dom.inputSimMode.checked = Boolean(blynkClient.config.simulatorMode);
    dom.settingsModal.showModal();
  });

  dom.btnCloseSettings.addEventListener('click', () => {
    dom.settingsModal.close();
  });

  dom.btnResetDefaults.addEventListener('click', () => {
    dom.inputTemplateId.value = DEFAULT_BLYNK_CONFIG.databaseUrl;
    dom.inputTemplateName.value = DEFAULT_BLYNK_CONFIG.deviceName;
    dom.inputAuthToken.value = DEFAULT_BLYNK_CONFIG.machineId;
    dom.inputSimMode.checked = false;
  });

  dom.btnSaveSettings.addEventListener('click', async (e) => {
    e.preventDefault();
    const newDbUrl = dom.inputTemplateId.value.trim();
    await authManager.setDatabaseUrl(newDbUrl);
    blynkClient.saveConfig({
      databaseUrl: newDbUrl,
      deviceName: dom.inputTemplateName.value.trim(),
      machineId: dom.inputAuthToken.value.trim(),
      simulatorMode: dom.inputSimMode.checked,
    });
    dom.settingsModal.close();
  });
}

// Boot Application
initEvents();
blynkClient.subscribe(renderBlynkState);
authManager.subscribe(renderAuthAndRoute);
