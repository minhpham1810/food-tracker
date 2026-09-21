// Freshness Tracker - BME688 gas sensor node on ESP32-S3 Feather.
//
// Publishes to ThingSpeak, which is the only consumer. Derived values
// (baselines, humidity compensation, spoilage estimates) are computed
// backend-side, so this firmware publishes raw sensor output plus the quality
// flags needed to decide whether a reading is trustworthy.
//
// FIELD mode is the deployed configuration: one sample and one upload per
// minute, with the radio shut down and the CPU in light sleep in between.
// ~7 mA average against 75.9 mA for a continuously-running configuration,
// so roughly 12.5 days on a 2500 mAh cell instead of 28 hours.
//
// Light sleep rather than deep sleep. At a 60 s cadence the radio is ~78% of
// the energy budget and sleep is ~10%, so deep sleep would save only about 9%
// overall. It would also cost the BSEC algorithm: deep sleep resets millis(),
// BSEC rejects a timestamp that moves backwards, and the BSEC2 wrapper's
// run() takes no external timebase. Light sleep keeps millis() monotonic, so
// BSEC's calibration, run-in and IAQ accuracy survive every cycle intact.

#include <Arduino.h>
#include <Wire.h>
#include <bsec2.h>
#include <math.h>

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>

#include "esp_sleep.h"


// ---------------------------------------------------------------- config
//
// EDIT THESE THREE LINES BEFORE FLASHING.
// They are credentials. Replace them with your own, and regenerate the
// ThingSpeak write key if this file has ever been pushed to a public repo.

const char* WIFI_SSID    = "your-ssid";
const char* WIFI_PASS    = "";             // empty string for an open network
const char* TS_WRITE_KEY = "your-thingspeak-write-key";

// ----------------------------------------------------------------

#define FW_VERSION "ftrk-7.2.0"
#define DEVICE_ID  "FTRK-01"

// Wake-to-wake period. ThingSpeak's free tier accepts one update per 15 s, so
// 60 s has margin. Sleep is shortened by however long the cycle took, keeping
// the actual cadence at this value rather than period + cycle time.
const uint32_t PERIOD_MS = 60000;

const uint32_t SAMPLE_TIMEOUT_MS       = 10000;
const uint32_t WIFI_CONNECT_TIMEOUT_MS = 10000;
const uint32_t WIFI_RETRY_TIMEOUT_MS   = 8000;

// Boot pauses here before the first sleep so a serial command can reach the
// board while someone is still watching.
const uint32_t BOOT_GRACE_MS = 10000;

// Optional battery voltage monitoring. This board has no fuel gauge, so
// nothing is measured unless an ADC pin is wired to a divider across the
// pack. Uncomment and set the pin to enable; the divider ratio is the factor
// the measured voltage is multiplied by (2.0 for a matched 1:1 divider).
// The pin must be ADC1-capable (GPIO1-GPIO10 on the ESP32-S3); ADC2 stops
// working while WiFi is active.
//
// #define BATTERY_ADC_PIN  A5
// #define BATTERY_DIVIDER  2.0f

// Power model. The duty cycle below is measured by the firmware; these
// per-state currents are datasheet and reference figures, not measurements of
// this board. Replace them with bench values to make the estimate specific.
const float BATT_MAH    = 2500.0f;
const float BATT_USABLE = 0.85f;           // derate for the voltage knee
const float I_SLEEP_MA  = 0.80f;           // light sleep, radio off
const float I_AWAKE_MA  = 25.0f;           // 80 MHz, radio off
const float I_WIFI_MA   = 110.0f;          // associate + POST + disconnect
const float I_LAB_MA    = 75.9f;           // LAB mode, radio associated


// ---------------------------------------------------------------- types
// Declared above the first function because the Arduino IDE inserts its
// generated prototypes there and they reference these types.

enum RunMode { MODE_LAB = 0, MODE_FIELD = 1 };

const RunMode DEFAULT_RUN_MODE = MODE_FIELD;

struct Sample {
    float tempC, rh, absHum, gasRaw, bvoc, iaq;
    int   iaqAccuracy, stabilization, runIn;
    bool  gasValid, heaterStable;
    uint8_t flags;
};


// ---------------------------------------------------------------- globals

Bsec2 envSensor;
Preferences prefs;

uint8_t bsecScratch[BSEC_MAX_STATE_BLOB_SIZE];
uint32_t lastBsecSaveMs = 0;
const uint32_t BSEC_SAVE_INTERVAL_MS = 3600000UL;

uint32_t bootCount = 0;
RunMode  runMode   = DEFAULT_RUN_MODE;

Sample gS;
bool   gReady     = false;
bool   haveSample = false;

float latestBattV = NAN;
float avgMa = NAN, lifeDays = NAN;

// Cached association. A full channel scan is the slowest part of connecting,
// and at this cadence radio time is most of the energy budget.
uint8_t netBssid[6];
uint8_t netChannel = 0;
bool    netCached  = false;

// Duty-cycle accounting. Light sleep keeps RAM and millis() intact, so these
// are ordinary globals rather than RTC-backed state.
uint64_t sleepMs = 0, wifiMs = 0;
uint32_t wifiOnMs = 0;
uint32_t samples = 0, uploadsOk = 0, uploadsFail = 0;
uint32_t t0Ms = 0;

int    i2cOnLevel = HIGH;
String serialLine = "";


// ---------------------------------------------------------------- power

uint32_t elapsedMs() { return millis() - t0Ms; }

// Average current implied by the measured duty cycle and the per-state
// currents above. The time terms are real measurements from this board; the
// current terms are not, so this is an estimate rather than a measurement.
// Radio time in particular is measured, so a faster association improves the
// figure without editing any constant.
float estimateAvgMa() {
    if (runMode == MODE_LAB) return I_LAB_MA;

    uint32_t total = elapsedMs();
    if (total == 0) return NAN;

    uint64_t awake = (total > sleepMs) ? (total - sleepMs) : 0;

    double q = (double)awake   * I_AWAKE_MA
             + (double)sleepMs * I_SLEEP_MA
             + (double)wifiMs  * (I_WIFI_MA - I_AWAKE_MA);

    return (float)(q / (double)total);
}

void updatePower() {
    avgMa = estimateAvgMa();

    lifeDays = (!isnan(avgMa) && avgMa > 0)
        ? BATT_MAH * BATT_USABLE / avgMa / 24.0f
        : NAN;
}

void resetPowerBaseline() {
    t0Ms = millis();
    sleepMs = wifiMs = 0;
    uploadsOk = uploadsFail = 0;
    Serial.println("# duty-cycle accounting reset");
}

void printPower() {
    updatePower();

    uint32_t total = elapsedMs();

    Serial.println("# --- power ---");
    Serial.print("# mode ");     Serial.print(runMode == MODE_FIELD ? "FIELD" : "LAB");
    Serial.print("  elapsed ");  Serial.print(total / 3600000.0, 2);
    Serial.print(" h  samples ");Serial.print(samples);
    Serial.print("  uploads ");  Serial.print(uploadsOk);
    Serial.print("/");           Serial.println(uploadsOk + uploadsFail);

    if (total > 0) {
        Serial.print("# measured duty cycle: awake ");
        Serial.print(100.0 * (double)(total - sleepMs) / (double)total, 2);
        Serial.print("%  radio ");
        Serial.print(100.0 * (double)wifiMs / (double)total, 2);
        Serial.print("%  sleep ");
        Serial.print(100.0 * (double)sleepMs / (double)total, 2);
        Serial.println("%");
    }

    if (uploadsOk + uploadsFail > 0) {
        Serial.print("# mean radio time ");
        Serial.print((double)wifiMs / 1000.0 / (double)(uploadsOk + uploadsFail), 2);
        Serial.println(" s per cycle");
    }

    if (!isnan(latestBattV)) {
        Serial.print("# battery "); Serial.print(latestBattV, 3); Serial.println(" V");
    }

    Serial.print("# estimated average ");
    if (isnan(avgMa)) Serial.println("pending");
    else { Serial.print(avgMa, 3); Serial.println(" mA"); }

    Serial.print("# estimated life from full ");
    if (isnan(lifeDays)) Serial.println("pending");
    else {
        Serial.print(lifeDays, 1);
        Serial.print(" days on ");
        Serial.print(BATT_MAH, 0);
        Serial.println(" mAh");
    }

    Serial.println("# duty cycle is measured; per-state currents are datasheet values");
    Serial.println("# -------------");
}


// ---------------------------------------------------------------- sensing

float clampf(float x, float lo, float hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}

// MOS gas sensors respond to the number of water molecules present rather
// than to relative saturation: RH 80% is ~5.2 g/m3 at 4 C but ~13.8 g/m3 at
// 20 C. Absolute humidity is therefore the humidity term the backend model
// uses, and rh_pct is published only for readability.
float absoluteHumidity(float t, float rh) {
    if (isnan(t) || rh <= 0.0f || rh > 100.0f) return NAN;
    float sat = 6.112f * exp((17.67f * t) / (t + 243.5f));
    return 216.7f * (rh / 100.0f) * sat / (273.15f + t);
}

// Quality bitmask, published as field 7.
//   b0 gas_valid, b1 heater_stable, b2 stabilized, b3 run_in,
//   b4:5 iaq_accuracy (0-3). Range 0-63; gas is usable only at 63.
uint8_t buildFlags(bool gasValid, bool heaterStable,
                   int stabilized, int runIn, int acc) {
    uint8_t f = 0;
    if (gasValid)        f |= 1 << 0;
    if (heaterStable)    f |= 1 << 1;
    if (stabilized == 1) f |= 1 << 2;
    if (runIn == 1)      f |= 1 << 3;
    acc = (int)clampf((float)acc, 0, 3);
    return f | (uint8_t)((acc & 0x03) << 4);
}


// ---------------------------------------------------------------- board power

void i2cRail(bool on) {
#ifdef PIN_I2C_POWER
    pinMode(PIN_I2C_POWER, OUTPUT);
    digitalWrite(PIN_I2C_POWER, on ? i2cOnLevel : !i2cOnLevel);
    if (on) delay(20);
#else
    (void)on;
#endif
}

void neoPower(bool on) {
#ifdef NEOPIXEL_POWER
    pinMode(NEOPIXEL_POWER, OUTPUT);
    digitalWrite(NEOPIXEL_POWER, on ? HIGH : LOW);
#else
    (void)on;
#endif
}

bool bmeResponds() {
    Wire.beginTransmission(BME68X_I2C_ADDR_HIGH);
    return Wire.endTransmission() == 0;
}

// The sense rail's active level differs between Feather revisions, so the
// correct level is found by checking whether the BME688 acknowledges rather
// than assumed from a constant.
void bringUpI2cRail() {
    i2cRail(true);
    Wire.begin();
    delay(30);

    if (bmeResponds()) return;

    i2cOnLevel = !i2cOnLevel;
    i2cRail(true);
    Wire.begin();
    delay(30);

    if (!bmeResponds())
        Serial.println("# BME688 not responding on either rail level");
}

// No fuel gauge on this board. Returns NAN unless BATTERY_ADC_PIN is set to a
// pin wired across a divider on the pack.
void readBattery() {
#ifdef BATTERY_ADC_PIN
    uint32_t acc = 0;
    for (int i = 0; i < 16; i++) acc += analogReadMilliVolts(BATTERY_ADC_PIN);
    latestBattV = (acc / 16.0f) * BATTERY_DIVIDER / 1000.0f;
#else
    latestBattV = NAN;
#endif
}


// ---------------------------------------------------------------- BSEC

void newDataCallback(const bme68xData data, const bsecOutputs outputs, Bsec2 bsec) {
    if (!outputs.nOutputs) return;

    Sample s;
    s.tempC = s.rh = s.iaq = s.bvoc = s.gasRaw = NAN;
    s.iaqAccuracy = s.stabilization = s.runIn = -1;

    for (uint8_t i = 0; i < outputs.nOutputs; i++) {
        const bsecData o = outputs.output[i];

        switch (o.sensor_id) {
        case BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_TEMPERATURE: s.tempC = o.signal; break;
        case BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_HUMIDITY:    s.rh    = o.signal; break;
        case BSEC_OUTPUT_IAQ: s.iaq = o.signal; s.iaqAccuracy = o.accuracy;       break;
        case BSEC_OUTPUT_BREATH_VOC_EQUIVALENT: s.bvoc   = o.signal;              break;
        case BSEC_OUTPUT_RAW_GAS:               s.gasRaw = o.signal;              break;
        case BSEC_OUTPUT_STABILIZATION_STATUS:  s.stabilization = (int)o.signal;  break;
        case BSEC_OUTPUT_RUN_IN_STATUS:         s.runIn         = (int)o.signal;  break;
        default: break;
        }
    }

    // BSEC does not always emit RAW_GAS; the driver-level reading is the same
    // measurement and keeps the field populated.
    if (isnan(s.gasRaw) || s.gasRaw <= 0) s.gasRaw = data.gas_resistance;

    s.gasValid     = (data.status & BME68X_GASM_VALID_MSK) != 0;
    s.heaterStable = (data.status & BME68X_HEAT_STAB_MSK) != 0;
    s.flags        = buildFlags(s.gasValid, s.heaterStable,
                                s.stabilization, s.runIn, s.iaqAccuracy);
    s.absHum       = absoluteHumidity(s.tempC, s.rh);

    gS = s;
    gReady = true;
    haveSample = true;
    samples++;
}

bool bsecBegin() {
    if (!envSensor.begin(BME68X_I2C_ADDR_HIGH, Wire)) return false;

    // Calibration carried over from the last run, so IAQ accuracy does not
    // restart from zero after a reflash or a battery swap.
    if (prefs.getBytesLength("bsec") == BSEC_MAX_STATE_BLOB_SIZE) {
        prefs.getBytes("bsec", bsecScratch, BSEC_MAX_STATE_BLOB_SIZE);
        if (envSensor.setState(bsecScratch))
            Serial.println("# BSEC state restored");
    }

    bsecSensor list[] = {
        BSEC_OUTPUT_IAQ,
        BSEC_OUTPUT_RAW_GAS,
        BSEC_OUTPUT_STABILIZATION_STATUS,
        BSEC_OUTPUT_RUN_IN_STATUS,
        BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_TEMPERATURE,
        BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_HUMIDITY,
        BSEC_OUTPUT_BREATH_VOC_EQUIVALENT
    };

    // LP rather than ULP. ULP schedules its next measurement 300 s ahead, so a
    // 60 s cycle would find nothing ready four times out of five. LP is driven
    // on demand here, one measurement per cycle. BSEC's filters therefore see
    // fewer samples than LP assumes and iaq / iaq_accuracy converge slowly;
    // temperature, humidity and raw gas resistance are direct sensor reads and
    // are unaffected, as are the two hardware quality bits.
    if (!envSensor.updateSubscription(list, sizeof(list) / sizeof(list[0]),
                                      BSEC_SAMPLE_RATE_LP))
        return false;

    envSensor.attachCallback(newDataCallback);
    return true;
}

// Rate-limited so NVS is not worn at the sample rate.
void maybeSaveBsecState() {
    if (millis() - lastBsecSaveMs < BSEC_SAVE_INTERVAL_MS) return;
    if (!envSensor.getState(bsecScratch)) return;

    prefs.putBytes("bsec", bsecScratch, BSEC_MAX_STATE_BLOB_SIZE);
    lastBsecSaveMs = millis();
}


// ---------------------------------------------------------------- wifi

void wifiStart(bool useCache) {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(true);

    const char* pass = strlen(WIFI_PASS) ? WIFI_PASS : NULL;

    if (useCache && netCached) WiFi.begin(WIFI_SSID, pass, netChannel, netBssid);
    else                       WiFi.begin(WIFI_SSID, pass);
}

bool wifiWait(uint32_t timeoutMs) {
    uint32_t t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < timeoutMs) delay(50);
    return WiFi.status() == WL_CONNECTED;
}

bool wifiConnect() {
    if (WiFi.status() == WL_CONNECTED) return true;

    wifiOnMs = millis();
    wifiStart(true);

    if (wifiWait(netCached ? WIFI_RETRY_TIMEOUT_MS : WIFI_CONNECT_TIMEOUT_MS)) {
        if (const uint8_t* b = WiFi.BSSID()) {
            memcpy(netBssid, b, 6);
            netChannel = WiFi.channel();
            netCached = true;
        }
        return true;
    }

    // The cached AP may have changed channel or gone away. One clean retry
    // with a full scan, and the stale cache is dropped either way.
    if (netCached) {
        netCached = false;
        WiFi.disconnect(true);
        delay(100);
        wifiStart(false);
        return wifiWait(WIFI_CONNECT_TIMEOUT_MS);
    }

    return false;
}

void wifiOff() {
    if (wifiOnMs) {
        wifiMs += millis() - wifiOnMs;
        wifiOnMs = 0;
    }
    WiFi.disconnect(true, true);
    WiFi.mode(WIFI_OFF);
    delay(10);
}


// ---------------------------------------------------------------- thingspeak
// Fields: 1 temp_c, 2 rh_pct, 3 abs_humidity_gm3, 4 gas_raw_ohm,
//         5 bvoc_eq_ppm, 6 iaq, 7 flags, 8 uptime_s
//
// Field 8 is seconds since boot. Light sleep leaves millis() monotonic across
// cycles, so it counts real elapsed time; a drop between consecutive entries
// means the node reset and the BSEC baseline restarted with it.
//
// Entries are stamped by ThingSpeak on arrival. With an upload every cycle,
// arrival is within seconds of measurement, so the node needs no wall clock.

// NaN is omitted rather than sent as the string "nan", which ThingSpeak
// rejects. An omitted field reads back empty, which is the correct
// representation of a missing measurement.
void addField(String &s, int i, float v, int dp) {
    if (isnan(v) || isinf(v)) return;
    s += "&field"; s += i; s += "="; s += String(v, dp);
}

bool uploadSample() {
    if (!haveSample) return false;

    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient https;
    https.setTimeout(8000);

    String url = "https://api.thingspeak.com/update?api_key=";
    url += TS_WRITE_KEY;

    addField(url, 1, gS.tempC,  2);
    addField(url, 2, gS.rh,     2);
    addField(url, 3, gS.absHum, 3);
    addField(url, 4, gS.gasRaw, 1);
    addField(url, 5, gS.bvoc,   4);
    addField(url, 6, gS.iaq,    2);

    url += "&field7="; url += String((int)gS.flags);
    url += "&field8="; url += String((unsigned long)(millis() / 1000UL));

    if (!https.begin(client, url)) return false;

    int code = https.GET();
    String r = https.getString();
    r.trim();
    https.end();

    bool ok = (code == 200 && r != "0");
    ok ? uploadsOk++ : uploadsFail++;

    Serial.print("# upload entry "); Serial.print(r);
    Serial.print(" http=");          Serial.println(code);

    return ok;
}


// ---------------------------------------------------------------- logging
// Serial output mirrors the ThingSpeak payload so the device has one data
// model rather than two that can drift apart.

void printLogHeader() {
    Serial.println("# ---");
    Serial.print("# ");     Serial.print(DEVICE_ID);
    Serial.print(" ");      Serial.print(FW_VERSION);
    Serial.print(" mode="); Serial.print(runMode == MODE_FIELD ? "FIELD" : "LAB");
    Serial.print(" boot="); Serial.println(bootCount);
    Serial.println("# flags: b0 gas_valid b1 heater_stable b2 stabilized "
                   "b3 run_in b4:5 iaq_accuracy");
    Serial.println("# gas is usable only where flags == 63");
    Serial.println("# avg_ma is estimated from the measured duty cycle");
    Serial.println("# batt_v is blank unless BATTERY_ADC_PIN is configured");
    Serial.println("# ---");
    Serial.println("sample,uptime_s,temp_c,rh_pct,abs_humidity_gm3,gas_raw_ohm,"
                   "bvoc_eq_ppm,iaq,flags,avg_ma,batt_v");
}

void printLogRow() {
    Serial.print(samples);          Serial.print(",");
    Serial.print(millis() / 1000UL);Serial.print(",");
    Serial.print(gS.tempC, 3);      Serial.print(",");
    Serial.print(gS.rh, 3);         Serial.print(",");
    Serial.print(gS.absHum, 4);     Serial.print(",");
    Serial.print(gS.gasRaw, 1);     Serial.print(",");
    Serial.print(gS.bvoc, 4);       Serial.print(",");
    Serial.print(gS.iaq, 2);        Serial.print(",");
    Serial.print((int)gS.flags);    Serial.print(",");
    Serial.print(avgMa, 3);         Serial.print(",");
    Serial.println(latestBattV, 3);
}


// ---------------------------------------------------------------- sleep

// Light sleep holds RAM, peripheral state and the millis() timebase, which is
// what lets BSEC keep running across cycles. The CPU and radio are gated off,
// which is where the saving comes from.
void lightSleep(uint32_t ms) {
    if (ms < 50) return;

    Serial.print("# sleeping ");
    Serial.print(ms / 1000.0, 1);
    Serial.println(" s");
    Serial.flush();

    esp_sleep_enable_timer_wakeup((uint64_t)ms * 1000ULL);
    esp_light_sleep_start();

    sleepMs += ms;
}


// ---------------------------------------------------------------- commands

void setRunMode(RunMode m) {
    runMode = m;
    prefs.putUChar("mode", (uint8_t)m);
    Serial.print("# mode ");
    Serial.println(m == MODE_FIELD ? "FIELD" : "LAB");
}

void printStatus() {
    Serial.println("# --- status ---");
    Serial.print("# ");           Serial.print(DEVICE_ID);
    Serial.print(" ");            Serial.print(FW_VERSION);
    Serial.print(" mode=");       Serial.print(runMode == MODE_FIELD ? "FIELD" : "LAB");
    Serial.print(" boot=");       Serial.println(bootCount);
    Serial.print("# period=");    Serial.print(PERIOD_MS / 1000);
    Serial.print(" s  samples="); Serial.print(samples);
    Serial.print("  uploads=");   Serial.print(uploadsOk);
    Serial.print("/");            Serial.println(uploadsOk + uploadsFail);
    Serial.print("# ap cached="); Serial.print(netCached ? "yes ch" : "no");
    if (netCached) Serial.print(netChannel);
    Serial.println();
    Serial.print("# last flags=");
    Serial.print(haveSample ? (int)gS.flags : -1);
    Serial.println(haveSample && gS.flags == 63 ? " (gas usable)" : " (gas not usable)");
    Serial.println("# commands: S status, P power, B reset duty-cycle accounting,");
    Serial.println("#           M LAB, M FIELD");
    Serial.println("# ---------------");
}

void processCommand(String line) {
    line.trim();
    if (!line.length()) return;

    char cmd = toupper(line.charAt(0));
    String arg = line.substring(1);
    arg.trim();
    arg.toUpperCase();

    switch (cmd) {
    case 'S': printStatus(); break;
    case 'P': readBattery(); printPower(); break;
    case 'B': resetPowerBaseline(); break;

    case 'M':
        if      (arg == "LAB")   setRunMode(MODE_LAB);
        else if (arg == "FIELD") setRunMode(MODE_FIELD);
        else {
            Serial.print("# mode ");
            Serial.println(runMode == MODE_FIELD ? "FIELD" : "LAB");
        }
        break;

    default: Serial.println("# unknown command, S for status");
    }
}

void handleSerial() {
    while (Serial.available()) {
        char c = Serial.read();

        if (c == '\n' || c == '\r') {
            if (serialLine.length()) { processCommand(serialLine); serialLine = ""; }
            continue;
        }

        if (serialLine.length() < 40) serialLine += c;
    }
}


// ---------------------------------------------------------------- cycle

// Drives BSEC until it emits, or gives up. BSEC decides internally when the
// sensor is ready, so this polls rather than assuming a fixed delay.
bool waitForSample(uint32_t timeoutMs) {
    gReady = false;
    uint32_t t = millis();

    while (!gReady && millis() - t < timeoutMs) {
        envSensor.run();
        handleSerial();
        delay(10);
    }

    return gReady;
}

void fieldCycle() {
    uint32_t cycleStart = millis();

    readBattery();
    updatePower();

    if (waitForSample(SAMPLE_TIMEOUT_MS)) {
        printLogRow();

        if (wifiConnect()) uploadSample();
        else {
            uploadsFail++;
            Serial.println("# wifi unavailable, sample dropped");
        }

        wifiOff();
    } else {
        Serial.println("# no BSEC sample this cycle");
    }

    maybeSaveBsecState();
    updatePower();

    uint32_t used = millis() - cycleStart;
    lightSleep(used < PERIOD_MS ? PERIOD_MS - used : 0);
}


// ---------------------------------------------------------------- setup

void setup() {
    // 80 MHz roughly halves CPU current; the radio raises the clock itself
    // when it needs to.
    setCpuFrequencyMhz(80);

    Serial.begin(115200);

#if ARDUINO_USB_CDC_ON_BOOT
    // Without this, writes block waiting for a USB host that is not present
    // once the board is running on battery.
    Serial.setTxTimeoutMs(0);
#endif

    delay(1500);

#ifdef BATTERY_ADC_PIN
    analogReadResolution(12);
#endif

    prefs.begin("ftrk", false);
    bootCount = prefs.getUInt("boots", 0) + 1;
    prefs.putUInt("boots", bootCount);
    runMode = (RunMode)prefs.getUChar("mode", (uint8_t)DEFAULT_RUN_MODE);

    // Holding BOOT through a reset forces LAB, which is the way back if FIELD
    // mode ever makes the console hard to reach.
    pinMode(0, INPUT_PULLUP);
    delay(5);
    if (digitalRead(0) == LOW) runMode = MODE_LAB;

    neoPower(false);
    bringUpI2cRail();
    readBattery();

    if (!bsecBegin()) Serial.println("# BSEC init failed");

    printLogHeader();
    printStatus();

    t0Ms = millis();
    lastBsecSaveMs = millis();

    if (runMode == MODE_FIELD) {
        Serial.print("# grace window ");
        Serial.print(BOOT_GRACE_MS / 1000);
        Serial.println(" s before the first sleep");

        uint32_t t = millis();
        while (millis() - t < BOOT_GRACE_MS) {
            envSensor.run();          // let BSEC settle while we wait
            handleSerial();
            delay(20);
        }
    } else {
        wifiStart(false);
    }
}


// ---------------------------------------------------------------- loop

void loop() {
    handleSerial();

    if (runMode == MODE_FIELD) { fieldCycle(); return; }

    // LAB: continuous sampling on USB power, radio stays associated.
    envSensor.run();

    if (gReady) {
        gReady = false;
        printLogRow();
    }

    static uint32_t lastUpload = 0;

    if (haveSample && millis() - lastUpload >= PERIOD_MS) {
        lastUpload = millis();

        if (WiFi.status() != WL_CONNECTED) wifiStart(false);

        readBattery();
        updatePower();

        if (WiFi.status() == WL_CONNECTED) uploadSample();
        maybeSaveBsecState();
    }
}