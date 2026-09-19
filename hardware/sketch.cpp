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

const char* WIFI_SSID = "bucknell_iot";
const char* THINGSPEAK_WRITE_KEY = "CNIVGYI2N97J0FCS";

const unsigned long THINGSPEAK_INTERVAL_MS = 20000;

// 5 minutes ≈ 100 LP measurements
const unsigned long CALIBRATION_TIME_MS = 5UL * 60UL * 1000UL;


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


// ============================================================
// BASELINES
// ============================================================

struct GasBaseline
{
    float gas;
    float bvoc;
    float iaq;
    bool valid;
};

GasBaseline cleanBaseline = {NAN, NAN, NAN, false};
GasBaseline freshBaseline = {NAN, NAN, NAN, false};


// ============================================================
// CALIBRATION
// ============================================================

enum CalibrationMode
{
    CAL_NONE,
    CAL_CLEAN,
    CAL_FRESH
};

CalibrationMode calibrationMode = CAL_NONE;

unsigned long calibrationStart = 0;

double calGasSum = 0;
double calBvocSum = 0;
double calIaqSum = 0;

uint32_t calCount = 0;


// ============================================================
// LATEST THINGSPEAK VALUES
// ============================================================

float latestTemp = NAN;
float latestRH = NAN;
float latestAbsHumidity = NAN;

float latestAirScore = NAN;
float latestOdorActivity = -1;
float latestFreshness = -1;
float latestGasResponse = -1;
float latestConfidence = 0;

String latestStatus = "STARTING";

bool haveMeasurement = false;

unsigned long lastUpload = 0;
unsigned long lastWiFiAttempt = 0;


// ============================================================
// SMOOTHED SCORES
// ============================================================

float odorActivityEMA = NAN;
float spoilageRiskEMA = NAN;


// ============================================================
// HELPER
// ============================================================

float clampValue(float x, float lo, float hi)
{
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
}


// ============================================================
// ENVIRONMENTAL CALCULATIONS
// ============================================================

float dewPointC(float tempC, float rh)
{
    if (rh <= 0.0f || rh > 100.0f)
        return NAN;

    const float a = 17.62f;
    const float b = 243.12f;

    float gamma =
        log(rh / 100.0f) +
        (a * tempC) /
        (b + tempC);

    return
        (b * gamma) /
        (a - gamma);
}


float absoluteHumidity(float tempC, float rh)
{
    if (rh <= 0.0f || rh > 100.0f)
        return NAN;

    float saturationPressure =
        6.112f *
        exp(
            (17.67f * tempC) /
            (tempC + 243.5f)
        );

    float vaporPressure =
        (rh / 100.0f) *
        saturationPressure;

    return
        216.7f *
        vaporPressure /
        (273.15f + tempC);
}


// ============================================================
// CATEGORIES
// ============================================================

const char* airClass(float iaq)
{
    if (isnan(iaq))
        return "UNKNOWN";

    if (iaq <= 50)  return "EXCELLENT";
    if (iaq <= 100) return "GOOD";
    if (iaq <= 150) return "LIGHTLY_POLLUTED";
    if (iaq <= 200) return "MODERATELY_POLLUTED";
    if (iaq <= 250) return "HEAVILY_POLLUTED";
    if (iaq <= 350) return "SEVERELY_POLLUTED";

    return "EXTREMELY_POLLUTED";
}


const char* odorClass(float score)
{
    if (score < 0)
        return "UNCALIBRATED";

    if (score < 15) return "LOW";
    if (score < 35) return "MILD";
    if (score < 60) return "MODERATE";
    if (score < 80) return "HIGH";

    return "VERY_HIGH";
}


const char* freshnessClass(float score)
{
    if (score < 0)
        return "UNCALIBRATED";

    if (score >= 80) return "FRESH_LIKE";
    if (score >= 60) return "WATCH";
    if (score >= 40) return "AGING_LIKE";

    return "STRONG_CHANGE";
}


const char* confidenceClass(float score)
{
    if (score >= 85) return "HIGH";
    if (score >= 60) return "MEDIUM";

    return "LOW";
}


// ============================================================
// AIR QUALITY SCORE
//
// Bosch:
// IAQ = 0      -> very clean
// IAQ = 500    -> extremely polluted
//
// Our dashboard transformation:
// 0 IAQ   -> 100 score
// 500 IAQ ->   0 score
//
// This is ONLY a presentation transformation.
// ============================================================

float calculateAirScore(float iaq)
{
    if (isnan(iaq))
        return NAN;

    return clampValue(
        100.0f - iaq * 0.20f,
        0.0f,
        100.0f
    );
}


// ============================================================
// SENSOR CONFIDENCE
//
// 70% comes from Bosch IAQ accuracy.
// Remaining 30% comes from sensor validity/status.
//
// This is OUR quality score.
// ============================================================

float calculateConfidence(
    int iaqAccuracy,
    int stabilized,
    int runIn,
    bool gasValid,
    bool heaterStable)
{
    float score = 0;

    score +=
        70.0f *
        clampValue(
            iaqAccuracy / 3.0f,
            0.0f,
            1.0f
        );

    if (stabilized == 1)
        score += 10;

    if (runIn == 1)
        score += 10;

    if (gasValid)
        score += 5;

    if (heaterStable)
        score += 5;

    return clampValue(
        score,
        0.0f,
        100.0f
    );
}


// ============================================================
// ODOR ACTIVITY
//
// Uses clean-air baseline.
//
// Gas component:
// magnitude of logarithmic resistance change.
//
// A factor-of-2 change in resistance ~= maximum gas-change score.
//
// bVOC component:
// compares Bosch bVOC with clean-air bVOC.
//
// This is NOT "ppm of smell".
// ============================================================

float calculateOdorActivity(
    float gas,
    float bvoc)
{
    if (
        !cleanBaseline.valid ||
        cleanBaseline.gas <= 0 ||
        gas <= 0
    )
        return -1;


    float gasMagnitude =
        fabs(
            log(
                gas /
                cleanBaseline.gas
            )
        ) /
        log(2.0f);


    gasMagnitude =
        clampValue(
            gasMagnitude,
            0.0f,
            1.0f
        );


    float bvocMagnitude = 0;


    if (
        bvoc > 0 &&
        cleanBaseline.bvoc >= 0
    )
    {
        float ratio =
            (bvoc + 0.1f) /
            (cleanBaseline.bvoc + 0.1f);

        if (ratio > 1.0f)
        {
            bvocMagnitude =
                log(ratio) /
                log(4.0f);
        }
    }


    bvocMagnitude =
        clampValue(
            bvocMagnitude,
            0.0f,
            1.0f
        );


    float instantaneous =
        100.0f *
        (
            0.70f * gasMagnitude +
            0.30f * bvocMagnitude
        );


    // Smooth transient spikes such as breathing near the sensor.

    if (isnan(odorActivityEMA))
        odorActivityEMA =
            instantaneous;
    else
        odorActivityEMA =
            0.15f * instantaneous +
            0.85f * odorActivityEMA;


    return clampValue(
        odorActivityEMA,
        0.0f,
        100.0f
    );
}


// ============================================================
// GAS RESPONSE
//
// Positive = resistance has fallen relative to clean air.
//
// For reducing VOCs, increasing VOC concentration generally
// lowers BME688 gas resistance.
//
// This is transparent and useful for later analysis.
// ============================================================

float calculateGasResponse(float gas)
{
    if (
        !cleanBaseline.valid ||
        cleanBaseline.gas <= 0 ||
        gas <= 0
    )
        return -1;


    float response =
        100.0f *
        (
            1.0f -
            gas /
            cleanBaseline.gas
        );


    // Keep dashboard readable.
    // Full raw resistance remains in Serial.

    return clampValue(
        response,
        -100.0f,
        100.0f
    );
}


// ============================================================
// EXPERIMENTAL FRESHNESS PROXY
//
// Requires a KNOWN-FRESH FOOD baseline.
//
// It watches three changes relative to that reference:
//
// 55% raw gas-resistance drop
// 30% increase in Bosch bVOC equivalent
// 15% increase in Bosch IAQ
//
// This is intentionally called a PROXY.
// It is NOT food-safety certification.
// ============================================================

float calculateFreshness(
    float gas,
    float bvoc,
    float iaq,
    float confidence)
{
    if (
        !freshBaseline.valid ||
        freshBaseline.gas <= 0 ||
        confidence < 60
    )
        return -1;


    // --------------------------------------------------------
    // GAS RISK
    //
    // A 50% resistance decrease from fresh reference
    // produces maximum gas contribution.
    // --------------------------------------------------------

    float gasRisk =
        (
            freshBaseline.gas -
            gas
        ) /
        (
            0.50f *
            freshBaseline.gas
        );

    gasRisk =
        clampValue(
            gasRisk,
            0.0f,
            1.0f
        );


    // --------------------------------------------------------
    // bVOC RISK
    //
    // Approximately a 4x rise from fresh-reference level
    // reaches maximum bVOC contribution.
    // --------------------------------------------------------

    float bvocScale =
        max(
            freshBaseline.bvoc,
            0.50f
        );


    float bvocRisk =
        (
            bvoc -
            freshBaseline.bvoc
        ) /
        (
            3.0f *
            bvocScale
        );


    bvocRisk =
        clampValue(
            bvocRisk,
            0.0f,
            1.0f
        );


    // --------------------------------------------------------
    // IAQ RISK
    //
    // A +150 IAQ shift spans several Bosch air-quality bands.
    // --------------------------------------------------------

    float iaqRisk =
        (
            iaq -
            freshBaseline.iaq
        ) /
        150.0f;


    iaqRisk =
        clampValue(
            iaqRisk,
            0.0f,
            1.0f
        );


    // --------------------------------------------------------
    // COMBINE
    // --------------------------------------------------------

    float instantaneousRisk =
        100.0f *
        (
            0.55f * gasRisk +
            0.30f * bvocRisk +
            0.15f * iaqRisk
        );


    // Slow smoothing:
    // food should not become "old" because someone breathed nearby.

    if (isnan(spoilageRiskEMA))
        spoilageRiskEMA =
            instantaneousRisk;
    else
        spoilageRiskEMA =
            0.10f *
            instantaneousRisk +
            0.90f *
            spoilageRiskEMA;


    float freshness =
        100.0f -
        spoilageRiskEMA;


    return clampValue(
        freshness,
        0.0f,
        100.0f
    );
}


// ============================================================
// BASELINE STORAGE
// ============================================================

void saveBaselines()
{
    baselinePrefs.putBool(
        "cleanValid",
        cleanBaseline.valid
    );

    baselinePrefs.putFloat(
        "cleanGas",
        cleanBaseline.gas
    );

    baselinePrefs.putFloat(
        "cleanBVOC",
        cleanBaseline.bvoc
    );

    baselinePrefs.putFloat(
        "cleanIAQ",
        cleanBaseline.iaq
    );


    baselinePrefs.putBool(
        "freshValid",
        freshBaseline.valid
    );

    baselinePrefs.putFloat(
        "freshGas",
        freshBaseline.gas
    );

    baselinePrefs.putFloat(
        "freshBVOC",
        freshBaseline.bvoc
    );

    baselinePrefs.putFloat(
        "freshIAQ",
        freshBaseline.iaq
    );
}


void loadBaselines()
{
    baselinePrefs.begin(
        "foodtrack",
        false
    );


    cleanBaseline.valid =
        baselinePrefs.getBool(
            "cleanValid",
            false
        );


    cleanBaseline.gas =
        baselinePrefs.getFloat(
            "cleanGas",
            NAN
        );


    cleanBaseline.bvoc =
        baselinePrefs.getFloat(
            "cleanBVOC",
            NAN
        );


    cleanBaseline.iaq =
        baselinePrefs.getFloat(
            "cleanIAQ",
            NAN
        );


    freshBaseline.valid =
        baselinePrefs.getBool(
            "freshValid",
            false
        );


    freshBaseline.gas =
        baselinePrefs.getFloat(
            "freshGas",
            NAN
        );


    freshBaseline.bvoc =
        baselinePrefs.getFloat(
            "freshBVOC",
            NAN
        );


    freshBaseline.iaq =
        baselinePrefs.getFloat(
            "freshIAQ",
            NAN
        );
}


// ============================================================
// CALIBRATION
// ============================================================

void startCalibration(
    CalibrationMode mode)
{
    calibrationMode = mode;

    calibrationStart =
        millis();

    calGasSum = 0;
    calBvocSum = 0;
    calIaqSum = 0;

    calCount = 0;


    if (mode == CAL_CLEAN)
    {
        Serial.println(
            "# CLEAN-AIR calibration started."
        );

        Serial.println(
            "# Keep sensor away from food, breath, perfume and cleaners for 5 minutes."
        );
    }


    if (mode == CAL_FRESH)
    {
        Serial.println(
            "# FRESH-FOOD calibration started."
        );

        Serial.println(
            "# Keep known-fresh food in normal final sensor geometry for 5 minutes."
        );
    }
}


void updateCalibration(
    float gas,
    float bvoc,
    float iaq,
    float confidence)
{
    if (calibrationMode == CAL_NONE)
        return;


    // Only collect reasonably trustworthy samples.

    if (
        confidence < 60 ||
        isnan(gas) ||
        gas <= 0 ||
        isnan(bvoc) ||
        isnan(iaq)
    )
        return;


    calGasSum += gas;
    calBvocSum += bvoc;
    calIaqSum += iaq;

    calCount++;


    if (
        millis() - calibrationStart <
        CALIBRATION_TIME_MS
    )
        return;


    if (calCount < 30)
    {
        Serial.println(
            "# Calibration did not obtain enough valid samples. Restarting timer."
        );

        calibrationStart =
            millis();

        calGasSum = 0;
        calBvocSum = 0;
        calIaqSum = 0;

        calCount = 0;

        return;
    }


    GasBaseline result;

    result.gas =
        calGasSum /
        calCount;

    result.bvoc =
        calBvocSum /
        calCount;

    result.iaq =
        calIaqSum /
        calCount;

    result.valid = true;


    if (
        calibrationMode ==
        CAL_CLEAN
    )
    {
        cleanBaseline =
            result;

        odorActivityEMA =
            NAN;

        Serial.println(
            "# CLEAN baseline saved."
        );
    }


    if (
        calibrationMode ==
        CAL_FRESH
    )
    {
        freshBaseline =
            result;

        spoilageRiskEMA =
            NAN;

        Serial.println(
            "# FRESH baseline saved."
        );
    }


    saveBaselines();


    Serial.print("# Baseline gas = ");
    Serial.println(result.gas, 1);

    Serial.print("# Baseline bVOC = ");
    Serial.println(result.bvoc, 4);

    Serial.print("# Baseline IAQ = ");
    Serial.println(result.iaq, 2);


    calibrationMode =
        CAL_NONE;
}


// ============================================================
// SERIAL COMMANDS
// ============================================================

void printBaselineStatus()
{
    Serial.println(
        "# ----------------------------"
    );


    Serial.print("# Clean baseline: ");

    if (cleanBaseline.valid)
    {
        Serial.print("YES | gas=");
        Serial.print(cleanBaseline.gas, 1);

        Serial.print(" | bVOC=");
        Serial.print(cleanBaseline.bvoc, 4);

        Serial.print(" | IAQ=");
        Serial.println(cleanBaseline.iaq, 2);
    }
    else
    {
        Serial.println("NO");
    }


    Serial.print("# Fresh baseline: ");

    if (freshBaseline.valid)
    {
        Serial.print("YES | gas=");
        Serial.print(freshBaseline.gas, 1);

        Serial.print(" | bVOC=");
        Serial.print(freshBaseline.bvoc, 4);

        Serial.print(" | IAQ=");
        Serial.println(freshBaseline.iaq, 2);
    }
    else
    {
        Serial.println("NO");
    }


    Serial.println(
        "# C = clean calibration"
    );

    Serial.println(
        "# F = fresh-food calibration"
    );

    Serial.println(
        "# S = show baselines"
    );

    Serial.println(
        "# R = erase baselines"
    );


    Serial.println(
        "# ----------------------------"
    );
}


void handleSerialCommands()
{
    if (!Serial.available())
        return;


    char command =
        toupper(
            Serial.read()
        );


    if (command == 'C')
    {
        startCalibration(
            CAL_CLEAN
        );
    }


    else if (command == 'F')
    {
        startCalibration(
            CAL_FRESH
        );
    }


    else if (command == 'S')
    {
        printBaselineStatus();
    }


    else if (command == 'R')
    {
        cleanBaseline =
            {NAN, NAN, NAN, false};

        freshBaseline =
            {NAN, NAN, NAN, false};

        baselinePrefs.clear();

        odorActivityEMA =
            NAN;

        spoilageRiskEMA =
            NAN;

        Serial.println(
            "# Baselines erased."
        );
    }
}


// ============================================================
// BSEC STATE
// ============================================================

void loadBsecState()
{
    bsecPrefs.begin(
        "bsecstate",
        false
    );


    size_t length =
        bsecPrefs.getBytesLength(
            "state"
        );


    if (
        length ==
        BSEC_MAX_STATE_BLOB_SIZE
    )
    {
        bsecPrefs.getBytes(
            "state",
            bsecState,
            BSEC_MAX_STATE_BLOB_SIZE
        );


        if (
            envSensor.setState(
                bsecState
            )
        )
        {
            Serial.println(
                "# BSEC state restored."
            );

            bsecStateSaved =
                true;
        }
    }
}


void saveBsecState()
{
    if (
        !envSensor.getState(
            bsecState
        )
    )
        return;


    bsecPrefs.putBytes(
        "state",
        bsecState,
        BSEC_MAX_STATE_BLOB_SIZE
    );


    lastBsecStateSave =
        millis();

    bsecStateSaved =
        true;


    Serial.println(
        "# BSEC state saved."
    );
}


void maybeSaveBsecState(
    int accuracy)
{
    if (
        !bsecStateSaved &&
        accuracy >= 3
    )
    {
        saveBsecState();
        return;
    }


    if (
        accuracy >= 2 &&
        millis() -
        lastBsecStateSave >=
        BSEC_STATE_SAVE_INTERVAL_MS
    )
    {
        saveBsecState();
    }
}


// ============================================================
// BSEC STATUS
// ============================================================

void checkBsecStatus()
{
    if (
        envSensor.status <
        BSEC_OK
    )
    {
        Serial.print(
            "# BSEC ERROR: "
        );

        Serial.println(
            envSensor.status
        );

        while (true)
            delay(1000);
    }


    if (
        envSensor.status >
        BSEC_OK
    )
    {
        Serial.print(
            "# BSEC WARNING: "
        );

        Serial.println(
            envSensor.status
        );
    }


    if (
        envSensor.sensor.status <
        BME68X_OK
    )
    {
        Serial.print(
            "# BME688 ERROR: "
        );

        Serial.println(
            envSensor.sensor.status
        );

        while (true)
            delay(1000);
    }
}


// ============================================================
// WIFI
// ============================================================

void startWiFi()
{
    WiFi.mode(
        WIFI_STA
    );

    WiFi.begin(
        WIFI_SSID
    );


    lastWiFiAttempt =
        millis();


    Serial.println(
        "# Starting WiFi..."
    );
}


void maintainWiFi()
{
    if (
        WiFi.status() ==
        WL_CONNECTED
    )
        return;


    if (
        millis() -
        lastWiFiAttempt <
        30000
    )
        return;


    lastWiFiAttempt =
        millis();


    Serial.println(
        "# WiFi reconnect..."
    );


    WiFi.disconnect();

    WiFi.begin(
        WIFI_SSID
    );
}


// ============================================================
// URL ENCODING FOR THINGSPEAK STATUS
// ============================================================

String urlEncode(
    const String& input)
{
    String output;


    char buffer[4];


    for (
        size_t i = 0;
        i < input.length();
        i++
    )
    {
        char c =
            input[i];


        bool safe =
            (
                (c >= 'A' && c <= 'Z') ||
                (c >= 'a' && c <= 'z') ||
                (c >= '0' && c <= '9') ||
                c == '-' ||
                c == '_' ||
                c == '.'
            );


        if (safe)
        {
            output += c;
        }
        else
        {
            snprintf(
                buffer,
                sizeof(buffer),
                "%%%02X",
                (unsigned char)c
            );

            output +=
                buffer;
        }
    }


    return output;
}


// ============================================================
// THINGSPEAK
//
// Field 1 = Temperature °C
// Field 2 = RH %
// Field 3 = Absolute Humidity g/m3
// Field 4 = Air Quality Score 0-100
// Field 5 = Odor Activity 0-100
// Field 6 = Freshness Proxy 0-100
// Field 7 = VOC Response %
// Field 8 = Sensor Confidence 0-100
//
// ThingSpeak STATUS = human-readable category
// ============================================================

void uploadThingSpeak()
{
    if (
        WiFi.status() !=
        WL_CONNECTED
    )
        return;


    if (!haveMeasurement)
        return;


    WiFiClientSecure client;

    client.setInsecure();


    HTTPClient https;

    https.setTimeout(
        1800
    );


    String url =
        "https://api.thingspeak.com/update?api_key=";

    url +=
        THINGSPEAK_WRITE_KEY;


    url += "&field1=";
    url += String(
        latestTemp,
        2
    );


    url += "&field2=";
    url += String(
        latestRH,
        2
    );


    url += "&field3=";
    url += String(
        latestAbsHumidity,
        2
    );


    url += "&field4=";
    url += String(
        latestAirScore,
        1
    );


    url += "&field5=";
    url += String(
        latestOdorActivity,
        1
    );


    url += "&field6=";
    url += String(
        latestFreshness,
        1
    );


    url += "&field7=";
    url += String(
        latestGasResponse,
        1
    );


    url += "&field8=";
    url += String(
        latestConfidence,
        1
    );


    url += "&status=";
    url += urlEncode(
        latestStatus
    );


    if (
        !https.begin(
            client,
            url
        )
    )
    {
        Serial.println(
            "# ThingSpeak init failed"
        );

        return;
    }


    int code =
        https.GET();


    if (code > 0)
    {
        String response =
            https.getString();

        response.trim();


        Serial.print(
            "# ThingSpeak entry: "
        );

        Serial.println(
            response
        );
    }
    else
    {
        Serial.print(
            "# ThingSpeak error: "
        );

        Serial.println(
            code
        );
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
    // EXACT KNOWN-WORKING BSEC OUTPUT PARSER
    // ========================================================

    for (
        uint8_t i = 0;
        i < outputs.nOutputs;
        i++
    )
    {
        const bsecData output =
            outputs.output[i];


        switch (
            output.sensor_id
        )
        {
            case BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_TEMPERATURE:

                tempComp =
                    output.signal;

                break;


            case BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_HUMIDITY:

                humidityComp =
                    output.signal;

                break;


            case BSEC_OUTPUT_IAQ:

                iaq =
                    output.signal;

                iaqAccuracy =
                    output.accuracy;

                break;


            case BSEC_OUTPUT_STATIC_IAQ:

                staticIaq =
                    output.signal;

                break;


            case BSEC_OUTPUT_BREATH_VOC_EQUIVALENT:

                bvocEq =
                    output.signal;

                break;


            case BSEC_OUTPUT_CO2_EQUIVALENT:

                eco2Eq =
                    output.signal;

                break;


            case BSEC_OUTPUT_GAS_PERCENTAGE:

                gasPct =
                    output.signal;

                break;


            case BSEC_OUTPUT_COMPENSATED_GAS:

                gasComp =
                    output.signal;

                break;


            case BSEC_OUTPUT_RAW_GAS:

                gasRaw =
                    output.signal;

                break;


            case BSEC_OUTPUT_STABILIZATION_STATUS:

                stabilization =
                    (int)output.signal;

                break;


            case BSEC_OUTPUT_RUN_IN_STATUS:

                runIn =
                    (int)output.signal;

                break;


            default:
                break;
        }
    }


    // Fallback if BSEC raw gas output wasn't emitted.

    if (
        isnan(gasRaw) ||
        gasRaw <= 0
    )
    {
        gasRaw =
            data.gas_resistance;
    }


    // BSEC2 converts this to hPa before callback.
    float pressureHpa =
        data.pressure;


    bool gasValid =
        (
            data.status &
            BME68X_GASM_VALID_MSK
        ) != 0;


    bool heaterStable =
        (
            data.status &
            BME68X_HEAT_STAB_MSK
        ) != 0;


    float absHum =
        absoluteHumidity(
            tempComp,
            humidityComp
        );


    float dew =
        dewPointC(
            tempComp,
            humidityComp
        );


    float confidence =
        calculateConfidence(
            iaqAccuracy,
            stabilization,
            runIn,
            gasValid,
            heaterStable
        );


    // ========================================================
    // AUTOMATIC FIRST CLEAN-AIR CALIBRATION
    // ========================================================

    if (
        !cleanBaseline.valid &&
        calibrationMode ==
            CAL_NONE &&
        confidence >= 60
    )
    {
        startCalibration(
            CAL_CLEAN
        );
    }


    updateCalibration(
        gasRaw,
        bvocEq,
        iaq,
        confidence
    );


    // ========================================================
    // USER-FACING SCORES
    // ========================================================

    float airScore =
        calculateAirScore(
            iaq
        );


    float odorActivity =
        calculateOdorActivity(
            gasRaw,
            bvocEq
        );


    float gasResponse =
        calculateGasResponse(
            gasRaw
        );


    float freshness =
        calculateFreshness(
            gasRaw,
            bvocEq,
            iaq,
            confidence
        );


    // ========================================================
    // THINGSPEAK VALUES
    // ========================================================

    latestTemp =
        tempComp;

    latestRH =
        humidityComp;

    latestAbsHumidity =
        absHum;

    latestAirScore =
        airScore;

    latestOdorActivity =
        odorActivity;

    latestFreshness =
        freshness;

    latestGasResponse =
        gasResponse;

    latestConfidence =
        confidence;


    latestStatus =
        "AIR=" +
        String(
            airClass(iaq)
        ) +
        " | ODOR=" +
        String(
            odorClass(
                odorActivity
            )
        ) +
        " | FOOD=" +
        String(
            freshnessClass(
                freshness
            )
        ) +
        " | CONF=" +
        String(
            confidenceClass(
                confidence
            )
        );


    haveMeasurement =
        true;


    // ========================================================
    // FULL RESEARCH CSV FOR YOUR FRIEND
    // ========================================================

    uint64_t timestampMs =
        outputs.output[0].time_stamp /
        1000000ULL;


    Serial.print(timestampMs);
    Serial.print(",");

    Serial.print(tempComp, 3);
    Serial.print(",");

    Serial.print(humidityComp, 3);
    Serial.print(",");

    Serial.print(absHum, 3);
    Serial.print(",");

    Serial.print(pressureHpa, 3);
    Serial.print(",");

    Serial.print(gasRaw, 1);
    Serial.print(",");

    Serial.print(bvocEq, 4);
    Serial.print(",");

    Serial.print(iaq, 2);
    Serial.print(",");

    Serial.print(staticIaq, 2);
    Serial.print(",");

    Serial.print(eco2Eq, 2);
    Serial.print(",");

    Serial.print(gasPct, 3);
    Serial.print(",");

    Serial.print(gasComp, 3);
    Serial.print(",");

    Serial.print(iaqAccuracy);
    Serial.print(",");

    Serial.print(stabilization);
    Serial.print(",");

    Serial.print(runIn);
    Serial.print(",");

    Serial.print(
        gasValid ? 1 : 0
    );

    Serial.print(",");

    Serial.print(
        heaterStable ? 1 : 0
    );

    Serial.print(",");

    Serial.print(
        cleanBaseline.valid ?
        cleanBaseline.gas :
        NAN,
        1
    );

    Serial.print(",");

    Serial.print(
        freshBaseline.valid ?
        freshBaseline.gas :
        NAN,
        1
    );

    Serial.print(",");

    Serial.print(
        airScore,
        2
    );

    Serial.print(",");

    Serial.print(
        odorActivity,
        2
    );

    Serial.print(",");

    Serial.print(
        freshness,
        2
    );

    Serial.print(",");

    Serial.print(
        gasResponse,
        2
    );

    Serial.print(",");

    Serial.print(
        confidence,
        2
    );

    Serial.print(",");

    Serial.print(
        airClass(iaq)
    );

    Serial.print(",");

    Serial.print(
        odorClass(
            odorActivity
        )
    );

    Serial.print(",");

    Serial.println(
        freshnessClass(
            freshness
        )
    );


    maybeSaveBsecState(
        iaqAccuracy
    );
}


// ============================================================
// SETUP
// ============================================================

void setup()
{
    Serial.begin(
        115200
    );


    delay(
        1500
    );


    Serial.println();
    Serial.println(
        "# ========================================="
    );

    Serial.println(
        "# BME688 FOOD TRACKER - USER FRIENDLY V1"
    );

    Serial.println(
        "# ========================================="
    );


    loadBaselines();


    Wire.begin();


    if (
        !envSensor.begin(
            BME68X_I2C_ADDR_HIGH,
            Wire
        )
    )
    {
        checkBsecStatus();
    }


    loadBsecState();


    // ========================================================
    // EXACT SENSOR LIST FROM YOUR WORKING LP SKETCH
    // ========================================================

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


    if (
        !envSensor.updateSubscription(
            sensorList,
            ARRAY_LEN(sensorList),
            SAMPLE_RATE
        )
    )
    {
        checkBsecStatus();
    }


    envSensor.attachCallback(
        newDataCallback
    );


    Serial.print(
        "# BSEC version: "
    );

    Serial.print(
        envSensor.version.major
    );

    Serial.print(".");

    Serial.print(
        envSensor.version.minor
    );

    Serial.print(".");

    Serial.print(
        envSensor.version.major_bugfix
    );

    Serial.print(".");

    Serial.println(
        envSensor.version.minor_bugfix
    );


    Serial.println(
        "time_ms,"
        "temp_c,"
        "rh_pct,"
        "abs_humidity_gm3,"
        "pressure_hpa,"
        "gas_raw_ohm,"
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
        "clean_gas_baseline,"
        "fresh_gas_baseline,"
        "air_quality_score,"
        "odor_activity,"
        "freshness_proxy,"
        "voc_response_pct,"
        "sensor_confidence,"
        "air_class,"
        "odor_class,"
        "food_class"
    );


    printBaselineStatus();


    if (
        !cleanBaseline.valid
    )
    {
        Serial.println(
            "# CLEAN baseline missing."
        );

        Serial.println(
            "# Leave sensor in clean room air."
        );

        Serial.println(
            "# Calibration starts automatically once sensor confidence is sufficient."
        );
    }


    if (
        !freshBaseline.valid
    )
    {
        Serial.println(
            "# After clean calibration, place KNOWN-FRESH food near sensor."
        );

        Serial.println(
            "# Then type F to learn the fresh-food reference."
        );
    }


    startWiFi();


    lastUpload =
        millis();
}


// ============================================================
// LOOP
// ============================================================

void loop()
{
    // Bosch processing always gets priority.

    if (
        !envSensor.run()
    )
    {
        checkBsecStatus();
    }


    handleSerialCommands();


    maintainWiFi();


    if (
        haveMeasurement &&
        millis() -
        lastUpload >=
        THINGSPEAK_INTERVAL_MS
    )
    {
        uploadThingSpeak();

        lastUpload =
            millis();
    }
}