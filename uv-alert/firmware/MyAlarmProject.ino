#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "web_server.h"

// Wi-Fi Configuration
const char* ssid     = "NATNAT-2.4G";
const char* password = "incorrect712";

// Hardware Pins
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
const int buzzerPin = 18;
const int ledPin    = 19;

// Global Instances & State
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
WebServer server(8080); // Using Port 8080

bool alarmActive = false;
String customMessage = "SYSTEM IDLE";
unsigned long lastBlinkTime = 0;
bool alertOutputState = false;

void updateScreen(const String& line1, const String& line2) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  
  display.setTextSize(1);
  display.setCursor(0, 5);
  display.println(line1);

  display.drawLine(0, 18, 128, 18, SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(0, 28);
  display.println(line2);

  display.display();
}

void setup() {
  Serial.begin(115200);

  pinMode(buzzerPin, OUTPUT);
  pinMode(ledPin, OUTPUT);
  digitalWrite(buzzerPin, LOW);
  digitalWrite(ledPin, LOW);

  Wire.begin(21, 22);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 allocation failed");
    for (;;);
  }

  // Connecting screen
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 20);
  display.println("Connecting to:");
  display.setCursor(0, 35);
  display.println(ssid);
  display.display();

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  // Show IP & Port on display
  display.clearDisplay();
  display.setCursor(0, 10);
  display.println("Connected!");
  display.setCursor(0, 25);
  display.println("IP in VS Code:");
  display.setCursor(0, 42);
  display.printf("%s:8080", WiFi.localIP().toString().c_str());
  display.display();
  delay(2500);

  // Initialize Web Routes from web_server.h
  setupWebServer();
  updateScreen("Connected: 8080", customMessage);
}

void loop() {
  server.handleClient();
  pollFirebaseAlarm();   

  if (alarmActive) {
    unsigned long currentMillis = millis();
    if (currentMillis - lastBlinkTime >= 200) {
      lastBlinkTime = currentMillis;
      alertOutputState = !alertOutputState;

      digitalWrite(ledPin, alertOutputState ? HIGH : LOW);
      digitalWrite(buzzerPin, alertOutputState ? HIGH : LOW);

      if (alertOutputState) {
        updateScreen("!!UV-ALERT!!", customMessage);
      } else {
        display.clearDisplay();
        display.display();
      }
    }
  }
}