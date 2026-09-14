#include <WiFi.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "web_server.h"

// Wi-Fi Configuration
const char *ssid = "Kent";
const char *password = "Kentoyixd:)a";

// Hardware Pins — now on the OTHER exposed GPIO row:
// 3V3, GND, D15, D2, D4, RX2, TX2, D5, D18, D19, D21, RX0, TX0, D22, D23
//
// D15 and D2 are boot-strapping pins — left unused to avoid boot issues.
// RX0/TX0 (UART0) are reserved for USB/Serial — left unused so uploading
// and Serial.print() debugging keep working.
// D21/D22 are ESP32's default I2C pins (SDA/SCL) — used here for that reason.
const int buzzerPin = 5;
const int ledR = 18, ledG = 19, ledB = 23;
const int i2cSDA = 21, i2cSCL = 22;

// LCD is 20x4. VCC/GND now come straight from the board's own 3V3/GND
// pins on this row — no external power supply needed anymore.
LiquidCrystal_I2C lcd(0x27, 20, 4); // change to 0x3F if your module uses that address

WebServer server(8080); // Using Port 8080

bool alarmActive = false;
String customMessage = "SYSTEM IDLE";
String currentBuilding = ""; // set by pollFirebaseAlarm() / handleAlarmOn(), read here for RGB color
unsigned long lastBlinkTime = 0;
bool alertOutputState = false;

// Tracks whether the alert text is already drawn on screen, and for
// which building, so updateScreen() only runs once per alert instead
// of on every blink cycle (that's what was causing the flicker).
bool alertDisplayShown = false;
String lastDisplayedBuilding = "";

void setRGB(uint8_t r, uint8_t g, uint8_t b)
{
  ledcWrite(ledR, r);
  ledcWrite(ledG, g);
  ledcWrite(ledB, b);
}

void ledOff()
{
  setRGB(0, 0, 0);
}

void setRGBForBuilding(const String &building)
{
  struct BuildingColor
  {
    const char *name;
    uint8_t r, g, b;
  };
  static BuildingColor colors[] = {
      {"Administration Building", 255, 0, 0},
      {"Inday Pining Building", 0, 255, 0},
      {"Inday Teresing Building", 0, 0, 255},
      {"Inday Teresita Building", 255, 255, 0},
      {"Don Vincente Building", 255, 0, 255},
      {"Gymnasium", 0, 255, 255},
  };
  for (auto &b : colors)
  {
    if (building == b.name)
    {
      setRGB(b.r, b.g, b.b);
      return;
    }
  }
  setRGB(255, 255, 255); // fallback: unknown/unset building = white
}

void updateScreen(const String &line1, const String &line2, const String &line3, const String &line4)
{
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, 20));
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, 20));
  lcd.setCursor(0, 2);
  lcd.print(line3.substring(0, 20));
  lcd.setCursor(0, 3);
  lcd.print(line4.substring(0, 20));
}

// Splits a building name across two 20-char lines at the nearest
// word boundary instead of hard-truncating mid-word, then draws the
// full alert screen once.
void showAlertScreen(const String &building)
{
  String line3 = building;
  String line4 = "";

  if (building.length() > 20)
  {
    int splitIndex = building.lastIndexOf(' ', 20);
    if (splitIndex == -1)
      splitIndex = 20; // no space found, hard cut as last resort
    line3 = building.substring(0, splitIndex);
    line4 = building.substring(splitIndex + 1);
  }

  updateScreen("!! UV-ALERT !!", customMessage, line3, line4);
}

void setup()
{
  Serial.begin(115200);

  pinMode(buzzerPin, OUTPUT);
  digitalWrite(buzzerPin, LOW);

  ledcAttach(ledR, 5000, 8);
  ledcAttach(ledG, 5000, 8);
  ledcAttach(ledB, 5000, 8);
  ledOff();

  Wire.begin(i2cSDA, i2cSCL); // must come before lcd.init()
  lcd.init();
  lcd.backlight();

  // Connecting screen
  updateScreen("Connecting to:", ssid, "", "");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }

  // Show IP & Port on display
  String ipLine = WiFi.localIP().toString() + ":8080";
  updateScreen("Connected!", "IP in VS Code:", ipLine, "");
  delay(2500);

  // Initialize Web Routes from web_server.h
  setupWebServer();
  updateScreen("Connected: 8080", customMessage, "", "");
}

void loop()
{
  server.handleClient();
  pollFirebaseAlarm();

  if (alarmActive)
  {
    unsigned long currentMillis = millis();

    // Draw the alert text ONCE when the alert starts (or the building
    // changes) instead of every blink cycle — this stops the flicker.
    if (!alertDisplayShown || lastDisplayedBuilding != currentBuilding)
    {
      showAlertScreen(currentBuilding);
      lastDisplayedBuilding = currentBuilding;
      alertDisplayShown = true;
    }

    // Buzzer + LED still blink on their own 200ms cycle; screen untouched.
    if (currentMillis - lastBlinkTime >= 200)
    {
      lastBlinkTime = currentMillis;
      alertOutputState = !alertOutputState;

      digitalWrite(buzzerPin, alertOutputState ? HIGH : LOW);

      if (alertOutputState)
      {
        setRGBForBuilding(currentBuilding);
      }
      else
      {
        ledOff();
      }
    }
  }
  else
  {
    digitalWrite(buzzerPin, LOW);
    ledOff();
    alertDisplayShown = false; // reset so the next alert redraws fresh
  }
}
