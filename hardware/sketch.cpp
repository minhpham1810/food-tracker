// Freshness Tracker - BME688 gas sensor node on ESP32-S3 Feather.
//
// Publishes to ThingSpeak, which is the only consumer. All derived values
// (baselines, spoilage estimates) are computed backend-side, so this firmware
// publishes raw sensor output plus the quality flags needed to decide whether
// a reading is trustworthy.
//
// FIELD mode is the deployed configuration: BSEC ULP (300 s) with deep sleep
// between samples, 12 samples buffered in RTC memory, one bulk upload per
// hour. LAB mode is a USB debugging configuration: BSEC LP (3 s), no sleep,
// upload every 60 s.
//
// Measured duty cycle is ~99.3% asleep, giving ~0.50 mA average against
// 75.9 mA for a continuously-running configuration.

#include <Arduino.h>
#include <Wire.h>
#include <bsec2.h>
#include <math.h>
#include <time.h>

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>

#include "esp_sleep.h"
#include "esp_timer.h"
#include "driver/gpio.h"


// ---------------------------------------------------------------- config

#define FW_VERSION "ftrk-5.0.0"
#define DEVICE_ID  "FTRK-01"

const char* WIFI_SSID = "bucknell_iot";
const char* WIFI_PASS = "";                 // empty for an open network

const char* TS_WRITE_KEY  = "CNIVGYI2N97J0FCS";
const char* TS_CHANNEL_ID = "3499736";

// BSEC ULP runs at a fixed 300 s. The sleep interval matches it so the
// wake-up and the next scheduled measurement coincide.
const uint32_t SAMPLE_PERIOD_S = 300;

// 12 x 300 s = one upload per hour. Larger batches save power but widen the
// window of rows lost to a brownout.
#define BUFFER_N 12

const unsigned long LAB_UPLOAD_INTERVAL_MS = 60000;

// Cold boot pauses here before the first sleep so a serial command can still
// reach the board. Skipped on timer wakes.
const uint32_t BOOT_GRACE_MS = 15000;

const uint32_t SAMPLE_TIMEOUT_MS       = 15000;
const uint32_t WIFI_CONNECT_TIMEOUT_MS = 12000;

// BSEC occasionally refuses to produce output after a state restore. Three
// consecutive empty wakes discards the stored state and recalibrates.
const uint8_t MAX_SAMPLE_FAILURES = 3;

// Power model constants. Bench measurement replaces these; the firmware's
// measured estimate (fuel-gauge based) does not depend on them.
const float BATT_MAH    = 2500.0f;
const float BATT_USABLE = 0.85f;            // derate for the voltage knee
const float I_SLEEP_MA  = 0.15f;            // deep sleep, I2C rail down
const float I_AWAKE_MA  = 25.0f;            // 80 MHz, radio off
const float I_WIFI_MA   = 110.0f;           // associate + POST + disconnect
const float I_LAB_MA    = 75.9f;            // LAB mode, radio associated

// BSEC2 exposes run(int64_t currTimeNs). Deep sleep depends on it: millis()
// restarts at zero every wake and BSEC rejects a timestamp that moves
// backwards. Setting this to 0 compiles against older wrappers at the cost of
// BSEC's calibration tracking in FIELD mode.
#define BSEC2_HAS_TIMESTAMP_RUN 1


// ---------------------------------------------------------------- types
// Declared above the first function because the Arduino IDE inserts its
// generated prototypes there and they reference these types.

enum RunMode { MODE_LAB = 0, MODE_FIELD = 1 };

const RunMode DEFAULT_RUN_MODE = MODE_FIELD;

// Buffered sample. Packed because RTC slow memory is 8 KB and the BSEC state
// blob already occupies part of it.
struct __attribute__((packed)) SampleRec {
    uint32_t epoch;
    float    tempC, rh, absHum, gasRaw, bvoc, iaq, battV;
    uint8_t  flags;
    uint8_t  pad[3];
};

struct Sample {
    float tempC, rh, absHum, gasRaw, bvoc, iaq;
    int   iaqAccuracy, stabilization, runIn;
    bool  gasValid, heaterStable;
    uint8_t flags;
};


// ---------------------------------------------------------------- RTC state
// Retained through deep sleep, cleared by a reset or power cycle.

RTC_DATA_ATTR uint8_t   rtcBsecState[BSEC_MAX_STATE_BLOB_SIZE];
RTC_DATA_ATTR bool      rtcBsecValid   = false;
RTC_DATA_ATTR uint64_t  rtcBsecBaseUs  = 0;   // BSEC timebase across sleeps
RTC_DATA_ATTR uint32_t  rtcEpochBase   = 0;   // epoch when esp_timer was 0
RTC_DATA_ATTR bool      rtcHaveClock   = false;
RTC_DATA_ATTR uint32_t  rtcSampleIdx   = 0;
RTC_DATA_ATTR uint16_t  rtcBufCount    = 0;
RTC_DATA_ATTR SampleRec rtcBuf[BUFFER_N];
RTC_DATA_ATTR uint32_t  rtcDropped     = 0;
RTC_DATA_ATTR uint8_t   rtcFailures    = 0;
RTC_DATA_ATTR int8_t    rtcI2cLevel    = -1;  // -1 until polarity is probed

// Duty-cycle accumulators behind the modeled power estimate.
RTC_DATA_ATTR uint64_t rtcAwakeUs = 0;
RTC_DATA_ATTR uint64_t rtcSleepUs = 0;
RTC_DATA_ATTR uint64_t rtcWifiUs  = 0;


// ---------------------------------------------------------------- globals

Bsec2 envSensor;
Preferences prefs;

uint8_t bsecScratch[BSEC_MAX_STATE_BLOB_SIZE];

uint32_t bootCount = 0;
RunMode  runMode   = DEFAULT_RUN_MODE;
bool     verbose   = true;

Sample gS;
bool   gReady = false;
bool   haveSample = false;

float latestBattV = NAN, latestBattSoc = NAN;
float estAvgMa = NAN, measAvgMa = NAN, estDaysLeft = NAN;

unsigned long lastUpload = 0, lastWiFiTry = 0;
uint64_t wifiOnUs = 0;
int i2cOnLevel = HIGH;
String serialLine = "";


// ---------------------------------------------------------------- time

int64_t bsecNowNs() {
    return (int64_t)(rtcBsecBaseUs + (uint64_t)esp_timer_get_time()) * 1000LL;
}

bool bsecRun() {
#if BSEC2_HAS_TIMESTAMP_RUN
    return envSensor.run(bsecNowNs());
#else
    return envSensor.run();
#endif
}

uint32_t nowEpoch() {
    if (!rtcHaveClock) return 0;
    return rtcEpochBase + (uint32_t)(esp_timer_get_time() / 1000000LL);
}

void isoTime(uint32_t epoch, char* out, size_t n) {
    time_t t = (time_t)epoch;
    struct tm tmv;
    gmtime_r(&t, &tmv);
    strftime(out, n, "%Y-%m-%dT%H:%M:%SZ", &tmv);
}


// ---------------------------------------------------------------- power

// Average current implied by the accumulated awake / sleep / radio time.
// Available from the first wake.
float modeledAvgMa() {
    if (runMode == MODE_LAB) return I_LAB_MA;

    uint64_t awake = rtcAwakeUs + (uint64_t)esp_timer_get_time();
    uint64_t total = awake + rtcSleepUs;
    if (total == 0) return NAN;

    double q = (double)awake    * I_AWAKE_MA
             + (double)rtcSleepUs * I_SLEEP_MA
             + (double)rtcWifiUs  * (I_WIFI_MA - I_AWAKE_MA);

    return (float)(q / (double)total);
}

// Average current from the fuel gauge's state-of-charge drop over elapsed
// wall-clock time. Independent of the constants above, so it is the figure
// worth quoting once enough time has passed.
float measuredAvgMa() {
    float    soc0 = prefs.getFloat("soc0", NAN);
    uint32_t t0   = prefs.getUInt("t0", 0);
    uint32_t tNow = nowEpoch();

    if (isnan(soc0) || isnan(latestBattSoc) || t0 == 0 || tNow <= t0) return NAN;

    float hours = (tNow - t0) / 3600.0f;
    if (hours < 0.5f) return NAN;

    float usedMah = (soc0 - latestBattSoc) / 100.0f * BATT_MAH;
    if (usedMah <= 0) return NAN;

    return usedMah / hours;
}

void updatePower() {
    estAvgMa  = modeledAvgMa();
    measAvgMa = measuredAvgMa();

    float basis = !isnan(measAvgMa) ? measAvgMa : estAvgMa;
    if (isnan(basis) || basis <= 0) { estDaysLeft = NAN; return; }

    float remainMah = isnan(latestBattSoc)
        ? BATT_MAH * BATT_USABLE
        : BATT_MAH * (latestBattSoc / 100.0f - (1.0f - BATT_USABLE));

    estDaysLeft = (remainMah > 0 ? remainMah : 0) / basis / 24.0f;
}

void startBatteryTest() {
    prefs.putFloat("soc0", latestBattSoc);
    prefs.putUInt("t0", nowEpoch());
    rtcAwakeUs = rtcSleepUs = rtcWifiUs = 0;

    Serial.print("# battery test anchor: SoC ");
    Serial.print(latestBattSoc, 1);
    Serial.println("%");
}

void printPower() {
    updatePower();

    uint64_t awake = rtcAwakeUs + (uint64_t)esp_timer_get_time();
    uint64_t total = awake + rtcSleepUs;

    Serial.println("# --- power ---");
    Serial.print("# mode ");    Serial.println(runMode == MODE_FIELD ? "FIELD" : "LAB");
    Serial.print("# battery "); Serial.print(latestBattV, 3);
    Serial.print(" V  ");       Serial.print(latestBattSoc, 1);
    Serial.println(" %");

    if (total > 0) {
        Serial.print("# awake ");
        Serial.print((double)awake / (double)total * 100.0, 3);
        Serial.print("%  radio ");
        Serial.print((double)rtcWifiUs / (double)total * 100.0, 3);
        Serial.print("%  elapsed ");
        Serial.print((double)total / 3600e6, 2);
        Serial.println(" h");
    }

    Serial.print("# modeled  "); Serial.print(estAvgMa, 3); Serial.println(" mA");

    Serial.print("# measured ");
    if (isnan(measAvgMa)) Serial.println("pending");
    else { Serial.print(measAvgMa, 3); Serial.println(" mA"); }

    float basis = !isnan(measAvgMa) ? measAvgMa : estAvgMa;

    Serial.print("# life from full ");
    if (!isnan(basis) && basis > 0) {
        Serial.print(BATT_MAH * BATT_USABLE / basis / 24.0f, 1);
        Serial.println(" days");
    } else Serial.println("pending");

    Serial.print("# remaining ");
    if (isnan(estDaysLeft)) Serial.println("pending");
    else { Serial.print(estDaysLeft, 1); Serial.println(" days"); }

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
    gpio_hold_dis((gpio_num_t)PIN_I2C_POWER);
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
// correct level is found by checking whether the BME688 acknowledges and
// cached in RTC memory for subsequent wakes.
void bringUpI2cRail() {
    if (rtcI2cLevel >= 0) i2cOnLevel = rtcI2cLevel;

    i2cRail(true);
    Wire.begin();
    delay(30);

    if (bmeResponds()) { rtcI2cLevel = i2cOnLevel; return; }

    i2cOnLevel = !i2cOnLevel;
    i2cRail(true);
    Wire.begin();
    delay(30);

    if (bmeResponds()) rtcI2cLevel = i2cOnLevel;
    else if (verbose)  Serial.println("# BME688 not responding on either rail level");
}

// MAX17048 fuel gauge, read over raw I2C to avoid pulling in a library.
void readBattery() {
    const uint8_t ADDR = 0x36;
    latestBattV = latestBattSoc = NAN;

    Wire.beginTransmission(ADDR);
    Wire.write(0x02);
    if (Wire.endTransmission(false) != 0) return;
    if (Wire.requestFrom((int)ADDR, 2) != 2) return;
    latestBattV = (((uint16_t)Wire.read() << 8) | Wire.read()) * 0.000078125f;

    Wire.beginTransmission(ADDR);
    Wire.write(0x04);
    if (Wire.endTransmission(false) != 0) return;
    if (Wire.requestFrom((int)ADDR, 2) != 2) return;
    latestBattSoc = (((uint16_t)Wire.read() << 8) | Wire.read()) / 256.0f;
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

    // BSEC does not always emit RAW_GAS; the driver-level reading is the
    // same measurement and keeps the column populated.
    if (isnan(s.gasRaw) || s.gasRaw <= 0) s.gasRaw = data.gas_resistance;

    s.gasValid     = (data.status & BME68X_GASM_VALID_MSK) != 0;
    s.heaterStable = (data.status & BME68X_HEAT_STAB_MSK) != 0;
    s.flags        = buildFlags(s.gasValid, s.heaterStable,
                                s.stabilization, s.runIn, s.iaqAccuracy);
    s.absHum       = absoluteHumidity(s.tempC, s.rh);

    gS = s;
    gReady = true;
    haveSample = true;
    rtcSampleIdx++;
}

bool bsecBegin(bool ulp) {
    if (!envSensor.begin(BME68X_I2C_ADDR_HIGH, Wire)) return false;

    if (ulp && rtcBsecValid) {
        envSensor.setState(rtcBsecState);
    } else {
        // NVS copy survives the reset and power cycles that clear RTC memory.
        prefs.getBytes("bsec", bsecScratch, BSEC_MAX_STATE_BLOB_SIZE);
        if (prefs.getBytesLength("bsec") == BSEC_MAX_STATE_BLOB_SIZE)
            envSensor.setState(bsecScratch);
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

    if (!envSensor.updateSubscription(list, sizeof(list) / sizeof(list[0]),
                                      ulp ? BSEC_SAMPLE_RATE_ULP
                                          : BSEC_SAMPLE_RATE_LP))
        return false;

    envSensor.attachCallback(newDataCallback);
    return true;
}

void saveBsecState() {
    if (!envSensor.getState(bsecScratch)) return;

    memcpy(rtcBsecState, bsecScratch, BSEC_MAX_STATE_BLOB_SIZE);
    rtcBsecValid = true;

    // Flash writes are rate-limited to the upload cadence to avoid wearing
    // NVS at the sample rate.
    if (rtcSampleIdx % BUFFER_N == 0)
        prefs.putBytes("bsec", bsecScratch, BSEC_MAX_STATE_BLOB_SIZE);
}


// ---------------------------------------------------------------- wifi

void wifiBegin() {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(true);
    if (strlen(WIFI_PASS) == 0) WiFi.begin(WIFI_SSID);
    else                        WiFi.begin(WIFI_SSID, WIFI_PASS);
}

bool wifiConnect(uint32_t timeoutMs) {
    if (WiFi.status() == WL_CONNECTED) return true;

    wifiOnUs = esp_timer_get_time();
    wifiBegin();

    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) delay(100);

    return WiFi.status() == WL_CONNECTED;
}

void wifiOff() {
    if (wifiOnUs) {
        rtcWifiUs += (uint64_t)esp_timer_get_time() - wifiOnUs;
        wifiOnUs = 0;
    }
    WiFi.disconnect(true, true);
    WiFi.mode(WIFI_OFF);
}

// The deep-sleep timer runs from a 150 kHz RC oscillator that drifts by
// several percent and shifts with temperature, so wall-clock time is
// re-anchored on every upload rather than free-running between them.
bool syncNtp(uint32_t timeoutMs) {
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");

    uint32_t t0 = millis();
    time_t now = 0;

    while (millis() - t0 < timeoutMs) {
        now = time(nullptr);
        if (now > 1700000000) break;
        delay(100);
    }

    if (now <= 1700000000) return false;

    int32_t predicted = (int32_t)nowEpoch();

    rtcEpochBase = (uint32_t)now - (uint32_t)(esp_timer_get_time() / 1000000LL);
    rtcHaveClock = true;

    if (verbose && predicted > 0) {
        Serial.print("# NTP drift ");
        Serial.print((int32_t)now - predicted);
        Serial.println(" s");
    }

    if (prefs.getUInt("t0", 0) == 0) startBatteryTest();
    return true;
}


// ---------------------------------------------------------------- thingspeak
// Fields: 1 temp_c, 2 rh_pct, 3 abs_humidity_gm3, 4 gas_raw_ohm,
//         5 bvoc_eq_ppm, 6 iaq, 7 flags, 8 batt_v

// NaN is omitted rather than sent as the string "nan", which ThingSpeak
// rejects. An omitted field reads back empty, which is the correct
// representation of a missing measurement.
void addField(String &s, int i, float v, int dp) {
    if (isnan(v) || isinf(v)) return;
    s += "&field"; s += i; s += "="; s += String(v, dp);
}

void addJson(String &j, int i, float v, int dp) {
    if (isnan(v) || isinf(v)) return;
    j += ",\"field"; j += i; j += "\":"; j += String(v, dp);
}

bool uploadSingle(const Sample &s) {
    if (WiFi.status() != WL_CONNECTED) return false;

    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient https;
    https.setTimeout(8000);

    String url = "https://api.thingspeak.com/update?api_key=";
    url += TS_WRITE_KEY;

    addField(url, 1, s.tempC,  2);
    addField(url, 2, s.rh,     2);
    addField(url, 3, s.absHum, 3);
    addField(url, 4, s.gasRaw, 1);
    addField(url, 5, s.bvoc,   4);
    addField(url, 6, s.iaq,    2);

    url += "&field7="; url += String((int)s.flags);
    addField(url, 8, latestBattV, 3);

    if (!https.begin(client, url)) return false;

    int code = https.GET();
    String r = https.getString();
    r.trim();
    https.end();

    if (verbose) {
        Serial.print("# update entry "); Serial.print(r);
        Serial.print(" http=");          Serial.println(code);
    }

    return code == 200 && r != "0";
}

// Bulk write: free accounts accept up to 960 rows per request at a minimum
// of 15 s between requests, so an hourly 12-row post has ample headroom.
String buildBulkJson() {
    String j;
    j.reserve(256 + (size_t)rtcBufCount * 160);

    j += "{\"write_api_key\":\"";
    j += TS_WRITE_KEY;
    j += "\",\"updates\":[";

    char iso[32];
    bool first = true;

    for (uint16_t i = 0; i < rtcBufCount; i++) {
        const SampleRec &r = rtcBuf[i];
        if (r.epoch == 0) continue;

        if (!first) j += ",";
        first = false;

        isoTime(r.epoch, iso, sizeof(iso));
        j += "{\"created_at\":\""; j += iso; j += "\"";

        addJson(j, 1, r.tempC,  2);
        addJson(j, 2, r.rh,     2);
        addJson(j, 3, r.absHum, 3);
        addJson(j, 4, r.gasRaw, 1);
        addJson(j, 5, r.bvoc,   4);
        addJson(j, 6, r.iaq,    2);

        j += ",\"field7\":"; j += String((int)r.flags);
        addJson(j, 8, r.battV, 3);
        j += "}";
    }

    j += "]}";
    return j;
}

void uploadBuffered() {
    if (rtcBufCount == 0) return;

    if (!wifiConnect(WIFI_CONNECT_TIMEOUT_MS)) {
        if (verbose) Serial.println("# wifi unavailable, rows retained");
        wifiOff();
        return;
    }

    syncNtp(5000);

    // Rows taken before the first successful sync carry epoch 0. Their
    // timestamps are reconstructed backwards from the known sample period.
    if (rtcHaveClock) {
        uint32_t now = nowEpoch();
        for (int i = (int)rtcBufCount - 1; i >= 0; i--) {
            if (rtcBuf[i].epoch) continue;
            rtcBuf[i].epoch = now - (rtcBufCount - 1 - i) * SAMPLE_PERIOD_S;
        }
    } else {
        // Without a clock the bulk endpoint has nothing to order rows by, so
        // the newest sample goes up as a single server-timestamped update and
        // the rest stay buffered for the next attempt.
        if (haveSample) uploadSingle(gS);
        wifiOff();
        return;
    }

    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient https;
    https.setTimeout(20000);

    String url = "https://api.thingspeak.com/channels/";
    url += TS_CHANNEL_ID;
    url += "/bulk_update.json";

    bool ok = false;

    if (https.begin(client, url)) {
        https.addHeader("Content-Type", "application/json");

        int code = https.POST(buildBulkJson());
        String resp = https.getString();
        resp.trim();
        https.end();

        if (verbose) {
            Serial.print("# bulk rows="); Serial.print(rtcBufCount);
            Serial.print(" http=");       Serial.print(code);
            Serial.print(" ");            Serial.println(resp);
        }

        ok = code >= 200 && code < 300;
    }

    if (ok) rtcBufCount = 0;
    else if (verbose) Serial.println("# bulk failed, rows retained");

    wifiOff();
}


// ---------------------------------------------------------------- logging
// Serial output mirrors the ThingSpeak payload so the device has one data
// model rather than two that can drift apart.

void printLogHeader() {
    Serial.println("# ---");
    Serial.print("# ");        Serial.print(DEVICE_ID);
    Serial.print(" ");         Serial.print(FW_VERSION);
    Serial.print(" mode=");    Serial.print(runMode == MODE_FIELD ? "FIELD" : "LAB");
    Serial.print(" boot=");    Serial.println(bootCount);
    Serial.println("# flags: b0 gas_valid b1 heater_stable b2 stabilized "
                   "b3 run_in b4:5 iaq_accuracy");
    Serial.println("# gas is usable only where flags == 63");
    Serial.println("# epoch_utc 0 means no NTP sync yet");
    Serial.println("# ---");
    Serial.println("epoch_utc,temp_c,rh_pct,abs_humidity_gm3,gas_raw_ohm,"
                   "bvoc_eq_ppm,iaq,flags,batt_v,batt_soc");
}

void printLogRow() {
    Serial.print(nowEpoch());       Serial.print(",");
    Serial.print(gS.tempC, 3);      Serial.print(",");
    Serial.print(gS.rh, 3);         Serial.print(",");
    Serial.print(gS.absHum, 4);     Serial.print(",");
    Serial.print(gS.gasRaw, 1);     Serial.print(",");
    Serial.print(gS.bvoc, 4);       Serial.print(",");
    Serial.print(gS.iaq, 2);        Serial.print(",");
    Serial.print((int)gS.flags);    Serial.print(",");
    Serial.print(latestBattV, 3);   Serial.print(",");
    Serial.println(latestBattSoc, 1);
}


// ---------------------------------------------------------------- sleep

void enterDeepSleep(uint64_t sleepUs) {
    saveBsecState();

    uint64_t awakeUs = (uint64_t)esp_timer_get_time();

    rtcAwakeUs    += awakeUs;
    rtcSleepUs    += sleepUs;
    rtcBsecBaseUs += awakeUs + sleepUs;

    if (rtcHaveClock)
        rtcEpochBase += (uint32_t)((awakeUs + sleepUs) / 1000000ULL);

    wifiOff();
    neoPower(false);

    if (verbose) {
        Serial.print("# sleeping ");
        Serial.print((unsigned long)(sleepUs / 1000000ULL));
        Serial.println(" s");
    }
    Serial.flush();

    // Holding the sense rail active through deep sleep leaks roughly 330 uA
    // through the regulator's enable pulldown, so the rail is dropped and
    // latched to stop it floating back up while the CPU is off.
    i2cRail(false);

#ifdef PIN_I2C_POWER
    gpio_hold_en((gpio_num_t)PIN_I2C_POWER);
#endif
    gpio_deep_sleep_hold_en();

    esp_sleep_enable_timer_wakeup(sleepUs);
    esp_deep_sleep_start();
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
    Serial.print("# ");         Serial.print(DEVICE_ID);
    Serial.print(" ");          Serial.print(FW_VERSION);
    Serial.print(" mode=");     Serial.print(runMode == MODE_FIELD ? "FIELD" : "LAB");
    Serial.print(" boot=");     Serial.println(bootCount);
    Serial.print("# samples="); Serial.print(rtcSampleIdx);
    Serial.print(" buffered="); Serial.print(rtcBufCount);
    Serial.print("/");          Serial.print(BUFFER_N);
    Serial.print(" dropped=");  Serial.println(rtcDropped);
    Serial.print("# epoch=");   Serial.print(nowEpoch());
    Serial.print(" clock=");    Serial.println(rtcHaveClock ? "ntp" : "none");
    Serial.print("# last flags=");
    Serial.print(haveSample ? (int)gS.flags : -1);
    Serial.println(haveSample && gS.flags == 63 ? " (gas usable)" : " (gas not usable)");
    Serial.println("# commands: S status, P power, B reset battery anchor,");
    Serial.println("#           M LAB, M FIELD, U upload now, Z sleep now");
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
    case 'B': readBattery(); startBatteryTest(); break;
    case 'U': uploadBuffered(); break;
    case 'Z': enterDeepSleep((uint64_t)SAMPLE_PERIOD_S * 1000000ULL); break;

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


// ---------------------------------------------------------------- field cycle

void bufferSample() {
    if (rtcBufCount >= BUFFER_N) {
        // Discarding the oldest row keeps the most recent hour intact when an
        // upload has been failing.
        for (uint16_t i = 1; i < BUFFER_N; i++) rtcBuf[i - 1] = rtcBuf[i];
        rtcBufCount = BUFFER_N - 1;
        rtcDropped++;
    }

    SampleRec &r = rtcBuf[rtcBufCount++];
    r.epoch  = nowEpoch();
    r.tempC  = gS.tempC;
    r.rh     = gS.rh;
    r.absHum = gS.absHum;
    r.gasRaw = gS.gasRaw;
    r.bvoc   = gS.bvoc;
    r.iaq    = gS.iaq;
    r.battV  = latestBattV;
    r.flags  = gS.flags;
}

void fieldCycle(bool coldBoot) {
    bringUpI2cRail();
    readBattery();
    updatePower();

    if (!bsecBegin(true)) {
        if (verbose) Serial.println("# BSEC init failed, retrying next cycle");
        rtcFailures++;
        if (rtcFailures >= MAX_SAMPLE_FAILURES) rtcBsecValid = false;
        enterDeepSleep((uint64_t)SAMPLE_PERIOD_S * 1000000ULL);
        return;
    }

    gReady = false;
    uint32_t t0 = millis();

    while (!gReady && millis() - t0 < SAMPLE_TIMEOUT_MS) {
        bsecRun();
        delay(10);
    }

    if (gReady) {
        rtcFailures = 0;
        printLogRow();
        bufferSample();
    } else {
        rtcFailures++;

        // A restored state that BSEC will not accept leaves the node silent
        // forever, so it is discarded after repeated empty wakes.
        if (rtcFailures >= MAX_SAMPLE_FAILURES) {
            rtcBsecValid = false;
            rtcFailures = 0;
            if (verbose) Serial.println("# discarding BSEC state after repeated timeouts");
        }
    }

    saveBsecState();

    // A cold boot uploads immediately so the full path is exercised while
    // someone is still watching the console.
    if (rtcBufCount >= BUFFER_N || coldBoot) uploadBuffered();

    enterDeepSleep((uint64_t)SAMPLE_PERIOD_S * 1000000ULL);
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

    bool fromSleep = esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER;
    verbose = !fromSleep;

    if (!fromSleep) delay(1500);

    prefs.begin("ftrk", false);
    bootCount = prefs.getUInt("boots", 0) + 1;
    prefs.putUInt("boots", bootCount);
    runMode = (RunMode)prefs.getUChar("mode", (uint8_t)DEFAULT_RUN_MODE);

    // Holding BOOT through a reset forces LAB, which is the way back from a
    // sleeping board when the serial console is not already open.
    pinMode(0, INPUT_PULLUP);
    delay(5);
    if (digitalRead(0) == LOW && !fromSleep) runMode = MODE_LAB;

    if (!fromSleep) {
        // RTC memory is cleared by a reset, so the timebase and buffer
        // restart rather than continuing from stale values.
        rtcBsecValid = false;
        rtcBsecBaseUs = 0;
        rtcBufCount = 0;
        rtcHaveClock = false;
        rtcEpochBase = 0;
        rtcFailures = 0;
    }

    neoPower(false);

    if (runMode == MODE_FIELD) {
        if (!fromSleep) {
            bringUpI2cRail();
            readBattery();
            updatePower();

            printLogHeader();
            printStatus();
            printPower();

            Serial.print("# grace window ");
            Serial.print(BOOT_GRACE_MS / 1000);
            Serial.println(" s before first sleep");

            uint32_t t0 = millis();
            while (millis() - t0 < BOOT_GRACE_MS) {
                handleSerial();
                if (runMode == MODE_LAB) break;
                delay(20);
            }
        }

        if (runMode == MODE_FIELD) { fieldCycle(!fromSleep); return; }
    }

    // LAB: continuous sampling on USB power.
    bringUpI2cRail();
    readBattery();

    if (!bsecBegin(false)) Serial.println("# BSEC init failed");

    printLogHeader();
    printStatus();

    wifiBegin();
    lastWiFiTry = millis();
    lastUpload  = millis();
}


// ---------------------------------------------------------------- loop
// LAB only; FIELD ends each wake inside deep sleep and never reaches here.

void loop() {
    bsecRun();

    if (gReady) {
        gReady = false;
        printLogRow();
    }

    handleSerial();

    if (runMode == MODE_FIELD)
        enterDeepSleep((uint64_t)SAMPLE_PERIOD_S * 1000000ULL);

    if (WiFi.status() != WL_CONNECTED && millis() - lastWiFiTry >= 30000) {
        lastWiFiTry = millis();
        WiFi.disconnect();
        wifiBegin();
    }

    if (haveSample && millis() - lastUpload >= LAB_UPLOAD_INTERVAL_MS) {
        lastUpload = millis();

        if (!rtcHaveClock && WiFi.status() == WL_CONNECTED) syncNtp(3000);

        readBattery();
        updatePower();
        uploadSingle(gS);
    }
}