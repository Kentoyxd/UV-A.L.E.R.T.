#include <WiFi.h>
#include <WiFiMulti.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "web_server.h"

// Wi-Fi Multi Configuration (Multiple networks)
WiFiMulti wifiMulti;

// Hardware Pins
const int buzzerPin = 5;
const int ledR = 18, ledG = 19, ledB = 23;
const int i2cSDA = 21, i2cSCL = 22;

LiquidCrystal_I2C lcd(0x27, 20, 4);

WebServer server(8080); // Using Port 8080

bool alarmActive = false;
String customMessage = "SYSTEM IDLE";
String currentBuilding = ""; 

// Tracks alert screen state
bool alertDisplayShown = false;
String lastDisplayedBuilding = "";

// --- NDRRMC TIMING PATTERN ---
// Pattern: 800ms ON, 200ms OFF (repeated 3x), then 1500ms OFF
const int alertPattern[] = {800, 200, 800, 200, 800, 1500};
const int alertPatternLength = 6;
int alertPatternIndex = 0;
unsigned long lastPatternStepTime = 0;

void setRGB(uint8_t r, uint8_t g, uint8_t b) {
  ledcWrite(ledR, r);
  ledcWrite(ledG, g);
  ledcWrite(ledB, b);
}

void ledOff() {
  setRGB(0, 0, 0);
}

void setRGBForBuilding(const String &building) {
  struct BuildingColor { const char* name; uint8_t r, g, b; };
  static BuildingColor colors[] = {
    {"Administration Building", 255, 0, 0},
    {"Inday Pining Building",   0, 255, 0},
    {"Inday Teresing Building", 0, 0, 255},
    {"Inday Teresita Building", 255, 255, 0},
    {"Don Vincente Building",   255, 0, 255},
    {"Gymnasium",               0, 255, 255},
  };
  for (auto &b : colors) {
    if (building == b.name) { setRGB(b.r, b.g, b.b); return; }
  }
  setRGB(255, 255, 255); // fallback: unknown/unset building = white
}

void updateScreen(const String& line1, const String& line2, const String& line3, const String& line4) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(line1.substring(0, 20));
  lcd.setCursor(0, 1); lcd.print(line2.substring(0, 20));
  lcd.setCursor(0, 2); lcd.print(line3.substring(0, 20));
  lcd.setCursor(0, 3); lcd.print(line4.substring(0, 20));
}

void showAlertScreen(const String &building) {
  String line3 = building;
  String line4 = "";

  if (building.length() > 20) {
    int splitIndex = building.lastIndexOf(' ', 20);
    if (splitIndex == -1) splitIndex = 20; 
    line3 = building.substring(0, splitIndex);
    line4 = building.substring(splitIndex + 1);
  }

  updateScreen("!! UV-ALERT !!", customMessage, line3, line4);
}

void setup() {
  Serial.begin(115200);

  pinMode(buzzerPin, OUTPUT);
  digitalWrite(buzzerPin, LOW);

  ledcAttach(ledR, 5000, 8);
  ledcAttach(ledG, 5000, 8);
  ledcAttach(ledB, 5000, 8);
  ledOff();

  Wire.begin(i2cSDA, i2cSCL); 
  lcd.init();
  lcd.backlight();

  updateScreen("Connecting to Wi-Fi", "Please wait...", "", "");

  WiFi.mode(WIFI_STA);

  // --- YOUR MULTIPLE NETWORKS CONFIGURATION ---
  wifiMulti.addAP("Kent", "Kentoyixd");                     // 1st Network
  wifiMulti.addAP("NATNAT-2.4G", "incorrect712");             // 2nd Network
  wifiMulti.addAP("THIRD_SSID_PLACEHOLDER", "THIRD_PASSWORD");// 3rd Network (Placeholder)

  // Try connecting until one of the networks becomes available
  while (wifiMulti.run() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  String ipLine = WiFi.localIP().toString() + ":8080";
  updateScreen("Connected!", "IP in VS Code:", ipLine, "");
  delay(2500);

  setupWebServer();
  updateScreen("Connected: 8080", customMessage, "", "");
}

void loop() {
  // Checks if connection drops mid-runtime and attempts to reconnect via Multi
  if (wifiMulti.run() != WL_CONNECTED) {
    Serial.println("WiFi disconnected! Reconnecting...");
  }

  server.handleClient();
  pollFirebaseAlarm();

  if (alarmActive) {
    unsigned long currentMillis = millis();

    // 1. Update the screen ONCE per alert trigger
    if (!alertDisplayShown || lastDisplayedBuilding != currentBuilding) {
      showAlertScreen(currentBuilding);
      lastDisplayedBuilding = currentBuilding;
      alertDisplayShown = true;
      
      // Reset the alarm rhythm so it always starts cleanly on a fresh beep
      alertPatternIndex = 0;
      lastPatternStepTime = currentMillis;
    }

    // 2. Advance the rhythm pattern based on millis()
    if (currentMillis - lastPatternStepTime >= alertPattern[alertPatternIndex]) {
      lastPatternStepTime = currentMillis;
      alertPatternIndex = (alertPatternIndex + 1) % alertPatternLength;
    }

    // Even indexes (0, 2, 4) in our array represent the ON state. Odd indexes are OFF.
    bool isBeeping = (alertPatternIndex % 2 == 0); 

    if (isBeeping) {
      // ACTIVE BUZZER: Just turn it on solid HIGH during the 800ms burst
      digitalWrite(buzzerPin, HIGH);

      // Keep the intense 50ms strobe effect on the LEDs for visual panic
      bool strobeHigh = ((currentMillis / 50) % 2 == 0);
      if (strobeHigh) {
        setRGBForBuilding(currentBuilding);
      } else {
        ledOff();
      }
    } else {
      // Silence during the OFF periods of the rhythm
      digitalWrite(buzzerPin, LOW); 
      ledOff();
    }

  } else {
    // Alarm is completely off
    digitalWrite(buzzerPin, LOW);
    ledOff();
    alertDisplayShown = false; 
  }
}