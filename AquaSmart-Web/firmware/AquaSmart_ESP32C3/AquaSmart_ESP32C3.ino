/*
 * ============================================================================
 * AquaSmart Irrigation Controller — ESP32-C3 Firmware (Firebase Edition) v2
 * ============================================================================
 * Board:  "ESP32C3 Dev Module"
 * Tools -> USB CDC On Boot -> Enabled   (to see Serial Monitor over USB)
 * Tools -> Flash Mode -> DIO
 * Libraries: built-in ESP32 core only
 *   (WiFi, WiFiClientSecure, HTTPClient, WebServer, DNSServer, Preferences)
 *
 * FIXES IN THIS VERSION
 *   1. "AquaSmart-Setup" hotspot now starts reliably:
 *        - STA reconnect attempts are stopped before the AP starts
 *        - fixed channel 1, open network, fixed IP 192.168.4.1
 *        - reduced TX power (fixes many ESP32-C3 SuperMini boards)
 *   2. Home Wi-Fi retries no longer kill the hotspot:
 *        - retry only every 60 s, only when no phone is connected to the AP
 *        - each retry is time-limited, then STA is disconnected again
 *   3. Real captive portal (DNS redirect) - phone opens setup page automatically
 *   4. DS18B20 read is non-blocking and waits the full conversion time
 *   5. Removed designated-initializer syntax that breaks on newer ESP32 cores
 *   6. Portal /save now flushes the response before restarting
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>

// ---- 1. Default Cloud Configuration ----
const char* DEFAULT_FIREBASE_DB_URL = "https://aquasmart-b982b-default-rtdb.asia-southeast1.firebasedatabase.app";
const char* DEFAULT_MACHINE_ID      = "AQ-ESP32-001";

// ---- 2. Hardware Pins (ESP32-C3) ----
#define RELAY_PIN       3   // Valve relay / LED
#define TEMP_PIN        4   // Optional DS18B20
#define RESET_BTN_PIN   9   // BOOT button (hold 5 s to reset Wi-Fi)

// ---- 3. Wi-Fi / Radio Settings ----
const char* AP_SSID        = "AquaSmart-Setup";
const int   AP_CHANNEL     = 1;
// Many ESP32-C3 SuperMini boards need reduced TX power to work at all.
// If your board works fine, you may try WIFI_POWER_15dBm.
const wifi_power_t WIFI_TX_POWER = WIFI_POWER_8_5dBm;

const unsigned long WIFI_RETRY_INTERVAL_MS = 60000UL;  // retry home Wi-Fi every 60 s
const unsigned long WIFI_RETRY_WINDOW_MS   = 15000UL;  // each retry lasts max 15 s

// ---- 4. Time & Safety ----
const long  DEFAULT_GMT_OFFSET_SEC   = 19800; // IST
const int   DAYLIGHT_OFFSET_SEC      = 0;
const char* NTP_SERVER               = "pool.ntp.org";
const int   DEFAULT_MAX_OPEN_MINUTES = 120;

// ---- 5. Data Structures & Global State ----
struct TimerSlot {
  bool enabled;
  int  onHour;
  int  onMin;
  int  offHour;
  int  offMin;
};

#define MAX_TIMERS 8
TimerSlot timers[MAX_TIMERS];
uint8_t   pendingOnMask = 0;

Preferences      prefs;
WebServer        portalServer(80);
DNSServer        dnsServer;
WiFiClientSecure httpsClient;
HTTPClient       firebaseHttp;

String wifiSsid    = "";
String wifiPass    = "";
String firebaseUrl = "";
String machineId   = "";

long   gmtOffsetSec     = DEFAULT_GMT_OFFSET_SEC;
int    maxOpenMinutes   = DEFAULT_MAX_OPEN_MINUTES;
bool   portalActive     = false;
bool   portalRoutesInit = false;
bool   isMasterEnabled  = true;
bool   isValveOpen      = false;
bool   localStateDirty  = false;
bool   bootSyncPending  = true;
float  currentTempC     = 26.5f;
int    lastCheckedMin   = -1;

// Wi-Fi retry state
bool          wifiRetryActive   = false;
unsigned long wifiRetryStartMs  = 0;

unsigned long valveOpenedAtMs       = 0;
unsigned long lastCloudSyncMs       = 0;
unsigned long lastScheduleCheckMs   = 0;
unsigned long lastEpochSaveMs       = 0;
unsigned long lastWifiRetryMs       = 0;
unsigned long btnPressStartMs       = 0;
unsigned long heartbeatSeq          = 0;

String        lastProcessedTxId     = "";
String        lastSchedulesRev      = "";
String        pendingTerminalRx     = "";
unsigned long pendingTerminalRxId   = 0;
String        serialBuffer          = "";

// DS18B20 non-blocking state
bool          tempConvPending = false;
unsigned long tempConvStartMs = 0;

// ============================================================================
// Clock helpers
// ============================================================================

void saveCurrentEpochToNVS() {
  time_t now;
  time(&now);
  if (now > (time_t)1700000000L) {
    prefs.begin("aquasmart", false);
    prefs.putULong("savedEpoch", (unsigned long)now);
    prefs.end();
  }
}

void restoreEpochFromNVS() {
  setenv("TZ", "GMT0", 1);
  tzset();

  prefs.begin("aquasmart", true);
  unsigned long saved = prefs.getULong("savedEpoch", 1761200000UL);
  gmtOffsetSec        = prefs.getLong("gmtOffset", DEFAULT_GMT_OFFSET_SEC);
  maxOpenMinutes      = prefs.getInt("maxOpenMin", DEFAULT_MAX_OPEN_MINUTES);
  prefs.end();

  struct timeval tv;
  tv.tv_sec  = (time_t)saved;
  tv.tv_usec = 0;
  settimeofday(&tv, NULL);
}

String getFormattedTime() {
  time_t now;
  time(&now);
  time_t localNow = now + gmtOffsetSec;
  struct tm timeinfo;
  gmtime_r(&localNow, &timeinfo);

  char buf[12];
  snprintf(buf, sizeof(buf), "%02d:%02d:%02d",
           timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
  return String(buf);
}

void getCurrentHourMin(int& outHour, int& outMin) {
  time_t now;
  time(&now);
  time_t localNow = now + gmtOffsetSec;
  struct tm timeinfo;
  gmtime_r(&localNow, &timeinfo);
  outHour = timeinfo.tm_hour;
  outMin  = timeinfo.tm_min;
}

bool setDeviceClockFromHMS(const String& hms) {
  int hh = 0, mm = 0, ss = 0;
  if (sscanf(hms.c_str(), "%d:%d:%d", &hh, &mm, &ss) < 2) return false;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return false;

  setenv("TZ", "GMT0", 1);
  tzset();

  time_t now;
  time(&now);
  time_t localNow = now + gmtOffsetSec;
  struct tm timeinfo;
  gmtime_r(&localNow, &timeinfo);
  if (timeinfo.tm_year < 120) {
    timeinfo.tm_year = 2026 - 1900;
    timeinfo.tm_mon  = 9;
    timeinfo.tm_mday = 23;
  }
  timeinfo.tm_hour  = hh;
  timeinfo.tm_min   = mm;
  timeinfo.tm_sec   = ss;
  timeinfo.tm_isdst = 0;

  time_t newLocalEpoch = mktime(&timeinfo);
  time_t newUtcEpoch   = newLocalEpoch - gmtOffsetSec;
  struct timeval tv;
  tv.tv_sec  = newUtcEpoch;
  tv.tv_usec = 0;
  settimeofday(&tv, NULL);
  saveCurrentEpochToNVS();
  return true;
}

// ============================================================================
// Relay / valve control
// ============================================================================

void sendTerminalLine(const String& msg) {
  Serial.println(msg);
  pendingTerminalRx   = msg;
  pendingTerminalRxId = millis();
  if (pendingTerminalRxId == 0) pendingTerminalRxId = 1;
  localStateDirty     = true;
}

void setValveState(bool open, const char* sourceTag) {
  if (open && !isMasterEnabled) {
    sendTerminalLine("ERR: Cannot open valve while System Master is OFF");
    return;
  }

  if (open && !isValveOpen) {
    valveOpenedAtMs = millis();
    if (valveOpenedAtMs == 0) valveOpenedAtMs = 1;
  } else if (!open) {
    valveOpenedAtMs = 0;
  }

  isValveOpen = open;
  digitalWrite(RELAY_PIN, isValveOpen ? HIGH : LOW);
  localStateDirty = true;

  String logMsg = String("VALVE: ") + (isValveOpen ? "ON" : "OFF") + " (" + sourceTag + ")";
  sendTerminalLine(logMsg);
}

void setMasterState(bool enabled, const char* sourceTag) {
  isMasterEnabled = enabled;
  prefs.begin("aquasmart", false);
  prefs.putBool("master", isMasterEnabled);
  prefs.end();
  localStateDirty = true;

  String logMsg = String("SYS: ") + (isMasterEnabled ? "ACTIVE" : "OFF") + " (" + sourceTag + ")";
  sendTerminalLine(logMsg);

  if (!isMasterEnabled && isValveOpen) {
    setValveState(false, "Master Interlock");
  }
}

// ============================================================================
// DS18B20 (non-blocking) + internal sensor fallback
// ============================================================================

bool oneWireReset(uint8_t pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delayMicroseconds(480);
  pinMode(pin, INPUT_PULLUP);
  delayMicroseconds(70);
  bool presence = (digitalRead(pin) == LOW);
  delayMicroseconds(410);
  return presence;
}

void oneWireWriteByte(uint8_t pin, uint8_t data) {
  for (int i = 0; i < 8; i++) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
    if (data & 1) {
      delayMicroseconds(6);
      pinMode(pin, INPUT_PULLUP);
      delayMicroseconds(64);
    } else {
      delayMicroseconds(60);
      pinMode(pin, INPUT_PULLUP);
      delayMicroseconds(10);
    }
    data >>= 1;
  }
}

uint8_t oneWireReadByte(uint8_t pin) {
  uint8_t data = 0;
  for (int i = 0; i < 8; i++) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
    delayMicroseconds(6);
    pinMode(pin, INPUT_PULLUP);
    delayMicroseconds(9);
    if (digitalRead(pin)) data |= (1 << i);
    delayMicroseconds(55);
  }
  return data;
}

float fallbackTemperature() {
  float chipTemp = temperatureRead();
  if (chipTemp > 5.0f && chipTemp < 90.0f) return chipTemp - 6.0f;
  return 26.5f;
}

float readTemperatureCelsius() {
  // Phase 1: start a conversion (DS18B20 needs ~750 ms)
  if (!tempConvPending) {
    if (oneWireReset(TEMP_PIN)) {
      oneWireWriteByte(TEMP_PIN, 0xCC);  // Skip ROM
      oneWireWriteByte(TEMP_PIN, 0x44);  // Convert T
      tempConvPending = true;
      tempConvStartMs = millis();
      return currentTempC;
    }
    return fallbackTemperature();        // no sensor attached
  }

  // Phase 2: wait for conversion, then read
  if (millis() - tempConvStartMs < 800UL) return currentTempC;
  tempConvPending = false;

  if (oneWireReset(TEMP_PIN)) {
    oneWireWriteByte(TEMP_PIN, 0xCC);
    oneWireWriteByte(TEMP_PIN, 0xBE);    // Read scratchpad
    uint8_t lsb = oneWireReadByte(TEMP_PIN);
    uint8_t msb = oneWireReadByte(TEMP_PIN);
    int16_t raw = (int16_t)((msb << 8) | lsb);
    float celsius = (float)raw / 16.0f;
    if (celsius > -30.0f && celsius < 85.0f) return celsius;
  }
  return fallbackTemperature();
}

// ============================================================================
// NVS storage & JSON helpers
// ============================================================================

String sanitizeMachineId(const String& raw) {
  String out = "";
  for (unsigned int i = 0; i < raw.length(); i++) {
    char c = raw[i];
    if (c == '.' || c == '#' || c == '$' || c == '/' || c == '[' || c == ']' || c == ' ' || c == '\t') {
      out += '-';
    } else if (c > 32 && c < 127) {
      out += c;
    }
  }
  return out;
}

String normalizeFirebaseUrl(String url) {
  url.trim();
  while (url.endsWith("/")) {
    url.remove(url.length() - 1);
  }
  if (url.startsWith("http://")) {
    url = "https://" + url.substring(7);
  }
  return url;
}

void loadConfigAndSchedulesFromNVS() {
  prefs.begin("aquasmart", true);
  wifiSsid          = prefs.getString("ssid", "");
  wifiPass          = prefs.getString("pass", "");
  firebaseUrl       = prefs.getString("dbUrl", DEFAULT_FIREBASE_DB_URL);
  machineId         = prefs.getString("machineId", DEFAULT_MACHINE_ID);
  isMasterEnabled   = prefs.getBool("master", true);
  lastProcessedTxId = prefs.getString("lastTxId", "");
  lastSchedulesRev  = prefs.getString("schedRev", "");

  for (int i = 0; i < MAX_TIMERS; i++) {
    char key[16];
    snprintf(key, sizeof(key), "t%d_en", i + 1);
    timers[i].enabled = prefs.getBool(key, false);
    snprintf(key, sizeof(key), "t%d_onH", i + 1);
    timers[i].onHour = prefs.getInt(key, 8);
    snprintf(key, sizeof(key), "t%d_onM", i + 1);
    timers[i].onMin = prefs.getInt(key, 0);
    snprintf(key, sizeof(key), "t%d_offH", i + 1);
    timers[i].offHour = prefs.getInt(key, 8);
    snprintf(key, sizeof(key), "t%d_offM", i + 1);
    timers[i].offMin = prefs.getInt(key, 15);
  }
  prefs.end();

  firebaseUrl = normalizeFirebaseUrl(firebaseUrl);
  machineId   = sanitizeMachineId(machineId);
  if (machineId.length() == 0) machineId = DEFAULT_MACHINE_ID;
}

void saveTimerSlotToNVS(int slotIndex) {
  if (slotIndex < 0 || slotIndex >= MAX_TIMERS) return;
  prefs.begin("aquasmart", false);
  char key[16];
  snprintf(key, sizeof(key), "t%d_en", slotIndex + 1);
  prefs.putBool(key, timers[slotIndex].enabled);
  snprintf(key, sizeof(key), "t%d_onH", slotIndex + 1);
  prefs.putInt(key, timers[slotIndex].onHour);
  snprintf(key, sizeof(key), "t%d_onM", slotIndex + 1);
  prefs.putInt(key, timers[slotIndex].onMin);
  snprintf(key, sizeof(key), "t%d_offH", slotIndex + 1);
  prefs.putInt(key, timers[slotIndex].offHour);
  snprintf(key, sizeof(key), "t%d_offM", slotIndex + 1);
  prefs.putInt(key, timers[slotIndex].offMin);
  prefs.end();
}

int extractJsonInt(const String& obj, const char* key, int defaultVal) {
  String pattern = String("\"") + key + "\":";
  int idx = obj.indexOf(pattern);
  if (idx < 0) return defaultVal;
  idx += pattern.length();
  while (idx < (int)obj.length() && (obj[idx] == ' ' || obj[idx] == '"')) idx++;
  return obj.substring(idx).toInt();
}

String extractJsonToken(const String& obj, const char* key) {
  String pattern = String("\"") + key + "\":";
  int idx = obj.indexOf(pattern);
  if (idx < 0) return "";
  idx += pattern.length();
  while (idx < (int)obj.length() && obj[idx] == ' ') idx++;
  if (idx >= (int)obj.length()) return "";

  if (obj[idx] == '"') {
    idx++;
    int endIdx = obj.indexOf('"', idx);
    return endIdx >= 0 ? obj.substring(idx, endIdx) : "";
  }

  int startIdx = idx;
  while (idx < (int)obj.length() && obj[idx] != ',' && obj[idx] != '}' && obj[idx] != ' ' && obj[idx] != '\r' && obj[idx] != '\n') {
    idx++;
  }
  String tok = obj.substring(startIdx, idx);
  return tok == "null" ? "" : tok;
}

String extractJsonString(const String& obj, const char* key) {
  String pattern = String("\"") + key + "\":";
  int idx = obj.indexOf(pattern);
  if (idx < 0) return "";
  idx += pattern.length();
  while (idx < (int)obj.length() && obj[idx] == ' ') idx++;
  if (idx >= (int)obj.length() || obj[idx] != '"') return "";
  idx++;

  String out = "";
  out.reserve(64);
  while (idx < (int)obj.length()) {
    char c = obj[idx++];
    if (c == '\\' && idx < (int)obj.length()) {
      char esc = obj[idx++];
      if (esc == '"') out += '"';
      else if (esc == '\\') out += '\\';
      else if (esc == '/') out += '/';
      else if (esc == 'n') out += '\n';
      else if (esc == 'r') out += '\r';
      else if (esc == 't') out += '\t';
      else out += esc;
    } else if (c == '"') {
      break;
    } else {
      out += c;
    }
  }
  return out;
}

bool extractJsonBool(const String& obj, const char* key, bool defaultVal) {
  String pattern = String("\"") + key + "\":";
  int idx = obj.indexOf(pattern);
  if (idx < 0) return defaultVal;
  idx += pattern.length();
  while (idx < (int)obj.length() && obj[idx] == ' ') idx++;
  if (obj.substring(idx).startsWith("true")) return true;
  if (obj.substring(idx).startsWith("false")) return false;
  return defaultVal;
}

void parseSchedulesJsonPayload(const String& json) {
  if (json.length() < 2) return;

  uint8_t seenSlots = 0;
  int pos = 0;

  while (pos < (int)json.length()) {
    int openBrace = json.indexOf('{', pos);
    if (openBrace < 0) break;
    int closeBrace = json.indexOf('}', openBrace);
    if (closeBrace < 0) break;

    String item  = json.substring(openBrace, closeBrace + 1);
    int id       = extractJsonInt(item, "id", -1);
    int startH   = extractJsonInt(item, "startHour", 8);
    int startM   = extractJsonInt(item, "startMinute", 0);
    int duration = extractJsonInt(item, "durationMinutes", 15);
    bool enabled = extractJsonBool(item, "isEnabled", false);

    int slot = id - 1;
    if (slot >= 0 && slot < MAX_TIMERS) {
      seenSlots |= (1 << slot);
      int endTotalMin = startM + duration;
      int endH = (startH + (endTotalMin / 60)) % 24;
      int endM = endTotalMin % 60;

      timers[slot].onHour  = startH;
      timers[slot].onMin   = startM;
      timers[slot].offHour = endH;
      timers[slot].offMin  = endM;
      timers[slot].enabled = enabled;
      saveTimerSlotToNVS(slot);
    }
    pos = closeBrace + 1;
  }

  if (seenSlots != 0) {
    for (int s = 0; s < MAX_TIMERS; s++) {
      if ((seenSlots & (1 << s)) == 0 && timers[s].enabled) {
        timers[s].enabled = false;
        saveTimerSlotToNVS(s);
      }
    }
  }
}

String escapeJsonString(const String& s) {
  String out = "";
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c >= 32) out += c;
  }
  return out;
}

String escapeHtmlAttr(const String& s) {
  String out = "";
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '&') out += "&amp;";
    else if (c == '"') out += "&quot;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else out += c;
  }
  return out;
}

// ============================================================================
// Command parser (web + serial terminal protocol)
// ============================================================================

void parseAquaSmartCommand(String rawCmd) {
  rawCmd.trim();
  if (rawCmd.length() == 0) return;

  String upper = rawCmd;
  upper.toUpperCase();

  if (upper == "AT") {
    sendTerminalLine("OK (AquaSmart ESP32-C3 Ready)");
  } else if (upper == "INFO") {
    sendTerminalLine(String("DEVICE:AquaSmart | ID:") + machineId + " | IP:" + WiFi.localIP().toString());
  } else if (upper == "STATUS") {
    String statusLine = String("SYS:") + (isMasterEnabled ? "ACTIVE" : "OFF") +
                        " | RELAY:" + (isValveOpen ? "ON" : "OFF") +
                        " | TEMP:" + String(currentTempC, 1) + "C" +
                        " | TIME:" + getFormattedTime();
    sendTerminalLine(statusLine);
  } else if (upper == "MASTER:ON" || upper == "MASTER:1") {
    setMasterState(true, "CMD");
  } else if (upper == "MASTER:OFF" || upper == "MASTER:0") {
    setMasterState(false, "CMD");
  } else if (upper == "RELAY:ON" || upper == "VALVE:ON") {
    setValveState(true, "CMD");
  } else if (upper == "RELAY:OFF" || upper == "VALVE:OFF") {
    setValveState(false, "CMD");
  } else if (upper.startsWith("TIME:")) {
    String tVal = rawCmd.substring(5);
    tVal.trim();
    if (setDeviceClockFromHMS(tVal)) {
      sendTerminalLine("TIME:" + getFormattedTime());
    } else {
      sendTerminalLine("ERR: Invalid TIME format (use HH:MM:SS)");
    }
  } else if (upper.startsWith("TZ:")) {
    long newTz = rawCmd.substring(3).toInt();
    gmtOffsetSec = newTz;
    prefs.begin("aquasmart", false);
    prefs.putLong("gmtOffset", gmtOffsetSec);
    prefs.end();
    sendTerminalLine("TZ_UPDATED:" + String(gmtOffsetSec));
  } else if (upper.startsWith("MAXOPEN:")) {
    int mins = rawCmd.substring(8).toInt();
    if (mins >= 1 && mins <= 1440) {
      maxOpenMinutes = mins;
      prefs.begin("aquasmart", false);
      prefs.putInt("maxOpenMin", maxOpenMinutes);
      prefs.end();
      sendTerminalLine("MAXOPEN_UPDATED:" + String(maxOpenMinutes) + "m");
    }
  } else if (upper.startsWith("SET_ID:")) {
    String newId = sanitizeMachineId(rawCmd.substring(7));
    if (newId.length() > 0) {
      machineId = newId;
      prefs.begin("aquasmart", false);
      prefs.putString("machineId", machineId);
      prefs.end();
      bootSyncPending = true;
      sendTerminalLine("MACHINE_ID_SAVED:" + machineId);
    }
  } else if (upper.startsWith("SET_DB:")) {
    String newDb = normalizeFirebaseUrl(rawCmd.substring(7));
    if (newDb.length() > 0) {
      firebaseUrl = newDb;
      prefs.begin("aquasmart", false);
      prefs.putString("dbUrl", firebaseUrl);
      prefs.end();
      bootSyncPending = true;
      sendTerminalLine("FIREBASE_URL_SAVED:" + firebaseUrl);
    }
  } else if (upper == "RESET_WIFI") {
    prefs.begin("aquasmart", false);
    prefs.remove("ssid");
    prefs.remove("pass");
    prefs.end();
    sendTerminalLine("WIFI_CLEARED: restarting into setup mode");
    delay(500);
    ESP.restart();
  } else if (upper == "SYNC:START") {
    pendingOnMask = 0;
    sendTerminalLine("SYNC:READY");
  } else if (upper == "SYNC:DONE") {
    pendingOnMask = 0;
    sendTerminalLine("SYNC:COMPLETED");
  } else if (upper.startsWith("T") && upper.indexOf(':') > 0) {
    int disableIdx = upper.indexOf(":DISABLE");
    if (disableIdx < 0) disableIdx = upper.indexOf(":OFF");
    if (disableIdx > 1) {
      int slot = upper.substring(1, disableIdx).toInt() - 1;
      if (slot >= 0 && slot < MAX_TIMERS) {
        timers[slot].enabled = false;
        pendingOnMask &= ~(1 << slot);
        saveTimerSlotToNVS(slot);
        sendTerminalLine("SAVED: T" + String(slot + 1) + " DISABLED");
      }
      return;
    }

    int onIdx  = upper.indexOf("ON:");
    int offIdx = upper.indexOf("OFF:");
    if (onIdx > 1) {
      int slot = upper.substring(1, onIdx).toInt() - 1;
      String hms = upper.substring(onIdx + 3);
      int hh = 0, mm = 0;
      if (slot >= 0 && slot < MAX_TIMERS && sscanf(hms.c_str(), "%d:%d", &hh, &mm) == 2) {
        timers[slot].onHour  = hh;
        timers[slot].onMin   = mm;
        timers[slot].enabled = true;
        pendingOnMask |= (1 << slot);
        saveTimerSlotToNVS(slot);
        sendTerminalLine("SAVED: T" + String(slot + 1) + " ON @ " + hms);
      }
    } else if (offIdx > 1) {
      int slot = upper.substring(1, offIdx).toInt() - 1;
      String hms = upper.substring(offIdx + 4);
      int hh = 0, mm = 0;
      if (slot >= 0 && slot < MAX_TIMERS && sscanf(hms.c_str(), "%d:%d", &hh, &mm) == 2) {
        bool hadRecentOn = (pendingOnMask & (1 << slot)) != 0;
        pendingOnMask &= ~(1 << slot);

        if (hms == "00:00:00" && !hadRecentOn) {
          timers[slot].enabled = false;
          saveTimerSlotToNVS(slot);
          sendTerminalLine("SAVED: T" + String(slot + 1) + " DISABLED");
        } else {
          timers[slot].offHour = hh;
          timers[slot].offMin  = mm;
          saveTimerSlotToNVS(slot);
          sendTerminalLine("SAVED: T" + String(slot + 1) + " OFF @ " + hms);
        }
      }
    }
  }
}

// ============================================================================
// Schedule + safety watchdog
// ============================================================================

void evaluateSchedulesAndSafety() {
  currentTempC = readTemperatureCelsius();

  // 1. Safety auto-shutoff
  if (isValveOpen && valveOpenedAtMs > 0) {
    unsigned long maxOpenMs = (unsigned long)maxOpenMinutes * 60UL * 1000UL;
    if (millis() - valveOpenedAtMs >= maxOpenMs) {
      setValveState(false, "Safety Auto-Shutoff Watchdog");
    }
  }

  // 2. Save epoch every 10 minutes
  if (millis() - lastEpochSaveMs > 600000UL) {
    lastEpochSaveMs = millis();
    saveCurrentEpochToNVS();
  }

  // 3. Evaluate schedules once per minute
  int currHour = 0, currMin = 0;
  getCurrentHourMin(currHour, currMin);

  if (currMin == lastCheckedMin) return;
  lastCheckedMin = currMin;

  if (!isMasterEnabled) return;

  for (int i = 0; i < MAX_TIMERS; i++) {
    if (!timers[i].enabled) continue;

    if (currHour == timers[i].onHour && currMin == timers[i].onMin) {
      String tag = "Schedule T" + String(i + 1) + " ON";
      setValveState(true, tag.c_str());
    } else if (currHour == timers[i].offHour && currMin == timers[i].offMin) {
      String tag = "Schedule T" + String(i + 1) + " OFF";
      setValveState(false, tag.c_str());
    }
  }
}

// ============================================================================
// Firebase Realtime Database sync
// ============================================================================

void syncWithFirebaseCloud() {
  if (WiFi.status() != WL_CONNECTED || firebaseUrl.length() < 10) return;

  httpsClient.setInsecure();
  firebaseHttp.setReuse(true);
  firebaseHttp.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  firebaseHttp.setTimeout(3500);

  String baseUrl = firebaseUrl + "/aquasmart/machines/" + machineId;
  bool anyTransportFailure = false;

  // 1. Read desired state, schedules & commands
  if (bootSyncPending || !localStateDirty) {
    if (firebaseHttp.begin(httpsClient, baseUrl + "/state.json")) {
      int code = firebaseHttp.GET();
      if (code == 200) {
        String body = firebaseHttp.getString();
        if (body.length() > 2 && body != "null") {
          int remoteMaster = extractJsonInt(body, "master", isMasterEnabled ? 1 : 0);
          if ((remoteMaster == 1) != isMasterEnabled) {
            setMasterState(remoteMaster == 1, "Firebase Cloud");
          }

          if (!bootSyncPending) {
            int remoteValve = extractJsonInt(body, "valve", isValveOpen ? 1 : 0);
            if (isMasterEnabled && (remoteValve == 1) != isValveOpen) {
              setValveState(remoteValve == 1, "Firebase Cloud");
            }
          }

          String schedRev = extractJsonToken(body, "schedulesRev");
          if (schedRev.length() > 0 && schedRev != "0" && schedRev != lastSchedulesRev) {
            String schedJson = extractJsonString(body, "schedulesJson");
            if (schedJson.length() > 2) {
              parseSchedulesJsonPayload(schedJson);
              lastSchedulesRev = schedRev;
              prefs.begin("aquasmart", false);
              prefs.putString("schedRev", lastSchedulesRev);
              prefs.end();
              sendTerminalLine("SAVED: Schedules synced to ESP32-C3 NVS");
            }
          }

          String txId  = extractJsonToken(body, "terminalTxId");
          String txCmd = extractJsonString(body, "terminalTx");
          if (txId.length() > 0 && txId != "0" && txId != lastProcessedTxId) {
            bool wasFirstEverSync = (bootSyncPending && lastProcessedTxId.length() == 0);
            lastProcessedTxId = txId;
            prefs.begin("aquasmart", false);
            prefs.putString("lastTxId", lastProcessedTxId);
            prefs.end();

            if (!wasFirstEverSync && txCmd.length() > 0) {
              parseAquaSmartCommand(txCmd);
            }
          }
        }
        bootSyncPending = false;
      } else if (code <= 0) {
        anyTransportFailure = true;
      }
      firebaseHttp.end();
    }
  }

  // 2. Heartbeat
  heartbeatSeq++;
  if (firebaseHttp.begin(httpsClient, baseUrl + "/info.json")) {
    firebaseHttp.addHeader("Content-Type", "application/json");
    String infoJson = String("{\"machineId\":\"") + escapeJsonString(machineId) +
                      "\",\"ip\":\"" + WiFi.localIP().toString() +
                      "\",\"lastSeenEpochMs\":{\".sv\":\"timestamp\"}" +
                      ",\"heartbeatSeq\":" + String(heartbeatSeq) +
                      ",\"gmtOffsetSec\":" + String(gmtOffsetSec) +
                      ",\"maxOpenMinutes\":" + String(maxOpenMinutes) + "}";
    int code = firebaseHttp.PATCH(infoJson);
    if (code <= 0) anyTransportFailure = true;
    firebaseHttp.end();
  }

  // 3. Telemetry + terminal response
  if (firebaseHttp.begin(httpsClient, baseUrl + "/state.json")) {
    firebaseHttp.addHeader("Content-Type", "application/json");
    String stateJson = String("{\"master\":") + (isMasterEnabled ? "1" : "0") +
                       ",\"valve\":" + (isValveOpen ? "1" : "0") +
                       ",\"temp\":" + String(currentTempC, 1) +
                       ",\"time\":\"" + getFormattedTime() + "\"";
    if (pendingTerminalRx.length() > 0) {
      stateJson += ",\"terminalRx\":\"" + escapeJsonString(pendingTerminalRx) +
                   "\",\"terminalRxId\":" + String(pendingTerminalRxId);
      pendingTerminalRx = "";
    }
    stateJson += "}";
    int code = firebaseHttp.PATCH(stateJson);
    if (code <= 0) anyTransportFailure = true;
    firebaseHttp.end();
  }

  if (anyTransportFailure) {
    httpsClient.stop();
  }

  localStateDirty = false;
}

// ============================================================================
// Captive portal ("AquaSmart-Setup")
// ============================================================================

void redirectToPortal() {
  portalServer.sendHeader("Location", "http://192.168.4.1/", true);
  portalServer.send(302, "text/plain", "");
}

void startWiFiProvisioningPortal() {
  portalActive = true;

  // Stop any station reconnect activity that would hop channels and kill the AP
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(true, false);
  delay(100);

  WiFi.mode(WIFI_AP_STA);
  delay(100);

  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1), IPAddress(255, 255, 255, 0));
  bool ok = WiFi.softAP(AP_SSID, NULL, AP_CHANNEL, 0, 4);   // open network, channel 1, max 4 clients
  WiFi.setTxPower(WIFI_TX_POWER);
  delay(200);

  Serial.println("================================================");
  Serial.println(ok ? "SoftAP started OK" : "SoftAP FAILED");
  Serial.print("Wi-Fi Setup Hotspot: ");
  Serial.println(AP_SSID);
  Serial.print("Open in browser: http://");
  Serial.println(WiFi.softAPIP());
  Serial.println("================================================");

  // DNS: answer every lookup with our IP so phones auto-open the setup page
  dnsServer.start(53, "*", WiFi.softAPIP());

  if (portalRoutesInit) return;
  portalRoutesInit = true;

  portalServer.on("/scan", HTTP_GET, []() {
    int n = WiFi.scanNetworks(false, false, false, 120);
    String json = "[";
    for (int i = 0; i < n; i++) {
      String ssid = WiFi.SSID(i);
      if (ssid.length() == 0) continue;
      if (json.length() > 1) json += ",";
      json += "{\"ssid\":\"" + escapeJsonString(ssid) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
    }
    json += "]";
    WiFi.scanDelete();
    portalServer.send(200, "application/json", json);
  });

  portalServer.on("/", HTTP_GET, []() {
    String prefillId = portalServer.hasArg("machineId") ? portalServer.arg("machineId") : machineId;
    String prefillDb = portalServer.hasArg("dbUrl") ? portalServer.arg("dbUrl") : firebaseUrl;

    String html = R"rawliteral(
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AquaSmart Wi-Fi Setup</title>
<style>
  body{background:#0A1929;color:#fff;font-family:sans-serif;padding:20px;max-width:440px;margin:auto}
  .card{background:#1E2D3D;padding:22px;border-radius:14px;border:1px solid rgba(255,255,255,0.15)}
  h2{color:#00BFA5;margin-top:0;margin-bottom:6px}
  label{display:block;margin:12px 0 4px;font-size:13px;color:#b0bec5;font-weight:600}
  input{width:100%;padding:11px;border-radius:8px;border:1px solid #37474f;background:#0D2137;color:#fff;box-sizing:border-box;font-size:15px}
  button{margin-top:16px;width:100%;padding:13px;background:#00BFA5;color:#0A1929;border:none;border-radius:8px;font-weight:bold;font-size:16px;cursor:pointer}
  .scan-btn{margin-top:8px;padding:9px;background:#132F4C;color:#64ffda;border:1px solid #00BFA5;font-size:13px}
  .net-list{margin-top:8px;display:flex;flex-direction:column;gap:6px}
  .net-item{padding:8px 10px;background:#0D2137;border:1px solid #263238;border-radius:6px;font-size:13px;cursor:pointer;display:flex;justify-content:space-between}
</style></head><body>
<div class="card">
  <h2>AquaSmart Wi-Fi Setup</h2>
  <p style="font-size:13px;color:#90a4ae;margin-top:0">Connect your irrigation controller to your 2.4 GHz Wi-Fi network.</p>
  <button type="button" class="scan-btn" onclick="scanNet(this)">Scan Nearby 2.4 GHz Wi-Fi Networks</button>
  <div id="nets" class="net-list"></div>
  <form action="/save" method="POST">
    <label>Wi-Fi Network Name (2.4 GHz SSID)</label>
    <input id="ssid" name="ssid" required placeholder="Tap Scan above or type 2.4 GHz Wi-Fi name">
    <label>Wi-Fi Password</label>
    <input name="pass" type="password" placeholder="Wi-Fi Password (leave blank if open)">
    <label>Assigned Machine ID (Serial)</label>
    <input name="machineId" required value=")rawliteral" + escapeHtmlAttr(prefillId) + R"rawliteral(">
    <label>Firebase Cloud Database URL</label>
    <input name="dbUrl" required placeholder="https://your-project-default-rtdb.firebaseio.com" value=")rawliteral" + escapeHtmlAttr(prefillDb) + R"rawliteral(">
    <button type="submit">Save &amp; Connect Machine</button>
  </form>
</div>
<script>
function scanNet(btn){
  btn.textContent='Scanning 2.4 GHz networks...';
  fetch('/scan').then(r=>r.json()).then(list=>{
    btn.textContent='Refresh 2.4 GHz Wi-Fi List';
    var box=document.getElementById('nets');
    box.innerHTML='';
    var seen={};
    list.forEach(function(n){
      if(seen[n.ssid]) return;
      seen[n.ssid]=true;
      var d=document.createElement('div');
      d.className='net-item';
      var s1=document.createElement('span'); s1.textContent=n.ssid;
      var s2=document.createElement('span'); s2.style.color='#00BFA5'; s2.textContent=n.rssi+' dBm';
      d.appendChild(s1); d.appendChild(s2);
      d.onclick=function(){ document.getElementById('ssid').value=n.ssid; };
      box.appendChild(d);
    });
    if(!box.children.length) box.textContent='No 2.4 GHz networks found nearby.';
  }).catch(function(){ btn.textContent='Scan Nearby 2.4 GHz Wi-Fi Networks'; });
}
</script>
</body></html>
)rawliteral";
    portalServer.send(200, "text/html", html);
  });

  portalServer.on("/save", HTTP_POST, []() {
    String newSsid = portalServer.arg("ssid");
    String newPass = portalServer.arg("pass");
    String newId   = sanitizeMachineId(portalServer.arg("machineId"));
    String newDb   = normalizeFirebaseUrl(portalServer.arg("dbUrl"));
    newSsid.trim();

    if (newSsid.length() > 0) {
      prefs.begin("aquasmart", false);
      prefs.putString("ssid", newSsid);
      prefs.putString("pass", newPass);
      if (newId.length() > 0) prefs.putString("machineId", newId);
      if (newDb.length() > 0) prefs.putString("dbUrl", newDb);
      prefs.end();

      portalServer.send(
        200,
        "text/html",
        "<html><body style='background:#0A1929;color:#00BFA5;font-family:sans-serif;text-align:center;padding:40px;'>"
        "<h2>Saved! Connecting AquaSmart to Wi-Fi...</h2>"
        "<p style='color:#fff;'>Reconnect your phone to the internet and open your AquaSmart Web Dashboard.</p></body></html>"
      );
      portalServer.client().flush();
      delay(2000);
      ESP.restart();
    } else {
      portalServer.send(400, "text/plain", "Wi-Fi SSID is required");
    }
  });

  // Captive-portal detection URLs (Android, iOS, Windows) and anything else -> setup page
  portalServer.onNotFound(redirectToPortal);

  portalServer.begin();
}

void stopWiFiProvisioningPortal() {
  portalActive = false;
  dnsServer.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_TX_POWER);
  WiFi.setAutoReconnect(true);
}

// ============================================================================
// Setup & Loop
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  pinMode(RESET_BTN_PIN, INPUT_PULLUP);

  restoreEpochFromNVS();
  loadConfigAndSchedulesFromNVS();

  Serial.println("\n--- AquaSmart ESP32-C3 Booting (Firebase Edition v2) ---");
  Serial.println("Machine ID: " + machineId);

  // Brand-new unit -> hotspot immediately, no STA activity at all
  if (wifiSsid.length() == 0) {
    Serial.println("No saved Wi-Fi found - starting AquaSmart-Setup hotspot.");
    startWiFiProvisioningPortal();
    return;
  }

  Serial.print("Connecting to saved Wi-Fi: ");
  Serial.println(wifiSsid);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  WiFi.setTxPower(WIFI_TX_POWER);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startAttempt) < 12000) {
    delay(350);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi Connected! IP: ");
    Serial.println(WiFi.localIP());
    configTime(0, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
    delay(500);
    saveCurrentEpochToNVS();
  } else {
    Serial.println("Home router not ready - opening backup AquaSmart-Setup AP; will retry saved Wi-Fi every 60 s.");
    lastWifiRetryMs = millis();
    startWiFiProvisioningPortal();
  }
}

void loop() {
  if (portalActive) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
  }

  // ---- Wi-Fi recovery (power cuts / router reboot) ----
  if (wifiSsid.length() > 0) {
    bool connected = (WiFi.status() == WL_CONNECTED);

    if (connected && portalActive && WiFi.softAPgetStationNum() == 0) {
      // Home Wi-Fi came back and nobody is using the setup hotspot
      Serial.print("Saved Wi-Fi recovered! IP: ");
      Serial.println(WiFi.localIP());
      wifiRetryActive = false;
      stopWiFiProvisioningPortal();
      configTime(0, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
      bootSyncPending = true;
    } else if (!connected) {
      if (wifiRetryActive) {
        // Give the attempt a fixed window, then stop so the hotspot stays stable
        if (millis() - wifiRetryStartMs >= WIFI_RETRY_WINDOW_MS) {
          wifiRetryActive = false;
          if (portalActive) {
            WiFi.setAutoReconnect(false);
            WiFi.disconnect(false, false);
          }
          lastWifiRetryMs = millis();
        }
      } else if (millis() - lastWifiRetryMs >= WIFI_RETRY_INTERVAL_MS) {
        lastWifiRetryMs = millis();
        // Never retry while a phone is using the setup page
        if (!portalActive || WiFi.softAPgetStationNum() == 0) {
          Serial.println("Retrying saved Wi-Fi: " + wifiSsid);
          wifiRetryActive  = true;
          wifiRetryStartMs = millis();
          WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
        }
      }
    } else {
      wifiRetryActive = false;
    }
  }

  // ---- Schedules & safety watchdog every 2 s (works offline) ----
  if (millis() - lastScheduleCheckMs >= 2000UL) {
    lastScheduleCheckMs = millis();
    evaluateSchedulesAndSafety();
  }

  // ---- Cloud sync every 2.5 s (or immediately on local change) ----
  if (!portalActive && WiFi.status() == WL_CONNECTED) {
    if (bootSyncPending || localStateDirty || (millis() - lastCloudSyncMs >= 2500UL)) {
      lastCloudSyncMs = millis();
      syncWithFirebaseCloud();
    }
  }

  // ---- USB serial commands ----
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuffer.length() > 0) {
        parseAquaSmartCommand(serialBuffer);
        serialBuffer = "";
      }
    } else {
      serialBuffer += c;
    }
  }

  // ---- Hold BOOT (GPIO 9) 5 s to clear Wi-Fi and enter setup ----
  if (digitalRead(RESET_BTN_PIN) == LOW) {
    if (btnPressStartMs == 0) {
      btnPressStartMs = millis();
    } else if (millis() - btnPressStartMs > 5000) {
      Serial.println("Resetting Wi-Fi Credentials -> Launching AquaSmart-Setup...");
      prefs.begin("aquasmart", false);
      prefs.remove("ssid");
      prefs.remove("pass");
      prefs.end();
      delay(500);
      ESP.restart();
    }
  } else {
    btnPressStartMs = 0;
  }
}
