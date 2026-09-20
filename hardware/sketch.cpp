// ============================================================================
// FRESHNESS TRACKER - BME688 + ESP32-S3 FIRMWARE
// Schema: ftrk-2.0.0
// ============================================================================
//
// CHANGES IN 2.0.0 (vs. V1):
//
//   C1  Absolute humidity is the primary humidity variable for all gas work.
//       rh_pct is still logged (human-readable) but abs_humidity_gm3 is what
//       goes to ThingSpeak as the gas-side humidity variable, and the
//       backend's design-matrix columns (T, AH, T*AH) are all logged
//       verbatim so nothing has to be reconstructed downstream.
//       Baselines now also store the (T, AH) they were captured at.
//
//   C2  Quality flags are packed into a single integer bitmask and published
//       to ThingSpeak field 7. See FLAG BITMASK below.
//
//   C3  DECISION: OPTION A. THE BACKEND OWNS BASELINING.
//       Firmware publishes gas_raw_ohm (field 4) and nothing baseline-
//       normalised. Every firmware-side normalised gas quantity is suffixed
//       _disp, is local-dashboard-only, and is NOT uploaded. There is exactly
//       one baseline in the pipeline and it lives in the backend.
//
//   C4  Full rich dataset still goes to Serial, plus:
//         - uptime_ms       monotonic, millis()-based, rollover-safe
//         - boot_count      NVS-persisted, detects reboots independently
//         - schema_version  in the header block
//         - run_label       set over serial, segments the ML dataset
//         - derived time-series features (EMAs, detrended ln R, dlnR/dt)
//
// ----------------------------------------------------------------------------
// FLAG BITMASK (ThingSpeak field 7, and the `flags` CSV column)
// ----------------------------------------------------------------------------
//   bit 0   gas_valid        BME68X_GASM_VALID_MSK
//   bit 1   heater_stable    BME68X_HEAT_STAB_MSK
//   bit 2   stabilized       BSEC stabilization status == 1
//   bit 3   run_in           BSEC run-in status == 1
//   bits 4-5 iaq_accuracy    0-3, clamped
//
//   Value range 0..63.
//   GAS IS USABLE IF AND ONLY IF flags == 63
//     (all four flags set AND iaq_accuracy == 3)
//
//   sensor_confidence is fully recoverable from flags:
//     conf = 70*min(acc/3,1) + 10*stabilized + 10*run_in
//            + 5*gas_valid + 5*heater_stable
//   so it is not uploaded separately.
//
// ----------------------------------------------------------------------------
// THINGSPEAK FIELD MAP (see FIRMWARE_README.md)
// ----------------------------------------------------------------------------
//   field1  temp_c              °C, heat-compensated
//   field2  rh_pct              %, heat-compensated
//   field3  abs_humidity_gm3    g/m3   <- gas-side humidity variable (C1)
//   field4  gas_raw_ohm         ohm    <- ONLY gas variable published (C3-A)
//   field5  bvoc_eq_ppm         ppm
//   field6  iaq                 0-500, Bosch scale (NOT the 0-100 dash score)
//   field7  flags               integer bitmask, see above (C2)
//   field8  uptime_s            monotonic seconds since boot (reboot detect)
//   status  human-readable classes + device + confidence
//
// Serial CSV is the dataset of record. ThingSpeak is a lossy demo transport.
// ============================================================================

#include <Arduino.h>
#include <Wire.h>
#include <bsec2.h>
#include <math.h>

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>


// ============================================================
// USER SETTINGS
// ============================================================

#define FW_SCHEMA_VERSION   "ftrk-2.0.0"

// Change this per physical unit. MOS sensors vary unit to unit, so every
// baseline and every trained model is per-device until proven otherwise.
#define DEVICE_ID           "FTRK-01"

const char* WIFI_SSID = "bucknell_iot";
const char* THINGSPEAK_WRITE_KEY = "CNIVGYI2N97J0FCS";

// 60 s. A multi-day spoilage run does not need 20 s cloud resolution, and
// each upload is a blocking TLS handshake that steals time from BSEC.
// Serial keeps the full 3 s LP rate. ThingSpeak free tier minimum is 15 s.
const unsigned long THINGSPEAK_INTERVAL_MS = 60000;

// 5 minutes ~= 100 LP measurements
const unsigned long CALIBRATION_TIME_MS = 5UL * 60UL * 1000UL;

// A display baseline is only meaningful near the (T, AH) it was captured at.
// Beyond these deltas the _disp columns are flagged as drifted.
const float BASELINE_DRIFT_AH_GM3 = 1.0f;
const float BASELINE_DRIFT_TEMP_C = 3.0f;


// ============================================================
// BSEC
// ============================================================

Bsec2 envSensor;

#define SAMPLE_RATE BSEC_SAMPLE_RATE_LP
#define ARRAY_LEN(x) (sizeof(x) / sizeof((x)[0]))


// ============================================================
// STORAGE
// ============================================================

Preferences baselinePrefs;
Preferences bsecPrefs;

uint8_t bsecState[BSEC_MAX_STATE_BLOB_SIZE];

unsigned long lastBsecStateSave = 0;
bool bsecStateSaved = false;

const unsigned long BSEC_STATE_SAVE_INTERVAL_MS =
    6UL * 60UL * 60UL * 1000UL;

uint32_t bootCount = 0;
String runLabel = "unset";


// ============================================================
// TYPES
//
// !! DO NOT MOVE THESE BELOW THE FIRST FUNCTION DEFINITION !!
//
// The Arduino IDE auto-generates prototypes for every function in a .ino
// and inserts them immediately before the FIRST function definition in the
// file. Any user-defined type used in a function signature must therefore be
// declared above that first function, or the generated prototype references a
// type that does not exist yet:
//
//   error: variable or field 'startCalibration' declared void
//   error: 'CalibrationMode' was not declared in this scope
//
// startCalibration() takes a CalibrationMode, so CalibrationMode lives here,
// above monotonicMs() (the first function in this file).
// ============================================================

// DISPLAY ONLY (C3 Option A). These never reach ThingSpeak.
// tempC / absHum record the conditions the baseline was captured at, so the
// local dashboard can say "this reference no longer applies" instead of
// silently reporting a humidity artefact as a spoilage signal. (C1)
struct GasBaseline
{
    float gas;
    float bvoc;
    float iaq;
    float tempC;
    float absHum;
    bool valid;
};


enum CalibrationMode
{
    CAL_NONE,
    CAL_CLEAN,
    CAL_FRESH
};


// ============================================================
// MONOTONIC CLOCK  (C4)
//
// millis() rolls over at ~49.7 days. This accumulates the rollovers so
// uptime_ms is strictly increasing for the life of a boot. A DECREASE in
// uptime across consecutive rows means the board rebooted, which also means
// the BSEC baseline reset and the gas trace is discontinuous there.
// ============================================================

uint32_t lastMillisSample = 0;
uint64_t millisRollover = 0;

uint64_t monotonicMs()
{
    uint32_t now = millis();

    if (now < lastMillisSample)
        millisRollover += 0x100000000ULL;

    lastMillisSample = now;

    return millisRollover + (uint64_t)now;
}


// ============================================================
// BASELINES  (type declared in the TYPES section above)
//
// DISPLAY ONLY (C3 Option A). These never reach ThingSpeak.
// ============================================================

GasBaseline cleanBaseline = {NAN, NAN, NAN, NAN, NAN, false};
GasBaseline freshBaseline = {NAN, NAN, NAN, NAN, NAN, false};

bool baselineCondDrift = false;


// ============================================================
// CALIBRATION  (enum declared in the TYPES section above)
// ============================================================

CalibrationMode calibrationMode = CAL_NONE;

unsigned long calibrationStart = 0;

double calGasSum = 0;
double calBvocSum = 0;
double calIaqSum = 0;
double calTempSum = 0;
double calAhSum = 0;

uint32_t calCount = 0;


// ============================================================
// LATEST THINGSPEAK VALUES  (C2 / C3-A field map)
// ============================================================

float latestTemp = NAN;
float latestRH = NAN;
float latestAbsHumidity = NAN;
float latestGasRaw = NAN;
float latestBvoc = NAN;
float latestIaq = NAN;

uint8_t latestFlags = 0;
uint32_t latestUptimeS = 0;

String latestStatus = "STARTING";

bool haveMeasurement = false;

unsigned long lastUpload = 0;
unsigned long lastWiFiAttempt = 0;


// ============================================================
// DERIVED TIME-SERIES FEATURES  (C4)
//
// All gas trend work is done on ln(R), not R. Resistance is roughly
// log-linear in concentration, so ln R is the variable with stable,
// additive behaviour, and it is the variable the backend's baseline model
// ln R = b0 + b1*T + b2*AH + b3*(T*AH) is fitted in.
// ============================================================

float odorActivityEMA = NAN;      // display only
float spoilageRiskEMA = NAN;      // display only

float tempEma = NAN;
float ahEma = NAN;
float lnGasEmaFast = NAN;
float lnGasEmaSlow = NAN;

// LP mode = one sample per 3 s.
const float EMA_ALPHA_TEMP = 0.05f;   // ~1 min
const float EMA_ALPHA_AH   = 0.05f;   // ~1 min
const float EMA_ALPHA_FAST = 0.05f;   // ~1 min
const float EMA_ALPHA_SLOW = 0.0017f; // ~30 min

// Rolling least-squares slope of ln R against time.
// 200 samples x 3 s = ~10 minutes.
#define TREND_WINDOW 200

float    trendLnGas[TREND_WINDOW];
uint32_t trendTimeS[TREND_WINDOW];
uint16_t trendCount = 0;
uint16_t trendHead = 0;

uint32_t sampleIndex = 0;


// ============================================================
// HELPERS
// ============================================================

float clampValue(float x, float lo, float hi)
{
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
}


void updateEma(float &ema, float x, float alpha)
{
    if (isnan(x))
        return;

    if (isnan(ema))
        ema = x;
    else
        ema = alpha * x + (1.0f - alpha) * ema;
}


void resetDerivedFeatures()
{
    tempEma = NAN;
    ahEma = NAN;
    lnGasEmaFast = NAN;
    lnGasEmaSlow = NAN;

    odorActivityEMA = NAN;
    spoilageRiskEMA = NAN;

    trendCount = 0;
    trendHead = 0;
}


void trendPush(float lnGas, uint32_t tSeconds)
{
    if (isnan(lnGas))
        return;

    trendLnGas[trendHead] = lnGas;
    trendTimeS[trendHead] = tSeconds;

    trendHead = (trendHead + 1) % TREND_WINDOW;

    if (trendCount < TREND_WINDOW)
        trendCount++;
}


// Ordinary least-squares slope of ln R against time, in ln-units per hour.
// Negative = resistance falling = reducing VOCs accumulating.
float trendSlopePerHour()
{
    if (trendCount < 10)
        return NAN;

    uint16_t n = trendCount;

    uint16_t startIdx =
        (trendHead + TREND_WINDOW - n) % TREND_WINDOW;

    uint32_t t0 = trendTimeS[startIdx];

    double sx = 0, sy = 0, sxx = 0, sxy = 0;

    for (uint16_t i = 0; i < n; i++)
    {
        uint16_t k = (startIdx + i) % TREND_WINDOW;

        double x = ((double)trendTimeS[k] - (double)t0) / 3600.0;
        double y = (double)trendLnGas[k];

        sx += x;
        sy += y;
        sxx += x * x;
        sxy += x * y;
    }

    double denom = (double)n * sxx - sx * sx;

    if (fabs(denom) < 1e-12)
        return NAN;

    return (float)(((double)n * sxy - sx * sy) / denom);
}


// ============================================================
// FLAG BITMASK  (C2)
// ============================================================

uint8_t buildFlags(
    bool gasValid,
    bool heaterStable,
    int stabilized,
    int runIn,
    int iaqAccuracy)
{
    uint8_t f = 0;

    if (gasValid)          f |= (1 << 0);
    if (heaterStable)      f |= (1 << 1);
    if (stabilized == 1)   f |= (1 << 2);
    if (runIn == 1)        f |= (1 << 3);

    int acc = iaqAccuracy;

    if (acc < 0) acc = 0;
    if (acc > 3) acc = 3;

    f |= (uint8_t)((acc & 0x03) << 4);

    return f;
}


// The backend's gate. All four flags set AND iaq_accuracy == 3.
bool gasUsableStrict(uint8_t flags)
{
    return flags == 0x3F;
}


// The firmware's own, looser gate for accepting local display baselines.
// Deliberately different from gasUsableStrict(): in a cold, chemically flat
// fridge BSEC can take many hours to claim accuracy 3, and the local
// dashboard should not be blank for that whole time. The strict rule above
// is the one that governs the dataset.
bool gasUsableForLocalBaseline(uint8_t flags)
{
    bool allHardware = (flags & 0x0F) == 0x0F;
    int acc = (flags >> 4) & 0x03;

    return allHardware && acc >= 2;
}


// ============================================================
// ENVIRONMENTAL CALCULATIONS
// ============================================================

float dewPointC(float tempC, float rh)
{
    if (isnan(tempC) || rh <= 0.0f || rh > 100.0f)
        return NAN;

    const float a = 17.62f;
    const float b = 243.12f;

    float gamma =
        log(rh / 100.0f) +
        (a * tempC) / (b + tempC);

    return (b * gamma) / (a - gamma);
}


// ----------------------------------------------------------------
// ABSOLUTE HUMIDITY  (C1 - the variable that matters for gas work)
//
// A MOS sensor responds to the number of water molecules competing for
// adsorption sites, not to relative saturation. RH 80% at 4 C is ~5.2 g/m3;
// RH 80% at 20 C is ~13.8 g/m3 - a factor of ~2.7. A fridge is cold, so
// even at high RH the absolute humidity stays low.
//
// Magnus formula over water. Returns g/m3.
// ----------------------------------------------------------------
float absoluteHumidity(float tempC, float rh)
{
    if (isnan(tempC) || rh <= 0.0f || rh > 100.0f)
        return NAN;

    float saturationPressure =
        6.112f *
        exp((17.67f * tempC) / (tempC + 243.5f));

    float vaporPressure =
        (rh / 100.0f) * saturationPressure;

    return 216.7f * vaporPressure / (273.15f + tempC);
}


// ============================================================
// CATEGORIES  (display only)
// ============================================================

const char* airClass(float iaq)
{
    if (isnan(iaq))  return "UNKNOWN";
    if (iaq <= 50)   return "EXCELLENT";
    if (iaq <= 100)  return "GOOD";
    if (iaq <= 150)  return "LIGHTLY_POLLUTED";
    if (iaq <= 200)  return "MODERATELY_POLLUTED";
    if (iaq <= 250)  return "HEAVILY_POLLUTED";
    if (iaq <= 350)  return "SEVERELY_POLLUTED";
    return "EXTREMELY_POLLUTED";
}


const char* odorClass(float score)
{
    if (score < 0)   return "UNCALIBRATED";
    if (score < 15)  return "LOW";
    if (score < 35)  return "MILD";
    if (score < 60)  return "MODERATE";
    if (score < 80)  return "HIGH";
    return "VERY_HIGH";
}


const char* freshnessClass(float score)
{
    if (score < 0)    return "UNCALIBRATED";
    if (score >= 80)  return "FRESH_LIKE";
    if (score >= 60)  return "WATCH";
    if (score >= 40)  return "AGING_LIKE";
    return "STRONG_CHANGE";
}


const char* confidenceClass(float score)
{
    if (score >= 85) return "HIGH";
    if (score >= 60) return "MEDIUM";
    return "LOW";
}


// ============================================================
// AIR QUALITY SCORE  (DISPLAY ONLY)
//
// Bosch IAQ: 0 = very clean, 500 = extremely polluted.
// We invert and rescale to 0-100 purely so the dashboard reads
// "higher is better". Raw iaq is what goes to ThingSpeak.
// ============================================================

float calculateAirScoreDisp(float iaq)
{
    if (isnan(iaq))
        return NAN;

    return clampValue(100.0f - iaq * 0.20f, 0.0f, 100.0f);
}


// ============================================================
// SENSOR CONFIDENCE  (DISPLAY ONLY - derivable from flags)
// ============================================================

float calculateConfidence(uint8_t flags)
{
    int acc         = (flags >> 4) & 0x03;
    bool gasValid   = flags & (1 << 0);
    bool heaterStab = flags & (1 << 1);
    bool stabilized = flags & (1 << 2);
    bool runIn      = flags & (1 << 3);

    float score = 70.0f * clampValue(acc / 3.0f, 0.0f, 1.0f);

    if (stabilized) score += 10;
    if (runIn)      score += 10;
    if (gasValid)   score += 5;
    if (heaterStab) score += 5;

    return clampValue(score, 0.0f, 100.0f);
}


// ============================================================
// ODOR ACTIVITY  (DISPLAY ONLY - NOT UPLOADED)  [C3 Option A]
//
// Baseline-normalised. Do not feed this to the backend: the backend fits
// its own humidity-compensated baseline and normalising twice either
// cancels the real signal or compounds the noise.
// ============================================================

float calculateOdorActivityDisp(float gas, float bvoc)
{
    if (!cleanBaseline.valid || cleanBaseline.gas <= 0 || gas <= 0)
        return -1;

    float gasMagnitude =
        fabs(log(gas / cleanBaseline.gas)) / log(2.0f);

    gasMagnitude = clampValue(gasMagnitude, 0.0f, 1.0f);

    float bvocMagnitude = 0;

    if (bvoc > 0 && cleanBaseline.bvoc >= 0)
    {
        float ratio = (bvoc + 0.1f) / (cleanBaseline.bvoc + 0.1f);

        if (ratio > 1.0f)
            bvocMagnitude = log(ratio) / log(4.0f);
    }

    bvocMagnitude = clampValue(bvocMagnitude, 0.0f, 1.0f);

    float instantaneous =
        100.0f * (0.70f * gasMagnitude + 0.30f * bvocMagnitude);

    if (isnan(odorActivityEMA))
        odorActivityEMA = instantaneous;
    else
        odorActivityEMA = 0.15f * instantaneous + 0.85f * odorActivityEMA;

    return clampValue(odorActivityEMA, 0.0f, 100.0f);
}


// ============================================================
// GAS RESPONSE  (DISPLAY ONLY - NOT UPLOADED)  [C3 Option A]
// ============================================================

float calculateGasResponseDisp(float gas)
{
    if (!cleanBaseline.valid || cleanBaseline.gas <= 0 || gas <= 0)
        return -1;

    float response = 100.0f * (1.0f - gas / cleanBaseline.gas);

    return clampValue(response, -100.0f, 100.0f);
}


// ============================================================
// FRESHNESS PROXY  (DISPLAY ONLY - NOT UPLOADED, NOT A TRAINING TARGET)
//
// This is our heuristic. Training on it would bake the heuristic in as
// ground truth and the model could never beat it. It exists so the demo
// has something to show. It is not food-safety certification.
// ============================================================

float calculateFreshnessDisp(
    float gas,
    float bvoc,
    float iaq,
    float confidence)
{
    if (!freshBaseline.valid || freshBaseline.gas <= 0 || confidence < 60)
        return -1;

    float gasRisk =
        (freshBaseline.gas - gas) / (0.50f * freshBaseline.gas);

    gasRisk = clampValue(gasRisk, 0.0f, 1.0f);

    float bvocScale = max(freshBaseline.bvoc, 0.50f);

    float bvocRisk =
        (bvoc - freshBaseline.bvoc) / (3.0f * bvocScale);

    bvocRisk = clampValue(bvocRisk, 0.0f, 1.0f);

    float iaqRisk = (iaq - freshBaseline.iaq) / 150.0f;

    iaqRisk = clampValue(iaqRisk, 0.0f, 1.0f);

    float instantaneousRisk =
        100.0f * (0.55f * gasRisk + 0.30f * bvocRisk + 0.15f * iaqRisk);

    if (isnan(spoilageRiskEMA))
        spoilageRiskEMA = instantaneousRisk;
    else
        spoilageRiskEMA = 0.10f * instantaneousRisk + 0.90f * spoilageRiskEMA;

    return clampValue(100.0f - spoilageRiskEMA, 0.0f, 100.0f);
}


// ============================================================
// BASELINE STORAGE
// ============================================================

void saveBaselines()
{
    baselinePrefs.putBool ("cleanValid", cleanBaseline.valid);
    baselinePrefs.putFloat("cleanGas",   cleanBaseline.gas);
    baselinePrefs.putFloat("cleanBVOC",  cleanBaseline.bvoc);
    baselinePrefs.putFloat("cleanIAQ",   cleanBaseline.iaq);
    baselinePrefs.putFloat("cleanT",     cleanBaseline.tempC);
    baselinePrefs.putFloat("cleanAH",    cleanBaseline.absHum);

    baselinePrefs.putBool ("freshValid", freshBaseline.valid);
    baselinePrefs.putFloat("freshGas",   freshBaseline.gas);
    baselinePrefs.putFloat("freshBVOC",  freshBaseline.bvoc);
    baselinePrefs.putFloat("freshIAQ",   freshBaseline.iaq);
    baselinePrefs.putFloat("freshT",     freshBaseline.tempC);
    baselinePrefs.putFloat("freshAH",    freshBaseline.absHum);
}


void loadBaselines()
{
    baselinePrefs.begin("foodtrack", false);

    bootCount = baselinePrefs.getUInt("boots", 0) + 1;
    baselinePrefs.putUInt("boots", bootCount);

    runLabel = baselinePrefs.getString("runlabel", "unset");

    cleanBaseline.valid  = baselinePrefs.getBool ("cleanValid", false);
    cleanBaseline.gas    = baselinePrefs.getFloat("cleanGas",   NAN);
    cleanBaseline.bvoc   = baselinePrefs.getFloat("cleanBVOC",  NAN);
    cleanBaseline.iaq    = baselinePrefs.getFloat("cleanIAQ",   NAN);
    cleanBaseline.tempC  = baselinePrefs.getFloat("cleanT",     NAN);
    cleanBaseline.absHum = baselinePrefs.getFloat("cleanAH",    NAN);

    freshBaseline.valid  = baselinePrefs.getBool ("freshValid", false);
    freshBaseline.gas    = baselinePrefs.getFloat("freshGas",   NAN);
    freshBaseline.bvoc   = baselinePrefs.getFloat("freshBVOC",  NAN);
    freshBaseline.iaq    = baselinePrefs.getFloat("freshIAQ",   NAN);
    freshBaseline.tempC  = baselinePrefs.getFloat("freshT",     NAN);
    freshBaseline.absHum = baselinePrefs.getFloat("freshAH",    NAN);
}


// ============================================================
// CALIBRATION
// ============================================================

void startCalibration(CalibrationMode mode)
{
    calibrationMode = mode;
    calibrationStart = millis();

    calGasSum = 0;
    calBvocSum = 0;
    calIaqSum = 0;
    calTempSum = 0;
    calAhSum = 0;

    calCount = 0;

    if (mode == CAL_CLEAN)
    {
        Serial.println("# CLEAN-AIR calibration started (display baseline only).");
        Serial.println("# Keep sensor away from food, breath, perfume and cleaners for 5 minutes.");
        Serial.println("# Capture it at the SAME temperature the run will be held at.");
    }

    if (mode == CAL_FRESH)
    {
        Serial.println("# FRESH-FOOD calibration started (display baseline only).");
        Serial.println("# Keep known-fresh food in normal final sensor geometry for 5 minutes.");
    }
}


void updateCalibration(
    float gas,
    float bvoc,
    float iaq,
    float tempC,
    float absHum,
    uint8_t flags)
{
    if (calibrationMode == CAL_NONE)
        return;

    // Only collect samples the hardware itself vouches for.
    if (!gasUsableForLocalBaseline(flags) ||
        isnan(gas)  || gas <= 0 ||
        isnan(bvoc) || isnan(iaq) ||
        isnan(tempC) || isnan(absHum))
        return;

    calGasSum  += gas;
    calBvocSum += bvoc;
    calIaqSum  += iaq;
    calTempSum += tempC;
    calAhSum   += absHum;

    calCount++;

    if (millis() - calibrationStart < CALIBRATION_TIME_MS)
        return;

    if (calCount < 30)
    {
        Serial.println("# Calibration did not obtain enough valid samples. Restarting timer.");

        calibrationStart = millis();

        calGasSum = 0;
        calBvocSum = 0;
        calIaqSum = 0;
        calTempSum = 0;
        calAhSum = 0;

        calCount = 0;

        return;
    }

    GasBaseline result;

    result.gas    = calGasSum  / calCount;
    result.bvoc   = calBvocSum / calCount;
    result.iaq    = calIaqSum  / calCount;
    result.tempC  = calTempSum / calCount;
    result.absHum = calAhSum   / calCount;
    result.valid  = true;

    if (calibrationMode == CAL_CLEAN)
    {
        cleanBaseline = result;
        odorActivityEMA = NAN;
        Serial.println("# CLEAN baseline saved.");
    }

    if (calibrationMode == CAL_FRESH)
    {
        freshBaseline = result;
        spoilageRiskEMA = NAN;
        Serial.println("# FRESH baseline saved.");
    }

    saveBaselines();

    Serial.print("# Baseline gas  = "); Serial.println(result.gas, 1);
    Serial.print("# Baseline bVOC = "); Serial.println(result.bvoc, 4);
    Serial.print("# Baseline IAQ  = "); Serial.println(result.iaq, 2);
    Serial.print("# Captured at T = "); Serial.print(result.tempC, 2);
    Serial.print(" C, AH = ");          Serial.print(result.absHum, 3);
    Serial.println(" g/m3");

    calibrationMode = CAL_NONE;
}


// ============================================================
// CSV HEADER  (C4 - schema version lives here)
// ============================================================

void printCsvHeader()
{
    Serial.println("# ============================================================");
    Serial.print  ("# schema_version=");    Serial.println(FW_SCHEMA_VERSION);
    Serial.print  ("# device_id=");         Serial.println(DEVICE_ID);
    Serial.print  ("# run_label=");         Serial.println(runLabel);
    Serial.print  ("# boot_count=");        Serial.println(bootCount);
    Serial.println("# baselining_owner=BACKEND (Option A)");
    Serial.println("#   firmware publishes gas_raw_ohm only; every *_disp column is");
    Serial.println("#   local-dashboard-only and must NOT be used downstream.");
    Serial.println("# humidity_for_gas=abs_humidity_gm3 (g/m3), NOT rh_pct");
    Serial.println("# backend_baseline_model: ln(gas_raw_ohm) ~ 1 + temp_c + abs_humidity_gm3 + t_x_ah");
    Serial.println("# flags bitmask: b0=gas_valid b1=heater_stable b2=stabilized b3=run_in b4:5=iaq_accuracy");
    Serial.println("# gas_usable = (flags == 63)");
    Serial.println("# uptime_ms is monotonic per boot; a decrease => reboot => gas trace discontinuity");
    Serial.println("# dln_gas_per_hr = OLS slope of ln(R) vs time over the last ~10 min");
    Serial.println("# ============================================================");

    Serial.println(
        "sample_idx,"
        "uptime_ms,"
        "boot_count,"
        "bsec_time_ms,"
        "device_id,"
        "run_label,"
        "temp_c,"
        "rh_pct,"
        "abs_humidity_gm3,"
        "t_x_ah,"
        "dew_point_c,"
        "pressure_hpa,"
        "gas_raw_ohm,"
        "ln_gas,"
        "bvoc_eq_ppm,"
        "iaq,"
        "static_iaq,"
        "eco2_eq_ppm,"
        "bosch_gas_pct,"
        "gas_comp,"
        "iaq_accuracy,"
        "stabilized,"
        "run_in,"
        "gas_valid,"
        "heater_stable,"
        "flags,"
        "gas_usable,"
        "temp_c_ema,"
        "abs_humidity_ema,"
        "ln_gas_ema_fast,"
        "ln_gas_ema_slow,"
        "ln_gas_detrend,"
        "dln_gas_per_hr,"
        "trend_n,"
        "clean_gas_baseline,"
        "clean_baseline_temp_c,"
        "clean_baseline_ah_gm3,"
        "fresh_gas_baseline,"
        "fresh_baseline_temp_c,"
        "fresh_baseline_ah_gm3,"
        "baseline_cond_drift,"
        "air_quality_score_disp,"
        "odor_activity_disp,"
        "freshness_proxy_disp,"
        "gas_response_pct_disp,"
        "sensor_confidence,"
        "air_class,"
        "odor_class,"
        "food_class"
    );
}


// ============================================================
// SERIAL COMMANDS
// ============================================================

String serialLine = "";


void printBaselineStatus()
{
    Serial.println("# ----------------------------");

    Serial.print("# device=");     Serial.print(DEVICE_ID);
    Serial.print("  schema=");     Serial.print(FW_SCHEMA_VERSION);
    Serial.print("  boot=");       Serial.print(bootCount);
    Serial.print("  run_label=");  Serial.println(runLabel);

    Serial.print("# Clean baseline: ");

    if (cleanBaseline.valid)
    {
        Serial.print("YES | gas=");  Serial.print(cleanBaseline.gas, 1);
        Serial.print(" | bVOC=");    Serial.print(cleanBaseline.bvoc, 4);
        Serial.print(" | IAQ=");     Serial.print(cleanBaseline.iaq, 2);
        Serial.print(" | T=");       Serial.print(cleanBaseline.tempC, 2);
        Serial.print("C | AH=");     Serial.print(cleanBaseline.absHum, 3);
        Serial.println(" g/m3");
    }
    else
    {
        Serial.println("NO");
    }

    Serial.print("# Fresh baseline: ");

    if (freshBaseline.valid)
    {
        Serial.print("YES | gas=");  Serial.print(freshBaseline.gas, 1);
        Serial.print(" | bVOC=");    Serial.print(freshBaseline.bvoc, 4);
        Serial.print(" | IAQ=");     Serial.print(freshBaseline.iaq, 2);
        Serial.print(" | T=");       Serial.print(freshBaseline.tempC, 2);
        Serial.print("C | AH=");     Serial.print(freshBaseline.absHum, 3);
        Serial.println(" g/m3");
    }
    else
    {
        Serial.println("NO");
    }

    Serial.println("# Commands (type the letter, then press Enter):");
    Serial.println("#   C            clean-air calibration (display baseline)");
    Serial.println("#   F            fresh-food calibration (display baseline)");
    Serial.println("#   S            show this status");
    Serial.println("#   R            erase baselines");
    Serial.println("#   L <text>     set run label, e.g.  L banana_A T=4C");
    Serial.println("#   H            re-print the CSV header block");
    Serial.println("# ----------------------------");
}


void processCommand(String line)
{
    line.trim();

    if (line.length() == 0)
        return;

    char command = toupper(line.charAt(0));

    String arg = line.substring(1);
    arg.trim();

    if (command == 'C')
    {
        startCalibration(CAL_CLEAN);
    }
    else if (command == 'F')
    {
        startCalibration(CAL_FRESH);
    }
    else if (command == 'S')
    {
        printBaselineStatus();
    }
    else if (command == 'H')
    {
        printCsvHeader();
    }
    else if (command == 'L')
    {
        if (arg.length() == 0)
        {
            Serial.print("# run_label=");
            Serial.println(runLabel);
            return;
        }

        // Keep the CSV parseable.
        arg.replace(",", ";");
        arg.replace("\"", "'");

        runLabel = arg;
        baselinePrefs.putString("runlabel", runLabel);

        // A new run is new food. Do not carry the previous run's trend.
        resetDerivedFeatures();

        Serial.print("# RUN_START run_label=");
        Serial.print(runLabel);
        Serial.print(" uptime_ms=");
        Serial.print((unsigned long)(monotonicMs()));
        Serial.print(" boot_count=");
        Serial.println(bootCount);

        printCsvHeader();
    }
    else if (command == 'R')
    {
        cleanBaseline = {NAN, NAN, NAN, NAN, NAN, false};
        freshBaseline = {NAN, NAN, NAN, NAN, NAN, false};

        baselinePrefs.remove("cleanValid");
        baselinePrefs.remove("freshValid");

        saveBaselines();

        resetDerivedFeatures();

        Serial.println("# Baselines erased.");
    }
    else
    {
        Serial.println("# Unknown command. Type S for help.");
    }
}


void handleSerialCommands()
{
    while (Serial.available())
    {
        char c = Serial.read();

        if (c == '\n' || c == '\r')
        {
            if (serialLine.length() > 0)
            {
                processCommand(serialLine);
                serialLine = "";
            }

            continue;
        }

        if (serialLine.length() < 80)
            serialLine += c;
    }
}


// ============================================================
// BSEC STATE
// ============================================================

void loadBsecState()
{
    bsecPrefs.begin("bsecstate", false);

    size_t length = bsecPrefs.getBytesLength("state");

    if (length == BSEC_MAX_STATE_BLOB_SIZE)
    {
        bsecPrefs.getBytes("state", bsecState, BSEC_MAX_STATE_BLOB_SIZE);

        if (envSensor.setState(bsecState))
        {
            Serial.println("# BSEC state restored.");
            bsecStateSaved = true;
        }
    }
}


void saveBsecState()
{
    if (!envSensor.getState(bsecState))
        return;

    bsecPrefs.putBytes("state", bsecState, BSEC_MAX_STATE_BLOB_SIZE);

    lastBsecStateSave = millis();
    bsecStateSaved = true;

    Serial.println("# BSEC state saved.");
}


void maybeSaveBsecState(int accuracy)
{
    if (!bsecStateSaved && accuracy >= 3)
    {
        saveBsecState();
        return;
    }

    if (accuracy >= 2 &&
        millis() - lastBsecStateSave >= BSEC_STATE_SAVE_INTERVAL_MS)
    {
        saveBsecState();
    }
}


// ============================================================
// BSEC STATUS
// ============================================================

void checkBsecStatus()
{
    if (envSensor.status < BSEC_OK)
    {
        Serial.print("# BSEC ERROR: ");
        Serial.println(envSensor.status);

        while (true)
            delay(1000);
    }

    if (envSensor.status > BSEC_OK)
    {
        Serial.print("# BSEC WARNING: ");
        Serial.println(envSensor.status);
    }

    if (envSensor.sensor.status < BME68X_OK)
    {
        Serial.print("# BME688 ERROR: ");
        Serial.println(envSensor.sensor.status);

        while (true)
            delay(1000);
    }
}


// ============================================================
// WIFI
// ============================================================

void startWiFi()
{
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID);

    lastWiFiAttempt = millis();

    Serial.println("# Starting WiFi...");
}


void maintainWiFi()
{
    if (WiFi.status() == WL_CONNECTED)
        return;

    if (millis() - lastWiFiAttempt < 30000)
        return;

    lastWiFiAttempt = millis();

    Serial.println("# WiFi reconnect...");

    WiFi.disconnect();
    WiFi.begin(WIFI_SSID);
}


// ============================================================
// URL ENCODING FOR THINGSPEAK STATUS
// ============================================================

String urlEncode(const String &input)
{
    String output;
    char buffer[4];

    for (size_t i = 0; i < input.length(); i++)
    {
        char c = input[i];

        bool safe =
            (c >= 'A' && c <= 'Z') ||
            (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') ||
            c == '-' || c == '_' || c == '.';

        if (safe)
        {
            output += c;
        }
        else
        {
            snprintf(buffer, sizeof(buffer), "%%%02X", (unsigned char)c);
            output += buffer;
        }
    }

    return output;
}


// ============================================================
// THINGSPEAK
//
// field1 temp_c            field5 bvoc_eq_ppm
// field2 rh_pct            field6 iaq (Bosch 0-500)
// field3 abs_humidity_gm3  field7 flags bitmask
// field4 gas_raw_ohm       field8 uptime_s
//
// NaN fields are omitted rather than sent as the string "nan", which
// ThingSpeak rejects. An omitted field comes back empty in the feed, which
// is what the backend should see: missing, not zero.
// ============================================================

void appendField(String &url, int index, float value, int decimals)
{
    if (isnan(value) || isinf(value))
        return;

    url += "&field";
    url += index;
    url += "=";
    url += String(value, decimals);
}


void uploadThingSpeak()
{
    if (WiFi.status() != WL_CONNECTED)
        return;

    if (!haveMeasurement)
        return;

    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient https;
    https.setTimeout(6000);

    String url = "https://api.thingspeak.com/update?api_key=";
    url += THINGSPEAK_WRITE_KEY;

    appendField(url, 1, latestTemp,        2);
    appendField(url, 2, latestRH,          2);
    appendField(url, 3, latestAbsHumidity, 3);
    appendField(url, 4, latestGasRaw,      1);
    appendField(url, 5, latestBvoc,        4);
    appendField(url, 6, latestIaq,         2);

    url += "&field7=";
    url += String((int)latestFlags);

    url += "&field8=";
    url += String((unsigned long)latestUptimeS);

    url += "&status=";
    url += urlEncode(latestStatus);

    if (!https.begin(client, url))
    {
        Serial.println("# ThingSpeak init failed");
        return;
    }

    int code = https.GET();

    if (code > 0)
    {
        String response = https.getString();
        response.trim();

        Serial.print("# ThingSpeak entry: ");
        Serial.println(response);

        if (response == "0")
            Serial.println("# ThingSpeak rejected the write (rate limit or bad key).");
    }
    else
    {
        Serial.print("# ThingSpeak error: ");
        Serial.println(code);
    }

    https.end();
}


// ============================================================
// BSEC CALLBACK
// ============================================================

void newDataCallback(
    const bme68xData data,
    const bsecOutputs outputs,
    Bsec2 bsec)
{
    if (!outputs.nOutputs)
        return;

    float tempComp = NAN;
    float humidityComp = NAN;

    float iaq = NAN;
    float staticIaq = NAN;

    float bvocEq = NAN;
    float eco2Eq = NAN;

    float gasPct = NAN;
    float gasComp = NAN;
    float gasRaw = NAN;

    int iaqAccuracy = -1;
    int stabilization = -1;
    int runIn = -1;


    // ========================================================
    // BSEC OUTPUT PARSER
    // ========================================================

    for (uint8_t i = 0; i < outputs.nOutputs; i++)
    {
        const bsecData output = outputs.output[i];

        switch (output.sensor_id)
        {
            case BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_TEMPERATURE:
                tempComp = output.signal;
                break;

            case BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_HUMIDITY:
                humidityComp = output.signal;
                break;

            case BSEC_OUTPUT_IAQ:
                iaq = output.signal;
                iaqAccuracy = output.accuracy;
                break;

            case BSEC_OUTPUT_STATIC_IAQ:
                staticIaq = output.signal;
                break;

            case BSEC_OUTPUT_BREATH_VOC_EQUIVALENT:
                bvocEq = output.signal;
                break;

            case BSEC_OUTPUT_CO2_EQUIVALENT:
                eco2Eq = output.signal;
                break;

            case BSEC_OUTPUT_GAS_PERCENTAGE:
                gasPct = output.signal;
                break;

            case BSEC_OUTPUT_COMPENSATED_GAS:
                gasComp = output.signal;
                break;

            case BSEC_OUTPUT_RAW_GAS:
                gasRaw = output.signal;
                break;

            case BSEC_OUTPUT_STABILIZATION_STATUS:
                stabilization = (int)output.signal;
                break;

            case BSEC_OUTPUT_RUN_IN_STATUS:
                runIn = (int)output.signal;
                break;

            default:
                break;
        }
    }


    // Fallback if BSEC raw gas output wasn't emitted.
    if (isnan(gasRaw) || gasRaw <= 0)
        gasRaw = data.gas_resistance;


    // BSEC2 converts this to hPa before callback.
    float pressureHpa = data.pressure;


    bool gasValid =
        (data.status & BME68X_GASM_VALID_MSK) != 0;

    bool heaterStable =
        (data.status & BME68X_HEAT_STAB_MSK) != 0;


    uint8_t flags =
        buildFlags(gasValid, heaterStable, stabilization, runIn, iaqAccuracy);

    bool gasUsable = gasUsableStrict(flags);


    // ========================================================
    // ENVIRONMENT  (C1)
    // ========================================================

    float absHum = absoluteHumidity(tempComp, humidityComp);
    float dew = dewPointC(tempComp, humidityComp);

    // The backend's third design-matrix column, logged verbatim so the model
    // spec lives in the dataset rather than only in someone's notebook.
    float tXah =
        (isnan(tempComp) || isnan(absHum)) ? NAN : (tempComp * absHum);

    float confidence = calculateConfidence(flags);


    // ========================================================
    // DERIVED TIME-SERIES FEATURES  (C4)
    // ========================================================

    uint64_t uptimeMs = monotonicMs();
    uint32_t uptimeS = (uint32_t)(uptimeMs / 1000ULL);

    float lnGas =
        (isnan(gasRaw) || gasRaw <= 0) ? NAN : log(gasRaw);

    updateEma(tempEma, tempComp, EMA_ALPHA_TEMP);
    updateEma(ahEma,   absHum,   EMA_ALPHA_AH);

    // Only trend on samples the hardware vouches for. A reading taken while
    // the heater is unstable is not a measurement of anything.
    if (gasValid && heaterStable && !isnan(lnGas))
    {
        updateEma(lnGasEmaFast, lnGas, EMA_ALPHA_FAST);
        updateEma(lnGasEmaSlow, lnGas, EMA_ALPHA_SLOW);

        trendPush(lnGas, uptimeS);
    }

    float lnGasDetrend =
        (isnan(lnGasEmaFast) || isnan(lnGasEmaSlow))
            ? NAN
            : (lnGasEmaFast - lnGasEmaSlow);

    float dlnGasPerHr = trendSlopePerHour();


    // ========================================================
    // BASELINE CONDITION DRIFT  (C1)
    //
    // The display baseline is a single point in (T, AH) space. If the fridge
    // has warmed or the air has gained water since capture, a change in R is
    // not evidence of spoilage. Say so rather than showing a number.
    // ========================================================

    baselineCondDrift = false;

    if (cleanBaseline.valid &&
        !isnan(absHum) && !isnan(cleanBaseline.absHum) &&
        !isnan(tempComp) && !isnan(cleanBaseline.tempC))
    {
        baselineCondDrift =
            (fabs(absHum - cleanBaseline.absHum) > BASELINE_DRIFT_AH_GM3) ||
            (fabs(tempComp - cleanBaseline.tempC) > BASELINE_DRIFT_TEMP_C);
    }


    // ========================================================
    // AUTOMATIC FIRST CLEAN-AIR CALIBRATION
    // ========================================================

    if (!cleanBaseline.valid &&
        calibrationMode == CAL_NONE &&
        gasUsableForLocalBaseline(flags))
    {
        startCalibration(CAL_CLEAN);
    }

    updateCalibration(gasRaw, bvocEq, iaq, tempComp, absHum, flags);


    // ========================================================
    // DISPLAY-ONLY SCORES  (C3 Option A - none of these upload)
    // ========================================================

    float airScoreDisp     = calculateAirScoreDisp(iaq);
    float odorActivityDisp = calculateOdorActivityDisp(gasRaw, bvocEq);
    float gasResponseDisp  = calculateGasResponseDisp(gasRaw);
    float freshnessDisp    = calculateFreshnessDisp(gasRaw, bvocEq, iaq, confidence);


    // ========================================================
    // THINGSPEAK VALUES  (C2 / C3-A)
    // ========================================================

    latestTemp        = tempComp;
    latestRH          = humidityComp;
    latestAbsHumidity = absHum;
    latestGasRaw      = gasRaw;
    latestBvoc        = bvocEq;
    latestIaq         = iaq;
    latestFlags       = flags;
    latestUptimeS     = uptimeS;

    latestStatus =
        String(DEVICE_ID) +
        " | " + runLabel +
        " | AIR=" + String(airClass(iaq)) +
        " | ODOR=" + String(odorClass(odorActivityDisp)) +
        " | FOOD=" + String(freshnessClass(freshnessDisp)) +
        " | CONF=" + String(confidenceClass(confidence)) +
        " | GAS=" + String(gasUsable ? "USABLE" : "REJECT") +
        (baselineCondDrift ? " | BASELINE_DRIFT" : "");

    haveMeasurement = true;


    // ========================================================
    // FULL RESEARCH CSV  (C4)
    // Column order MUST match printCsvHeader() exactly.
    // ========================================================

    uint64_t bsecTimeMs = outputs.output[0].time_stamp / 1000000ULL;

    sampleIndex++;

    Serial.print(sampleIndex);                       Serial.print(",");
    Serial.print((unsigned long long)uptimeMs);      Serial.print(",");
    Serial.print(bootCount);                         Serial.print(",");
    Serial.print((unsigned long long)bsecTimeMs);    Serial.print(",");
    Serial.print(DEVICE_ID);                         Serial.print(",");
    Serial.print(runLabel);                          Serial.print(",");

    Serial.print(tempComp, 3);                       Serial.print(",");
    Serial.print(humidityComp, 3);                   Serial.print(",");
    Serial.print(absHum, 4);                         Serial.print(",");
    Serial.print(tXah, 4);                           Serial.print(",");
    Serial.print(dew, 3);                            Serial.print(",");
    Serial.print(pressureHpa, 3);                    Serial.print(",");

    Serial.print(gasRaw, 1);                         Serial.print(",");
    Serial.print(lnGas, 6);                          Serial.print(",");
    Serial.print(bvocEq, 4);                         Serial.print(",");
    Serial.print(iaq, 2);                            Serial.print(",");
    Serial.print(staticIaq, 2);                      Serial.print(",");
    Serial.print(eco2Eq, 2);                         Serial.print(",");
    Serial.print(gasPct, 3);                         Serial.print(",");
    Serial.print(gasComp, 3);                        Serial.print(",");

    Serial.print(iaqAccuracy);                       Serial.print(",");
    Serial.print(stabilization);                     Serial.print(",");
    Serial.print(runIn);                             Serial.print(",");
    Serial.print(gasValid ? 1 : 0);                  Serial.print(",");
    Serial.print(heaterStable ? 1 : 0);              Serial.print(",");
    Serial.print((int)flags);                        Serial.print(",");
    Serial.print(gasUsable ? 1 : 0);                 Serial.print(",");

    Serial.print(tempEma, 4);                        Serial.print(",");
    Serial.print(ahEma, 4);                          Serial.print(",");
    Serial.print(lnGasEmaFast, 6);                   Serial.print(",");
    Serial.print(lnGasEmaSlow, 6);                   Serial.print(",");
    Serial.print(lnGasDetrend, 6);                   Serial.print(",");
    Serial.print(dlnGasPerHr, 6);                    Serial.print(",");
    Serial.print(trendCount);                        Serial.print(",");

    Serial.print(cleanBaseline.valid ? cleanBaseline.gas    : NAN, 1);  Serial.print(",");
    Serial.print(cleanBaseline.valid ? cleanBaseline.tempC  : NAN, 3);  Serial.print(",");
    Serial.print(cleanBaseline.valid ? cleanBaseline.absHum : NAN, 4);  Serial.print(",");
    Serial.print(freshBaseline.valid ? freshBaseline.gas    : NAN, 1);  Serial.print(",");
    Serial.print(freshBaseline.valid ? freshBaseline.tempC  : NAN, 3);  Serial.print(",");
    Serial.print(freshBaseline.valid ? freshBaseline.absHum : NAN, 4);  Serial.print(",");
    Serial.print(baselineCondDrift ? 1 : 0);                            Serial.print(",");

    Serial.print(airScoreDisp, 2);                   Serial.print(",");
    Serial.print(odorActivityDisp, 2);               Serial.print(",");
    Serial.print(freshnessDisp, 2);                  Serial.print(",");
    Serial.print(gasResponseDisp, 2);                Serial.print(",");
    Serial.print(confidence, 2);                     Serial.print(",");

    Serial.print(airClass(iaq));                     Serial.print(",");
    Serial.print(odorClass(odorActivityDisp));       Serial.print(",");
    Serial.println(freshnessClass(freshnessDisp));


    maybeSaveBsecState(iaqAccuracy);
}


// ============================================================
// SETUP
// ============================================================

void setup()
{
    Serial.begin(115200);

    delay(1500);

    lastMillisSample = millis();

    Serial.println();
    Serial.println("# =========================================");
    Serial.println("# BME688 FRESHNESS TRACKER");
    Serial.print  ("# firmware schema ");
    Serial.println(FW_SCHEMA_VERSION);
    Serial.println("# =========================================");

    loadBaselines();

    Serial.print("# BOOT boot_count=");
    Serial.println(bootCount);

    Wire.begin();

    if (!envSensor.begin(BME68X_I2C_ADDR_HIGH, Wire))
        checkBsecStatus();

    loadBsecState();

    bsecSensor sensorList[] =
    {
        BSEC_OUTPUT_IAQ,

        BSEC_OUTPUT_RAW_PRESSURE,
        BSEC_OUTPUT_RAW_GAS,

        BSEC_OUTPUT_STABILIZATION_STATUS,
        BSEC_OUTPUT_RUN_IN_STATUS,

        BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_TEMPERATURE,
        BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_HUMIDITY,

        BSEC_OUTPUT_STATIC_IAQ,

        BSEC_OUTPUT_CO2_EQUIVALENT,
        BSEC_OUTPUT_BREATH_VOC_EQUIVALENT,

        BSEC_OUTPUT_GAS_PERCENTAGE,
        BSEC_OUTPUT_COMPENSATED_GAS
    };

    if (!envSensor.updateSubscription(sensorList, ARRAY_LEN(sensorList), SAMPLE_RATE))
        checkBsecStatus();

    envSensor.attachCallback(newDataCallback);

    Serial.print("# BSEC version: ");
    Serial.print(envSensor.version.major);        Serial.print(".");
    Serial.print(envSensor.version.minor);        Serial.print(".");
    Serial.print(envSensor.version.major_bugfix); Serial.print(".");
    Serial.println(envSensor.version.minor_bugfix);

    printCsvHeader();
    printBaselineStatus();

    if (!cleanBaseline.valid)
    {
        Serial.println("# CLEAN display baseline missing.");
        Serial.println("# Leave sensor in clean air at the run temperature.");
        Serial.println("# Calibration starts automatically once the hardware flags are good.");
    }

    if (!freshBaseline.valid)
    {
        Serial.println("# After clean calibration, place KNOWN-FRESH food near sensor.");
        Serial.println("# Then type F and press Enter.");
    }

    Serial.println("# Set the run label before starting a run, e.g.:  L banana_A T=4C");

    startWiFi();

    lastUpload = millis();
}


// ============================================================
// LOOP
// ============================================================

void loop()
{
    // Bosch processing always gets priority.
    if (!envSensor.run())
        checkBsecStatus();

    handleSerialCommands();

    maintainWiFi();

    if (haveMeasurement &&
        millis() - lastUpload >= THINGSPEAK_INTERVAL_MS)
    {
        uploadThingSpeak();
        lastUpload = millis();
    }
}