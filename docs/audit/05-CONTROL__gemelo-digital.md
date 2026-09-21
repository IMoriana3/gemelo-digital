# Tracker operational-control audit — gemelo-digital

## Audit metadata

| Field | Value |
|---|---|
| TASK_ID | `05-CONTROL__gemelo-digital` |
| TARGET_CHAT | `05_CONTROL` |
| Repository | `gemelo-digital` |
| Audited base branch | `work` |
| Audited base commit SHA | `3b3f420aea5c5cc0f2968e81abc8e494bb68a377` |
| Audit date | `2026-09-21` |
| Audit status | `COMPLETE` |
| Audit mode | `AUDIT_ONLY` during investigation; this report is the sole subsequently authorized repository change |

## 1. Executive findings

1. This repository does **not** contain a complete canonical production tracker controller. Its principal control implementation is a simulated plant and equipment model: NCU, TCUs, HSUs, repeaters, register images, command adapters, actuator dynamics, sensor effects, alarms, and battery behavior.
2. Physical target calculation and operational control are separable:
   - Solar position, true tracking, backtracking, diffuse/overcast optimization, and night behavior are intended to come from SolarGPT through `sim/canon.js` and `POST /tracker`.
   - Wind, snow, cleaning, forced safe positions, battery restrictions, manual/OFF operation, local limits, motor interlocks, and fault recovery are arbitrated locally in `TCU.prototype.decide` and executed by `TCU.prototype.mueve`.
3. When no SolarGPT trajectory is present, the simulator uses browser-side fallback calculation. The UI is intended to expose that fallback. It must not be treated as canonical or silently equated with production behavior.
4. The effective command order is: motor safety interlock orthogonal to targeting; SP1 wind; SP3 snow; SP4 cleaning; generic SP2/5/6/7; battery restriction; manual; OFF/night/auto. Mechanical/software limits clamp the winning target afterward.
5. Default wind policy B2 enters partial stow at `11.111 m/s` (40 km/h), full stow at `16.667 m/s` (60 km/h), captures the side upon entry, and holds stow for 30 minutes after wind falls below the first threshold.
6. The motion loop is directional and stateful rather than a simple symmetric deadband. The default margin is 1.0°, represented in per-direction pulse registers, and low-capacity mode doubles it. Normal tracking advances one margin beyond the live target; protection targets do not overshoot.
7. Battery policy has two overlapping layers: simulated firmware capacity levels at 50/35/25% with +5-point recovery, and an availability strategy with default defense below 30% and recovery at 32%.
8. Emergency stop is modeled as a local TCU normally-closed input. It inhibits the H-bridge without replacing the calculated target and remains latched until alarm clear. The implementation does not apply the NCU digital stop input to plant control.
9. Browser operation generates register images, not Modbus TCP transport. Actual Modbus TCP simulation depends on an external `scada` repository bridge.
10. Material unresolved issues include wind full-to-partial recovery semantics, authoritative low-battery firmware behavior, snow/hail policy, deadband historical values, alarm retry counts, and the authority split between JavaScript mirrors and external Python engines.

The repository explicitly describes the plant as a control test bench rather than a bankable production model. Simulator policy is therefore reported separately below and is not assumed to be production policy.

## 2. Role definitions

- **CANONICAL** — declared source of truth for the behavior.
- **MIRROR** — local implementation or constants intended to follow a canonical source.
- **ADAPTER** — translates canonical results, device state, UI commands, or protocols without being the underlying source of truth.
- **LEGACY** — retained implementation or documentation that no longer represents the intended architecture.

## 3. Complete implementation inventory

| Path | Symbols / sections | Responsibility | Candidate role |
|---|---|---|---|
| `sim/planta.js` | `K`, `PARAMS` | Control, motion, wind, battery, sensor, and firmware-like defaults | MIRROR plus simulator-owned approximations |
| `sim/planta.js` | `TCU`, `TCU.prototype.entradas` | Per-equipment state and NCU/HSU/local input aggregation | ADAPTER / simulated equipment |
| `sim/planta.js` | `TCU.prototype.mide` | Noisy, quantized, filtered inclinometer model | APPROXIMATION |
| `sim/planta.js` | `TCU.prototype.leeSeta`, `limpiaAlarmas` | Emergency-stop debounce, latch, motor cut, and recovery | MIRROR candidate |
| `sim/planta.js` | `TCU.prototype.decide` | Target calculation separation and ordered command arbitration | ADAPTER / simulated policy |
| `sim/planta.js` | `TCU.prototype.mueve` | Directional deadband, motion timing, limits, fault detection, motor energy request | MIRROR plus local physics |
| `sim/planta.js` | `TCU.prototype.energia` | SoC/charge/consumption integration and battery defense state | MIRROR / APPROXIMATION |
| `sim/planta.js` | `TCU.prototype.paso` | Read-decide-act-energy execution order | simulated controller |
| `sim/planta.js` | `NCU`, `HSU`, `Planta` | Plant aggregation, weather devices, grouping, modes, configuration | simulated equipment |
| `sim/planta.js` | `regsNCU`, `regsTCU`, HSU register builders | Equipment register images | ADAPTER / MIRROR |
| `sim/planta.js` | `ESCRITURA`, `Planta.prototype.escribe`, `_escribeNcu` | Mode, safe-position, alarm-clear, jog, limits, deadband, and group command writes | ADAPTER |
| `sim/viento.js` | `Abanderamiento`, `CANON`, `ESTRATEGIAS` | A1/A2/B1/B2 wind-stow state machine and side capture | MIRROR candidate |
| `sim/difusa.js` | `Difusa`, `clampBt` | Browser fallback overcast policies and state machine | MIRROR fallback |
| `sim/canon.js` | `Canon.busca`, `trayectoria`, `en`, `balance` | SolarGPT health/API adapter, sign conversion, interpolation, battery API | ADAPTER |
| `sim/bt.js` | `BT`, `cargaSync`, `aCasa`, `aPvlib` | Loads terrain/backtracking logic from sibling repository | ADAPTER |
| `sim/fisica.js` | `FISICA`, `consumoTCU`, `poaAt`, charge helpers | Hand-maintained physical/constants mirror | MIRROR |
| `sim/cielo.js` | `fraccionDifusaErbs`, `descompon` | Browser-side Erbs decomposition | MIRROR fallback |
| `sim/modbus-map.js` | `MODBUS_MAP`, `MODBUS_BLOQUES` | Generated NCU/TCU/HSU register catalogue | MIRROR schema |
| `sim/servidor.mjs` | HTTP simulation server | Exposes simulation/register state to external bridge | ADAPTER |
| `sim/escenario.js` | `Escenario`, `aplica` | Scripted simulated weather, faults, snow, stop, recovery | simulator-only |
| `sim/prueba.mjs` | smoke and control contract checks | Control, register, fault, energy, wind, and deadband evidence | test evidence |
| `tools/carea_fisica.mjs` | physics comparison harness | Checks selected JS mirror functions against goldens | verification adapter |
| `tools/carea_difusa.mjs` | POA/diffuse comparison harness | Checks Perez POA and decision equivalence | verification adapter |
| `tools/carea_bt.mjs` | backtracking comparison harness | Checks sibling backtracking integration | verification adapter |
| `tools/carea_resultado.mjs`, `.py` | whole-day result comparison | Intended JS/core θ, POA, SoC, and consumption comparison | verification adapter |
| `sim/README.md` | control hierarchy and simulator limitations | Current operational documentation | documentation; some contradictions noted |
| `docs/gemelo-digital-tcu.md` | standalone TCU architecture | Older/proposed architecture and 18% conservation statement | LEGACY candidate |

## 4. Control state model

### 4.1 Position states

The simulator maintains four distinct position concepts:

| Quantity | Path / symbol | Meaning | Units | Role |
|---|---|---|---|---|
| Unprotected target | `TCU.objetivoSolar` | Solar/backtracking target by day, night position at night | degrees | ADAPTER when SolarGPT supplies it; APPROXIMATION in fallback |
| Arbitrated target | `TCU.objetivo` | Winner after protection, overrides, battery, mode, diffuse, and limits | degrees | simulated control ADAPTER |
| Physical position | `TCU.anguloReal` | Position known only to the simulator | degrees | APPROXIMATION |
| Measured position | `TCU.angulo` | Filtered inclinometer signal used by the loop and SCADA | degrees | APPROXIMATION / equipment MIRROR |

`objetivoSolar` is calculated even while another command wins and intentionally remains unclamped. The winning `obj` is clamped afterward to per-TCU east/west limits. This preserves the diagnostic distinction between physical targeting, control policy, limit intervention, and actual execution.

### 4.2 Operating modes

| State | Symbol/value | Trigger | Motion result | Recovery | Role |
|---|---|---|---|---|---|
| OFF | `MODO.OFF = 0` | TCU `40000=1` | Holds measured position and inhibits actuation | TCU or NCU command to MANUAL/AUTO | MIRROR/ADAPTER |
| MANUAL | `MODO.MANUAL = 1` | TCU `40000=2` or NCU group `40071` | Uses manual target; optional jog | AUTO/OFF command | MIRROR/ADAPTER |
| AUTO | `MODO.AUTO = 2` | TCU `40000=3` or NCU group `40070` | Solar, backtracking, diffuse, or night behavior | MANUAL/OFF command | MIRROR/ADAPTER |

The documented map supplies manual jog, not a writable absolute manual target. The web UI can assign the absolute manual target internally; that is an intentional simulator adapter and not production-like Modbus transport.

### 4.3 Wind states

`Abanderamiento` stores state `0` normal, `1` partial, `2` full; a hold timer in seconds; and a captured side. B2 enters partial at T1, full at T2, rearms its timer while wind remains above T1, and releases only after the hold expires below T1. The side is captured only when entering from normal and is retained until complete destow.

### 4.4 Battery states

The firmware-like state `bajaCapacidad` is `0..3`. It enters L1/L2/L3 below 50/35/25% and exits only after the active level threshold plus 5 percentage points is reached. The separate `parked` availability state enters below the configured critical threshold, 30% by default, and exits at threshold plus 2 points.

### 4.5 Fault and interlock states

- `seta`, `alarmaMotorEnclavada`, `motorHabilitado`: local emergency-stop and motor latch.
- `ejeAtascado`: physical simulated jam producing stall current.
- `ejeDuro`: physical simulated drag producing only 20% of requested motion.
- `velocidadBaja`: slow-motion observation.
- `ejeBloqueado`: latched firmware-like diagnosis after retries.
- `sobrecorriente`: latched current trip.
- `fueraRango`: measured angle more than 5° beyond configured limits.
- `sinAlimentacion`: AC-only TCU with failed AC and no battery.

## 5. Command precedence

The ordered target arbitration implemented in `TCU.prototype.decide` is:

| Priority | Rule | Trigger | State / target | Units and defaults | Role |
|---:|---|---|---|---|---|
| Orthogonal interlock | Local stop or latched motor alarm | Debounced stop/cut cable, overcurrent, blocked axis | Target still calculates; H-bridge inhibited | 0.05 s debounce | MIRROR candidate |
| 1 | SP1 wind | Wind state active or SP1 forced | Partial sector or full safe angle | T1 11.111 m/s, T2 16.667 m/s, partial 30°, full 55° | MIRROR candidate |
| 2 | SP3 snow | Global HSU snow alarm or SP3 force | Solar-facing SP3 | 0.03 m trigger; default 55° | simulator policy / APPROXIMATION |
| 3 | SP4 cleaning | NCU group cleaning input or SP4 force | Configured SP4 | default 0° | MIRROR/ADAPTER |
| 4 | SP2/5/6/7 | NCU group or TCU-local force | Configured SP target | defaults 0° | ADAPTER |
| 5 | Battery | Strategy parked/L3/L2 | ±55° defense or freeze | 30/25/35% thresholds | MIRROR/APPROXIMATION |
| 6 | Manual | MANUAL mode | Manual target; jog at normal slew | degrees; 0.17°/s | ADAPTER |
| 7 | OFF/night/auto | Remaining mode/state | Hold, −5° night, or physical target | degrees | ADAPTER |
| Final clamp | Mechanical/software limits | Winning target outside configured range | Clamp and report limit criterion | default ±55° | MIRROR/ADAPTER |

Within a safe-position number, the local TCU force wins over the NCU group force through `this.forzadoLocal || n.forzadoDe(g)`. Safety interlocks are deliberately separate from target arbitration: the target-to-position error remains visible while motor authority is removed.

## 6. Deadband, hysteresis, and motion timing

### 6.1 Directional deadband

- Canonical nominal default: `FISICA.e.HYST_DEG = 1.0°`.
- Encoder scale: `1910 pulses / 55° = 34.727... pulses/degree`.
- West and east margins are separate in `cfgTcu.dbPulsosOeste` and `dbPulsosEste`, registers 41060 and 41061.
- Low-capacity margin `dbPulsosBaja`, register 41063, defaults to twice normal and applies when `bajaCapacidad > 0`.
- The control loop closes on measured `TCU.angulo`, not simulated physical `anguloReal`.

### 6.2 Directional state machine

Normal tracking implements a port of the directional contract attributed to `solargpt_core/direction.py`:

1. Starting from rest requires error at least one active directional margin.
2. The commanded park point is one margin beyond the live target, yielding approximately a two-margin movement between parked edges.
3. Direction is remembered after stopping.
4. Reversal requires the new directional margin plus `3 × sensor RMS`.
5. `arrival` for order change is `max(dead/2, 3×RMS, 2 pulses)`.
6. Physical arrival tolerance is `max(3×RMS, 1 pulse)`.
7. Safe-position and battery-defense commands do not overshoot the requested safety angle but retain an arrival band to prevent noisy final-limit chatter.

### 6.3 Motion timing

- Default actuator slew: `0.17°/s`.
- Requested movement per simulation step is capped by `slew × dt`.
- A 110° traversal takes approximately 647 seconds, or 10.8 minutes, before sensor and deadband effects.
- No explicit actuator acceleration/deceleration curve is modeled.
- Manual jog uses the same slew.
- Winter mode does not change slew or limits.

### 6.4 Wind hysteresis

- B2/A2 hold: 30 minutes.
- The timer is rearmed while wind remains at/above T1.
- Countdown is reported only once wind falls below T1.
- B1/A1 have no hysteresis.
- Current two-threshold code preserves state 2 while wind drops into the T1–T2 band; it does not downgrade to partial before complete destow. External verification is required.

### 6.5 Diffuse hysteresis

Local fallback `poa_switch` uses:

- day threshold `GHI > 50 W/m²`;
- enter threshold flat POA `> 1.02 ×` normal;
- exit threshold flat POA `< 1.00 ×` normal;
- confirmation 30 minutes;
- minimum state duration 90 minutes.

Protection or night resets accumulated diffuse state. When a SolarGPT trajectory is active, the local diffuse state machine is suppressed and the returned engine decision is used.

## 7. Stow, safety, and overrides

### 7.1 Wind

Four selectable strategies exist:

- B2: face solar side; two thresholds, partial sector, hysteresis; default/canonical candidate.
- B1: face solar side; one threshold, full stow, no hysteresis.
- A2: face wind origin; two thresholds, partial sector, hysteresis.
- A1: face wind origin; one threshold, full stow, no hysteresis.

Partial B2/A2 clamps rather than jumps: on the captured side it keeps the physical tracking request within absolute 30°–55°. Full stow commands captured side ×55°. Side capture prevents a 110° crossing if the sun crosses noon during a wind event.

### 7.2 Snow, hail, and overcast

- Snow: any HSU snow level at/above 0.03 m or forced SP3; priority 2; default target ±55° toward the solar side; immediate recovery when cleared. The threshold is simulator-owned.
- Hail: no dedicated trigger, state, target, or register behavior found.
- Overcast: `none`, `flat`, `continuous`, `limited`, and `poa_switch`. It is optimization, not safety, and is disabled by wind, snow, cleaning, forced SP, battery protection, manual, OFF, night, repeaters, or canonical-engine ownership.
- Every diffuse result is clamped so its absolute angle cannot exceed the backtracking angle.

### 7.3 Cleaning and generic safe positions

- Cleaning is per NCU group, uses SP4, defaults to 0°, and sits below snow but above generic positions and battery.
- SP2/5/6/7 are generic NCU/TCU safe-position commands using per-SP configured angles.
- Wind, snow, cleaning, and generic safe positions all supersede manual mode.

### 7.4 Emergency stop and alarm recovery

The executable stop input is `setaLocal || cableSetaCortado`, debounced for 50 ms. Activation latches `alarmaMotorEnclavada`, and motor enable requires both the input and latch to be clear. Releasing the input alone does not recover. `40007 bit 13` clears motor, blocked-axis, overcurrent, low-speed, retry, timer, and peak-current latch state. If the physical stop remains active, the alarm relatches on the next step.

## 8. Battery and low-power rules

| Rule | Trigger | Behavior | Recovery | Role |
|---|---|---|---|---|
| Strategy defense | SoC below `socCrit`, default 30% | Mark unavailable and command current-side ±55° | SoC ≥32% | MIRROR candidate |
| Firmware L1 | SoC <50% | Double directional deadband | SoC ≥55% | MIRROR/APPROXIMATION |
| Firmware L2 | SoC <35% | Freeze current measured angle | SoC ≥40% | MIRROR/APPROXIMATION |
| Firmware L3 | SoC <25% | Command current-side ±55° | SoC ≥30% | MIRROR/APPROXIMATION |
| Cold charge block | Temperature below 0°C unless heated | Block charge | Temperature recovers/heater applies | MIRROR/APPROXIMATION |
| Charge cut-in | POA below 50 W/m² | No solar charge | POA recovers | MIRROR candidate |
| AC-only power loss | AC profile, NCU AC failure, no battery | Stop control/radio/motion; SoC 0 | AC restoration | simulator policy |

Winter mode intentionally changes only charge policy: maximum target SoC from 80% to 90% and full-calibration cadence from five days to three. It does not change target, slew, or limits. Earlier winter angular-rate limiting is documented as removed research/demo behavior.

## 9. Simulated versus production-like behavior

### Production-like candidates

- NCU, TCU, and HSU register images and scaling.
- Per-TCU mode/configuration writes.
- NCU group safe-position masks and AUTO/MANUAL masks.
- TCU local forced SP and alarm clear.
- TCU-local emergency-stop latch.
- Per-TCU east/west limits and directional deadbands.
- HSU threshold writes.
- FC06/FC16 command path when the external Modbus bridge is present.

### Simulator-only or approximation

- Hidden true mechanical angle.
- Sensor noise, drift, mounting error, and filter constants.
- Jam/hard-axis physics and current estimates.
- Weather ramps, turbulence, and snow accumulation.
- Initial randomized SoC and equipment state.
- Browser-only absolute manual target.
- Scenario scripting and direct state injection.
- Browser register generation.
- Constant-speed actuator without acceleration/deceleration.
- Simulator-defined snow threshold.

### Modbus boundary

The browser does not run a Modbus TCP slave. It generates the image of registers. `sim/servidor.mjs` exposes the model over HTTP; the external `scada/tools/ncu_simulada.py --gemelo` component is documented as the actual Modbus TCP slave. Therefore local register behavior is not proof of production transport behavior.

Registers 30113, 30114, and TCU type values use invented simulator enumerations because the referenced source documents name fields without providing enum definitions. They are approximation candidates and must not be assumed to be production contracts.

## 10. Physics embedded in control

### Physics intended to be external

- Solar ephemeris.
- True tracking.
- Terrain-aware backtracking and row coupling.
- Diffuse/overcast optimization.
- Night latch.
- Canonical battery balance.

`sim/canon.js` obtains day trajectories from SolarGPT, converts pvlib positive-east angles into the local opposite convention once, and interpolates by civil time. `sim/bt.js` obtains backtracking from the sibling `cobertura-zigbee` repository. These are adapters, not independent authorities.

### Physics still local

- Browser solar/fallback target.
- Erbs irradiance decomposition.
- Perez POA used to score local diffuse candidates.
- Actuator travel at 0.17°/s.
- Sensor dynamics and noise.
- Motor energy and fault currents.
- Battery state and charge integration.
- Wind ramp/gust and snow effects.

`sim/fisica.js` is a hand-maintained mirror checked against external goldens. Its presence is necessary for offline simulation but must not turn the browser into a second silent canonical engine.

## 11. Candidate role classification

### CANONICAL candidates

No complete canonical controller is present in this repository. Declared external candidates are:

- SolarGPT tracker, direction, wind-stow, TCU, and POA modules.
- `cobertura-zigbee` terrain/backtracking implementation.
- Official NCU R7, TCU v6, and HSU R23 specifications.
- Firmware itself for low-power, interlock, retry, and register semantics.

### MIRROR candidates

- `sim/fisica.js` constants and energy/charge functions.
- `sim/viento.js` wind strategies.
- `sim/difusa.js` fallback DiffuseConfig behavior.
- `sim/cielo.js` Erbs decomposition.
- `TCU.prototype.mueve` directional control contract.
- `sim/modbus-map.js` generated device map.
- TCU battery levels, alarm latch, and configuration behavior, subject to firmware verification.

### ADAPTER candidates

- `sim/canon.js` SolarGPT API and sign conversion.
- `sim/bt.js` sibling repository loader.
- `TCU.prototype.decide` local plant-protection arbitration around the physical target.
- `Planta.prototype.escribe` register-write command adapter.
- Register image builders.
- `sim/servidor.mjs` HTTP interface.
- External SCADA bridge to Modbus TCP.

### LEGACY candidates

- `docs/gemelo-digital-tcu.md` 18% conservation threshold.
- Its proposed `40001` angle-setpoint architecture.
- Its description of integration as only future work.
- Historical winter movement throttling.
- Historical 2.5°/45-pulse deadband descriptions.
- Source-header references suggesting a plant-wide NCU stop.

## 12. Discrepancies

| ID | Discrepancy | Classification | Impact |
|---|---|---|---|
| D-01 | Standalone documentation specifies conservation below 18%, while active simulator defaults are strategy defense 30%, L2 freeze 35%, and L3 defense 25%. | LEGACY | Material battery-control difference. |
| D-02 | Standalone architecture describes NCU 40001 as an angle setpoint, while current simulation uses NCU 40001 as group force SP1 and TCU 40017 as jog. | LEGACY / UNKNOWN | Cannot use the standalone document as current protocol contract. |
| D-03 | Historical deadband values are 2.5°, 45 pulses≈1.296°, and current 1.0°. Runtime now initializes per-direction registers from 1.0° and preserves only the 45:90 doubling ratio. | LEGACY | Mitigated in runtime; historical sources remain inconsistent. |
| D-04 | Web UI can set absolute manual angle internally although no writable absolute-angle register is available. | INTENTIONAL | Not production-like command transport. |
| D-05 | Stop documentation says the NCU stop does not exist/act, but an adjacent comment still says the NC loop includes an NCU stop button. Executable code uses only local stop/cut cable. | BUG | Misleading documentation could reintroduce plant-wide stop behavior. |
| D-06 | Snow threshold is fixed at 0.03 m without canonical/firmware provenance. | APPROXIMATION | Simulator policy must not be assumed in production. |
| D-07 | No hail policy exists. | UNKNOWN | Hail may be omitted, mapped to snow, or delegated to generic SP. |
| D-08 | Internal wind thresholds use m/s while user-facing descriptions use km/h. | INTENTIONAL | Values are numerically consistent. |
| D-09 | Full B2/A2 stow stays full while wind falls into the partial band. | UNKNOWN | Must compare with canonical wind state transition. |
| D-10 | Documentation alternately describes JavaScript wind code and SolarGPT Python as authoritative. | UNKNOWN | Ownership and update direction are ambiguous. |
| D-11 | Browser fallback embeds substantial physical/control logic despite being described as first-order. | INTENTIONAL | Safe only while provenance remains explicit to every consumer. |
| D-12 | Physics comparison harness covers four of seven functions; three are explicitly not checked there. | APPROXIMATION / UNKNOWN | Mirror drift is possible; POA has a separate independent test. |
| D-13 | Register 30113, 30114, and TCU type enum encodings are invented locally. | APPROXIMATION | Must not become production enum contracts. |
| D-14 | Generic motor alarm clear resets stop, overcurrent, blocked-axis, retries, and peak state together. | UNKNOWN | Must confirm exact firmware clear scope and relatching. |
| D-15 | Default retry value is 3, but latch occurs on `++reintentos > 3`, i.e. the fourth failed evaluation. | UNKNOWN | Wording and firmware implementation may differ. |
| D-16 | `planta.js` source header still associates a stop input with the NCU although later implementation rejects plant-wide NCU stop semantics. | LEGACY | Documentation inconsistency. |
| D-17 | Standalone TCU documentation describes a single-HTML/current architecture that predates optional `/tracker` and `/tcubalance` integration. | LEGACY | Architecture document should not be used for current audit decisions. |

## 13. Unresolved UNKNOWN items

1. Whether full wind stow should downgrade to partial in the T1–T2 band.
2. Whether JavaScript or Python is authoritative for wind-stow strategy.
3. Whether hail is intentionally absent, aliases snow, or uses generic safe positioning.
4. Exact firmware battery thresholds, state actions, and recovery widths.
5. Exact interaction of strategy defense at 30% with L2 freeze at 35% and L3 at 25%.
6. Exact blocked-axis retry interpretation and latch window count.
7. Scope of the firmware motor-alarm clear command.
8. Whether emergency stop is local-only for every deployed plant variant.
9. Authoritative nominal east/west deadband values.
10. Whether all low-capacity states use the same enlarged 41063 margin.
11. Production snow threshold and safe angle.
12. Ownership and deployment location of diffuse optimization.
13. Production OFF behavior and state retention.
14. Actual writable manual-angle interface, if any.
15. Production enum definitions for 30113, 30114, and TCU type.
16. Actuator acceleration, braking, and safety-motion timing.
17. AC restoration behavior for AC-only TCUs.

## 14. Tests executed and results

| Command | Result | Details |
|---|---|---|
| `node sim/prueba.mjs \| tail -25` | WARNING — environment limitation | Failed before substantive checks because sibling `/workspace/Cobertura-Zigbee/sol.js` was absent. This confirms the test and runtime dependency on the external backtracking repository. |
| `node tools/carea_fisica.mjs \| tail -30` | PASS | 85 comparisons at tolerance `1e-9`; covered `motorW`, `heaterW`, `etaCharger`, and `consumoTCU`. Reported `cRateSafeLFP`, `hotDerate`, and `poaAt` as uncovered by that harness. |
| `node tools/carea_difusa.mjs \| tail -25` | PASS | 7/7; matched 27 pvlib anchors and independent oracle over 6,930 cases; zero control decisions differed. |
| `git status --short` | PASS | Clean during audit; no investigative changes. |
| `git log -1 --oneline` | PASS | Audited base identified as `3b3f420` / full SHA above. |

Existing `sim/prueba.mjs` evidence was inspected for wind full/partial stow, side capture, destow countdown, all wind strategies, manual priority, local stop and latch recovery, jam/hard-axis behavior, cleaning, group forces, battery critical behavior, mechanical limits, Modbus writes, and directional/asymmetric deadband behavior. It could not be run in this environment because the required sibling repository was not installed.

## 15. External repositories and sources requiring verification

### SolarGPT / SolarGPTfull

Verify:

- `solargpt_core/poa.compute_tracker_poa_v2`
- `solargpt_core/tracker.py`
- `solargpt_core/direction.py`
- `solargpt_core/wind_stow_strategies.py`
- `solargpt_core/tcu.py`
- `tfm_constants.py`
- `run_tcu_sim`
- `SolarGPTfull/server/app.py`
- `/health`, `/tracker`, and `/tcubalance` schemas

Confirm angle signs, night latch, backtracking limits, diffuse state semantics, directional motion, wind transitions, battery thresholds, defaults, and provenance metadata.

### `cobertura-zigbee` / `Cobertura-Zigbee`

Verify `backtracking.html`, `produccion.html`, `sol.js`, terrain layouts, pairwise coupling, terrain-derived per-row targets, and any independent wind implementation. This repository's smoke test cannot execute without that sibling.

### `scada`

Verify `tools/ncu_simulada.py`, `scada/tools/tcu-toolbox`, collectors, FC06/FC16 write behavior, exception behavior, scaling, word order, alarm clear, jog behavior, and whether approximate enum registers are consumed.

### Firmware and official specifications

Verify against NCU Modbus Map R7, SUNNER TCU Modbus Map v6, HSU R23, and deployed firmware: low-power states, deadbands, motor retries, stop latching, alarm clear, safe-position ordering, NCU/TCU force interaction, snow propagation, and enum values.

### Field validation

Obtain El Burgo and Ayora field data, measured motor current/energy curves, and daily per-TCU motor Wh. Repository documentation identifies an open motor-model difference of approximately 14% after aligning actuator speed.

## 16. Questions to escalate to 00_MASTER

1. Which implementation is authoritative for wind policy: `solargpt_core/wind_stow_strategies.py` or `sim/viento.js`?
2. Should full stow downgrade to partial when wind falls below T2 but remains above T1?
3. Are firmware low-capacity thresholds/actions exactly 50/35/25%, +5-point recovery, L1 deadband doubling, L2 freeze, and L3 defense?
4. How should strategy defense at 30% interact with firmware L2 at 35% and L3 at 25%?
5. Is battery defense always ±55° on the current measured side?
6. Is emergency stop local-only on every deployed plant, with NCU 30100.13 unused?
7. Does production latch blocked-axis state after three failed windows or on the fourth observation?
8. What is the authoritative nominal deadband: 1.0°, 45 pulses, or another per-direction value?
9. Are 41060/41061 west/east margins, and is 41063 bidirectional for every low-capacity state?
10. What are the canonical snow trigger and snow-stow angle?
11. Is hail missing, equivalent to snow, or supplied through a generic SP?
12. Does diffuse optimization belong in production TCU/NCU firmware, supervisory SolarGPT, or only simulation?
13. Does OFF hold measured angle, physical position, or the last commanded target in production?
14. Is there a writable absolute manual-angle command outside the audited maps?
15. May external consumers use local encodings for 30113, 30114, and TCU type?
16. Is 0.17°/s the production actuator rate, and are acceleration/braking profiles relevant?
17. Should safety movement bypass only target overshoot or also bypass the arrival band?
18. Does one clear command reset emergency-stop, overcurrent, and blocked-axis latches together?
19. After AC restoration, does an AC-only TCU retain mode/forces and resume automatically?
20. Can canonical-versus-browser provenance be made machine-readable for headless consumers?

## 17. Evidence paths and symbols

- `sim/planta.js`: `K`, `PARAMS`, `MODO`, `SP`, `CRIT`, `FUENTE_SP`, `TCU`, `cfgTcu`, `entradas`, `mide`, `leeSeta`, `limpiaAlarmas`, `decide`, `mueve`, `energia`, `paso`, `Planta`, `canonEn`, `ESCRITURA`, `escribe`, `_escribeNcu`.
- `sim/viento.js`: `CANON`, `ESTRATEGIAS`, `Abanderamiento`, `ladoDe`, `paso`.
- `sim/difusa.js`: `D`, `POLITICAS`, `Difusa`, `reinicia`, `clampBt`, `paso`.
- `sim/canon.js`: `Canon`, `busca`, `trayectoria`, `balance`, `en`, `hayTrayectoria`.
- `sim/bt.js`: `BT`, `cargaSync`, `aCasa`, `aPvlib`.
- `sim/fisica.js`: `FISICA`, `politica`, `difusa`, `perfiles`, `e`, `motorW`, `consumoTCU`, `poaAt`.
- `sim/cielo.js`: `extraterrestre`, `fraccionDifusaErbs`, `descompon`.
- `sim/modbus-map.js`: `MODBUS_MAP`, `MODBUS_BLOQUES`.
- `sim/escenario.js`: `Escenario`, `aplica`.
- `sim/servidor.mjs`: HTTP simulator entry point.
- `sim/prueba.mjs`: smoke/control contract tests.
- `tools/carea_fisica.mjs`, `tools/carea_difusa.mjs`, `tools/carea_bt.mjs`, `tools/carea_resultado.mjs`, `tools/carea_resultado.py`: comparison harnesses.
- `sim/README.md`: control hierarchy, canonical/fallback split, tests, Modbus bridge, and known limitations.
- `docs/gemelo-digital-tcu.md`: legacy/proposed standalone architecture and conservation description.

## 18. Final audit conclusion

The repository's strongest design property is the explicit separation between **where the tracker would point physically** and **whether/how the equipment is allowed or required to execute that target**. The former is intended to be canonical outside this repository; the latter is simulated here with detailed priority, deadband, actuator, sensor, battery, safety, and register behavior.

The control simulator is useful and unusually explicit, but it is not production authority by itself. Before promoting any policy to production, 00_MASTER must reconcile the remaining UNKNOWN items against SolarGPT, terrain/backtracking sources, SCADA transport, official maps, firmware, and field measurements.
