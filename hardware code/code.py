import time
import math
import board
import adafruit_bme680

# ============================================================
# BME688 SETUP
# ============================================================

# STEMMA QT uses the Feather's default I2C bus
i2c = board.STEMMA_I2C()

# BME688 default I2C address is normally 0x77
bme = adafruit_bme680.Adafruit_BME680_I2C(i2c, address=0x77)

# Change later using local sea-level pressure
bme.sea_level_pressure = 1013.25


# ============================================================
# EXTRA CALCULATIONS
# ============================================================

def dew_point(temp_c, humidity):
    """Approximate dew point using Magnus formula."""
    a = 17.62
    b = 243.12

    gamma = math.log(humidity / 100.0) + (
        a * temp_c / (b + temp_c)
    )

    return (b * gamma) / (a - gamma)


# ============================================================
# MAIN LOOP
# ============================================================

print("\nBME688 Environmental Sensor Test")
print("--------------------------------")

while True:

    temperature = bme.temperature
    humidity = bme.relative_humidity
    pressure = bme.pressure
    gas = bme.gas
    altitude = bme.altitude

    dp = dew_point(temperature, humidity)

    print(f"Temperature : {temperature:7.2f} °C")
    print(f"Humidity    : {humidity:7.2f} %RH")
    print(f"Pressure    : {pressure:7.2f} hPa")
    print(f"Gas Resist. : {gas:7.0f} Ω")
    print(f"Dew Point   : {dp:7.2f} °C")
    print(f"Altitude    : {altitude:7.2f} m")
    print("--------------------------------")

    time.sleep(2)