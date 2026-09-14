#pragma once
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h> // Library Manager > "ArduinoJson" by Benoit Blanchon

extern WebServer server;
extern bool alarmActive;
extern String customMessage;
extern String currentBuilding;
extern const int buzzerPin;

void updateScreen(const String &line1, const String &line2, const String &line3 = "", const String &line4 = "");
void setRGB(uint8_t r, uint8_t g, uint8_t b);
void ledOff();
void setRGBForBuilding(const String &building);

// ============================================================
// Fill this in with your Firebase Realtime Database URL, e.g.
// "https://uvalert-1234-default-rtdb.firebaseio.com"
// (Project settings > Realtime Database, same value as
// databaseURL in js/config.js on the web app.)
// ============================================================
static const char *FIREBASE_DB_URL = "https://uv-main-alert-default-rtdb.asia-southeast1.firebasedatabase.app/";

// How often the board checks Firebase for a new alert, in ms.
static const unsigned long FIREBASE_POLL_INTERVAL = 2000;
static unsigned long lastFirebasePoll = 0;

// Tracks the alertId currently driving the buzzer/LED so we don't
// re-trigger on every poll while the same alert is still active.
static String lastHandledAlertId = "";

// Helper to add CORS headers so the dashboard (or Live Server while
// developing) is allowed to connect to the local endpoints below.
inline void setCorsHeaders()
{
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
}

inline void handleOptions()
{
  setCorsHeaders();
  server.send(204);
}

inline void handleAlarmOn()
{
  setCorsHeaders();
  alarmActive = true;
  customMessage = "!UV-ALERT!";
  currentBuilding = ""; // manual trigger has no building context
  server.send(200, "text/plain", "Alarm Triggered");
}

inline void handleAlarmOff()
{
  setCorsHeaders();
  alarmActive = false;
  digitalWrite(buzzerPin, LOW);
  ledOff();
  customMessage = "SYSTEM IDLE";
  currentBuilding = "";
  updateScreen("Connected to Wi-Fi", customMessage, "", "");
  server.send(200, "text/plain", "Alarm Silenced");
}

inline void handleSetMessage()
{
  setCorsHeaders();
  if (server.hasArg("msg"))
  {
    customMessage = server.arg("msg");
    alarmActive = false;
    digitalWrite(buzzerPin, LOW);
    ledOff();
    currentBuilding = "";
    updateScreen("Message Received", customMessage, "", "");
    server.send(200, "text/plain", "Message Displayed");
  }
  else
  {
    server.send(400, "text/plain", "Missing msg parameter");
  }
}

inline void setupWebServer()
{
  // Catch pre-flight requests from the browser
  server.on("/alarm/on", HTTP_OPTIONS, handleOptions);
  server.on("/alarm/off", HTTP_OPTIONS, handleOptions);
  server.on("/setmessage", HTTP_OPTIONS, handleOptions);

  // Local endpoint routes — used by the dashboard's manual controls
  // and for testing on-site without depending on Firebase.
  server.on("/alarm/on", HTTP_GET, handleAlarmOn);
  server.on("/alarm/off", HTTP_GET, handleAlarmOff);
  server.on("/setmessage", HTTP_GET, handleSetMessage);

  server.begin();
}

// ============================================================
// Firebase polling — this is what makes the alarm fire on its own
// whenever a student sends an alert, with no browser needing to be
// open. Call pollFirebaseAlarm() once per loop() from your main sketch.
// ============================================================
inline void pollFirebaseAlarm()
{
  unsigned long now = millis();
  if (now - lastFirebasePoll < FIREBASE_POLL_INTERVAL)
    return;
  lastFirebasePoll = now;

  if (String(FIREBASE_DB_URL) == "PASTE_ME")
    return; // not configured yet
  if (WiFi.status() != WL_CONNECTED)
    return;

  WiFiClientSecure client;
  client.setInsecure(); // MVP-level TLS: skips cert validation. See README for hardening notes.

  HTTPClient https;
  String url = String(FIREBASE_DB_URL) + "/alarm.json";
  if (!https.begin(client, url))
    return;

  int code = https.GET();
  if (code == 200)
  {
    String payload = https.getString();
    StaticJsonDocument<384> doc; // bumped from 256 to fit the added "building" field
    if (deserializeJson(doc, payload) == DeserializationError::Ok && !doc.isNull())
    {
      bool active = doc["active"] | false;
      String alertId = doc["alertId"] | "";
      String message = doc["message"] | "!UV-ALERT!";
      String building = doc["building"] | "";

      if (active && alertId != lastHandledAlertId)
      {
        // New alert we haven't reacted to yet.
        alarmActive = true;
        customMessage = message;
        currentBuilding = building;
        lastHandledAlertId = alertId;
      }
      else if (!active && alarmActive && alertId == lastHandledAlertId)
      {
        // Security (or the student) resolved the alert this board was reacting to.
        alarmActive = false;
        digitalWrite(buzzerPin, LOW);
        ledOff();
        customMessage = "SYSTEM IDLE";
        currentBuilding = "";
        updateScreen("Connected to Wi-Fi", customMessage, "", "");
        lastHandledAlertId = "";
      }
    }
  }
  https.end();
}