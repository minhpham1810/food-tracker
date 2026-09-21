# Hardware — Freshness Tracker sensor node

BME688 environmental/gas sensor on an ESP32-S3 Feather, battery powered,
publishing to ThingSpeak once a minute. The backend polls ThingSpeak; the node
never talks to the API directly.

```
hardware/
  sketch.cpp                 firmware
  STL_files/                 enclosure
  README.md                  this file
```

## Bill of materials

| Part | Notes |
|---|---|
| Adafruit ESP32-S3 Feather | 4 MB flash / 2 MB PSRAM, STEMMA QT, LiPo charger |
| Adafruit BME688 breakout | STEMMA QT, I²C address 0x77 |
| STEMMA QT / Qwiic cable | 50 mm or 100 mm |
| LiPo battery, 2500 mAh | JST-PH 2.0, with protection circuit |
| USB-C cable | power, flashing, serial console |

No level shifting, voltage dividers, or external regulators. The BME688 is a
3.3 V I²C device on the same rail as the MCU, so the whole node is two boards
and one cable.

## Wiring

STEMMA QT cable from the Feather to the BME688 — that is the entire assembly.
The cable carries 3.3 V, GND, SDA and SCL, so there is nothing to wire by hand
and no way to get the polarity wrong.

For a breadboard build without the cable:

| Feather | BME688 |
|---|---|
| 3V | VIN |
| GND | GND |
| SCL | SCK |
| SDA | SDI |

The BME688's gas heater draws up to ~12 mA in bursts. The Feather's 3.3 V
regulator handles this without decoupling beyond what is already on both
boards.

## Build and flash

Arduino IDE 2.x, ESP32 board support installed.

1. Board: **Adafruit Feather ESP32-S3 2MB PSRAM**
2. Libraries via Library Manager:
   - **BSEC2 Software Library** (Bosch) — pulls in BME68x Sensor Library
3. Edit the three credential lines at the top of `sketch.ino`:
   `WIFI_SSID`, `WIFI_PASS`, `TS_WRITE_KEY`
4. Upload

Serial console at **115200 baud**, line ending **Newline**.

If the board is asleep and will not take an upload: hold **BOOT**, tap
**RESET**, release BOOT. That enters the ROM bootloader and is always
flashable.

> The WiFi SSID and ThingSpeak write key are literals in the sketch. Anyone
> with the write key can push data into the channel, so regenerate it on
> ThingSpeak if the file has ever been pushed to a public repository.

## Power

One sample and one upload per minute. Between cycles the radio is shut down and
the CPU enters light sleep.

| Configuration | Average current | Life on 2500 mAh |
|---|---|---|
| Continuous sampling, radio associated | 75.9 mA | 28 hours |
| 60 s cycle, radio off + light sleep | **7.1 mA** | **12.5 days** |

**10.7×**, at an unchanged 1-minute data rate.

### Where the energy goes

| State | Current | Per 60 s cycle | Share |
|---|---|---|---|
| Radio: associate, POST, disconnect | 110 mA | 3 s | **78%** |
| Wake and sample | 25 mA | 2 s | 12% |
| Light sleep, radio off | 0.8 mA | 55 s | 10% |

The radio dominates, so association time is the lever that matters:

| WiFi connect | Average | Life |
|---|---|---|
| 1.2 s (cached AP) | 3.79 mA | 23.4 days |
| 3.0 s (assumed) | 7.07 mA | 12.5 days |
| 8.0 s (full scan) | 16.17 mA | 5.5 days |

A 4× spread from one variable. The firmware therefore caches the AP's BSSID and
channel and reconnects with `WiFi.begin(ssid, pass, channel, bssid)`, skipping
the channel scan. A failed cached connect drops the cache and retries with a
full scan, so a moved AP costs one cycle rather than the deployment.

### Light sleep, not deep sleep

Deep sleep is the obvious choice and it is the wrong one here.

| | Average | Life |
|---|---|---|
| Deep sleep (0.15 mA) | 6.47 mA | 13.7 days |
| Light sleep (0.8 mA) | 7.07 mA | 12.5 days |

**9% apart.** Sleep is only ~10% of the budget at this cadence, so a 5× lower
sleep floor barely moves the total.

Against that 9%, deep sleep costs the sensor algorithm entirely. Deep sleep
resets `millis()` on every wake; BSEC rejects a timestamp that moves backwards;
and the installed BSEC2 wrapper exposes only `run(void)`, with no way to supply
an external timebase. Deep sleep would mean discarding BSEC's calibration on
every cycle, leaving `iaq_accuracy`, `stabilized` and `run_in` permanently
zero — so `flags` could never reach 63 and the backend would reject every
reading.

Light sleep gates the CPU and radio but preserves RAM, peripherals and the
`millis()` timebase, so BSEC runs across cycles exactly as on a bench.

### Other measures

- CPU at 80 MHz (roughly halves current while awake; the radio raises it
  itself when transmitting)
- The sense rail's polarity is probed rather than assumed — on this board,
  driving `PIN_I2C_POWER` high feeds a regulator enable pin with a 10 kΩ
  pulldown, worth ~330 µA
- Sleep duration is reduced by the cycle's own duration, holding the period at
  60 s rather than 60 s plus however long the cycle took

### What is measured and what is modeled

**The duty cycle is measured on-device.** The firmware accumulates real awake,
sleep and radio milliseconds and reports them. That is the part of the estimate
that was genuinely uncertain, and it is now observed rather than assumed.

**The per-state currents are datasheet and reference figures**, not bench
measurements of this board. This node has no fuel gauge and no shunt, so it
cannot measure its own current draw. Multiplying measured time by assumed
current gives an estimate, and the firmware labels it as one.

`P` on the serial console:

```
# --- power ---
# mode FIELD  elapsed 19.42 h  samples 1165  uploads 1151/1165
# measured duty cycle: awake 8.44%  radio 4.97%  sleep 91.56%
# mean radio time 2.95 s per cycle
# estimated average 7.012 mA
# estimated life from full 12.4 days on 2500 mAh
# duty cycle is measured; per-state currents are datasheet values
# -------------
```

`mean radio time` is the most useful single diagnostic: at ~78% of the budget
it predicts battery life better than anything else on the board, and it is a
real measurement.

To turn the estimate into a measurement, either put an ammeter in series with
the battery and compare against the reported duty cycle, or run the node to
cutoff and divide capacity by elapsed hours.

### Optional battery voltage

There is no fuel gauge on this board, so no battery state is reported by
default. If an ADC pin is wired across a divider on the pack, uncomment
`BATTERY_ADC_PIN` and `BATTERY_DIVIDER` near the top of the sketch. The pin
must be ADC1-capable (GPIO1–GPIO10 on the ESP32-S3); ADC2 stops working while
WiFi is active.

With that enabled, pack voltage appears in the serial log and in `P`. It is not
published to ThingSpeak — the field map is fixed by the backend contract. A
voltage curve logged over a few hours is the cheapest real evidence of the
power behaviour available without extra instruments.

## ThingSpeak

| Field | Name | Unit |
|---|---|---|
| 1 | `temp_c` | °C, heat-compensated |
| 2 | `rh_pct` | % |
| 3 | `abs_humidity_gm3` | g/m³ |
| 4 | `gas_raw_ohm` | Ω |
| 5 | `bvoc_eq_ppm` | ppm |
| 6 | `iaq` | 0–500, Bosch scale |
| 7 | `flags` | bitmask, 0–63 |
| 8 | `uptime_s` | s, seconds since boot |

Light sleep leaves `millis()` monotonic across cycles, so field 8 counts real
elapsed time. A drop between consecutive entries means the node reset — and
that the BSEC baseline restarted with it, so the gas trace is discontinuous at
that point.

Entries are stamped by ThingSpeak on arrival; with an upload every cycle,
arrival is within seconds of measurement, so the node carries no clock.

Set field 7's chart type to **step**, dynamic scaling off, min 0 max 63 —
interpolating a bitmask draws meaningless intermediate values.

NaN fields are omitted rather than sent as the string `"nan"`, which ThingSpeak
rejects. Omitted fields read back empty: missing, not zero.

### Quality flags

| bit | meaning |
|---|---|
| 0 | `gas_valid` |
| 1 | `heater_stable` |
| 2 | `stabilized` |
| 3 | `run_in` |
| 4–5 | `iaq_accuracy`, 0–3 |

**Gas resistance is usable only where `flags == 63`.** Bits 0 and 1 are
hardware-level and matter most: a reading taken before the heater reached
temperature is not a measurement of anything.

```python
f = df["field7"].fillna(0).astype(int)
df["gas_valid"]     = (f >> 0) & 1
df["heater_stable"] = (f >> 1) & 1
df["stabilized"]    = (f >> 2) & 1
df["run_in"]        = (f >> 3) & 1
df["iaq_accuracy"]  = (f >> 4) & 3
df["gas_usable"]    = f.eq(63)
```

### Why absolute humidity is published

MOS gas sensors respond to the number of water molecules present, not to
relative saturation. RH 80% is ~5.2 g/m³ at 4 °C but ~13.8 g/m³ at 20 °C — a
factor of 2.7. A fridge is cold, so absolute humidity stays low even at high
RH, and a gas baseline fitted against RH would systematically misrepresent the
sensor's environment.

Absolute humidity is also less collinear with temperature than RH is, which
matters for the backend's `ln R ~ T + AH + T·AH` fit. Centre T and AH before
forming the interaction term, or it stays collinear with the main effects.

## Serial interface

Output mirrors the ThingSpeak payload, so the device has one data model rather
than two that can drift apart.

```
sample,uptime_s,temp_c,rh_pct,abs_humidity_gm3,gas_raw_ohm,bvoc_eq_ppm,iaq,flags,avg_ma,batt_v
```

The eight ThingSpeak fields plus two diagnostics that stay on the console:
`avg_ma` (the node's estimated average current) and `batt_v` (blank unless the
optional divider below is wired). Lines beginning `#` are metadata.

| cmd | action |
|---|---|
| `S` | status |
| `P` | power report |
| `B` | reset duty-cycle accounting |
| `M LAB` / `M FIELD` | switch mode; LAB stays awake on USB for bench work |

Holding **BOOT** through a reset forces LAB for that boot.

## Enclosure

`STL_files/` holds the printable enclosure.

Suggested print settings:

| | |
|---|---|
| Material | PLA or PETG |
| Layer height | 0.2 mm |
| Infill | 20% |
| Supports | none if printed in the orientation as exported |

Two constraints drove the design and matter if it is reprinted:

**The gas port must be open to the fridge air.** The BME688 measures gas
resistance in its own headspace. Sealing it behind solid plastic means it
measures the inside of the box, not the fridge.

**Condensate must not reach the sensor.** A cold board meeting warm humid air
when the door opens will condense water on it, and liquid water on the MOX
element ruins readings and can damage the sensor. The sensor opening faces
downward or sideways so condensate runs off rather than pooling on the element.

The enclosure is not food-contact and should not be treated as such — FDM
prints have layer gaps that cannot be cleaned reliably.

## Sensor calibration and burn-in

**The BME688 requires roughly 24 hours of continuous powered burn-in before gas
resistance readings are stable.** This is a property of the MOX element, not
the firmware, and there is no way to shorten it. Readings before burn-in drift
steadily and should not be used as a baseline.

BSEC's own calibration is separate and slower again: `iaq_accuracy` only
reaches 3 after the algorithm has seen enough environmental variation. A fridge
is chemically flat, so this takes considerably longer inside one than on a
desk. Leaving the node in normal room air for several hours before deploying it
gets it further along. BSEC state is written to NVS roughly hourly and restored
on boot, so this progress survives a reflash or a battery swap.

At a 60 s cadence BSEC's LP filters see fewer samples than they assume, so
`iaq` and `iaq_accuracy` converge more slowly than they would on a bench.
Timestamps stay correct — that is what light sleep buys — so calibration does
progress, just sparsely. Temperature, humidity and raw gas resistance are
direct sensor reads and are unaffected, as are the two hardware flags.

## Per-device normalisation

MOX sensors vary substantially unit to unit: two BME688s in identical air read
different absolute resistances. Any baseline, threshold, or trained model is
per-device until shown otherwise. `DEVICE_ID` in the sketch identifies the
unit; set it uniquely on every board, and do not pool data across units without
first checking that their raw resistance ranges overlap.

## Known limitations

- **Battery figures are estimates.** The duty cycle is measured; the per-state
  currents are datasheet values. No fuel gauge or shunt is fitted, so the node
  cannot measure its own current draw, and no discharge test has been run to
  completion.
- **Cold reduces usable capacity.** These numbers assume room temperature. At
  4 °C the cell's voltage curve shifts down and a fixed cutoff is reached
  earlier. At this discharge rate — roughly C/350 — the effect is on the order
  of 5–10%, far less than the 20–30% quoted for high-rate discharge, but not
  zero.
- **A failed upload drops that sample.** At a 1-minute cadence a single missed
  point does not justify the buffering machinery it would cost.
- **The upload blocks inside the cycle.** A FreeRTOS task on the second core
  would be the correct fix.
- **`setInsecure()`** gives encryption without certificate verification.
- **One sensor, one fridge.** The node measures the fridge's headspace, not any
  individual item. With several foods present, Track B sees their sum.
- **Light sleep can disturb USB CDC enumeration.** The console is for bench
  use; in the deployed configuration the node is on battery.

## Scope

This is a waste-reduction aid, not a food-safety device. It measures
temperature exposure and gas response; it does not detect pathogens, and no
reading from it should be treated as a safety clearance.