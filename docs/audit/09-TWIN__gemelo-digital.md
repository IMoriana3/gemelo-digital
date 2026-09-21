# Digital Twin Canonicality and Control-Simulation Audit

## Task metadata

| Field | Value |
|---|---|
| TASK_ID | `09-TWIN__gemelo-digital` |
| TARGET_CHAT | `09_TWIN` |
| Repository | `gemelo-digital` |
| Audited base branch | `main` (requested PR base; audit checkout was the clean local branch `work`) |
| Audited base commit SHA | `3b3f420aea5c5cc0f2968e81abc8e494bb68a377` |
| Audit date | `2026-09-21` |
| Audit status | `COMPLETE` |
| Audit mode | `AUDIT_ONLY` |

## Executive findings

The repository is a **hybrid**, but it is materially an **independent physical/control simulator**, not merely a consumer or display mirror of canonical state.

- It is an **ADAPTER** for the preferred SolarGPT trajectory and battery-balance APIs (`sim/canon.js`) and for backtracking, solar position, and measured terrain loaded from `cobertura-zigbee` (`sim/bt.js`).
- It contains a manually maintained **MIRROR** of canonical profiles, constants, motor/charger/heater physics, Perez POA, diffuse-policy behavior, wind policy, and battery defaults (`sim/fisica.js`, `sim/cielo.js`, `sim/difusa.js`, `sim/viento.js`, and `bateria.html`).
- It independently simulates the TCU/NCU/HSU/repeater system: sensors, actuator execution, faults, hierarchy, battery state, health, register images, and selected Modbus writes (`sim/planta.js`). Those are executable local control rules, not animation-only calculations.
- The single-tracker viewer (`index.html`) is an **ADAPTER** for live SCADA values but retains a separate older local solar, backtracking, actuator, and simplified battery simulator. Its local model is best classified **LEGACY**.
- The 3D plant renderer (`sim/campo3d.js`) is principally visual and consumes plant state; the plant engine, rather than Three.js animation, determines simulated equipment behavior.
- The actual Modbus TCP slave is external (`scada/tools/ncu_simulada.py --gemelo`). This repository implements the device-state/register engine and an HTTP bridge, not the complete wire protocol by itself.
- Parity is strong only for a bounded subset: 85 physics comparisons at `1e-9`, plus Perez/POA comparison against 27 pvlib anchors and 6,930 independent-oracle cases. Full control, battery, backtracking, geometry, firmware, and live-SCADA parity is not demonstrated in this checkout.
- The audit checkout was clean at base SHA `3b3f420...`. The principal test suite could not run because the sibling `Cobertura-Zigbee` repository was absent.

The repository's own top-level description is consistent with this conclusion: `README.md` says the viewer consumes SCADA when available but falls back to a local solar/backtracking/wind/battery model, and explicitly says it is a visualization tool rather than a bankable calculation engine (`README.md:5-11`).

## Complete implementation inventory

| Component/domain | Primary files and symbols | Classification | Audit finding |
|---|---|---|---|
| Single-tracker 3D viewer | `index.html`: `pollScada`, `declOf`, `solarShift`, `solarPos`, `trackAngle`, `step` | **LEGACY + ADAPTER** | Polls `/live` and replaces selected measured fields, but otherwise evolves an independent local tracker and battery model. |
| Shared tracker geometry | `seguidor.js`: geometry factory and dimensions block | **CANONICAL within this repository** | Declares itself the single source for tracker dimensions, parts, and materials; reused by the two 3D views. No CAD/DWG numeric golden establishes physical parity. |
| Plant 3D renderer | `sim/campo3d.js`: `Campo3D`, `construye`, `ponPlano`, `ponBifila`, render/update methods | **ADAPTER / visual-only** | Renders `Planta` state and uses physical angle rather than reported angle. Does not own the control hierarchy. |
| Whole-plant engine | `sim/planta.js`: `Planta`, `TCU`, `NCU`, `HSU`, `Meteo` | **Independent physical/control simulator** | Owns equipment state, sensor models, actuator motion, energy integration, faults, health, registers, and commands. |
| Canonical service bridge | `sim/canon.js`: `Canon.busca`, `Canon.trayectoria`, `Canon.balance`, `Canon.en` | **ADAPTER** | Calls SolarGPT `/health`, `/tracker`, and `/tcubalance`; converts the angle sign and interpolates daily samples. |
| External backtracking bridge | `sim/bt.js`: `BT._construye`, `carga`, `cargaSync`, `Tdesde`, `angulos`, `solarPos` | **ADAPTER** | Loads source blocks and terrain constructors directly from `cobertura-zigbee`; avoids a local port for the preferred path. |
| Physics/default bundle | `sim/fisica.js`: `FISICA`, `motorW`, `heaterW`, `etaCharger`, `consumoTCU`, `perezCielo`, `poaAt` | **MIRROR** | Hand-maintained mirror of SolarGPT and battery-page logic. Four of seven declared functions have core goldens. |
| Diffuse policy | `sim/difusa.js`: `Difusa`, `clampBt`, `Difusa.paso` | **MIRROR / APPROXIMATION fallback** | Browser port of SolarGPT diffuse policies; used when a canonical daily trajectory is unavailable. |
| Wind stow | `sim/viento.js`: `Abanderamiento`, `Abanderamiento.paso` | **MIRROR**, with one local equipment extension | Implements A1/A2/B1/B2. Fixing the side when stowed is explicitly outside the declared SolarGPT canon and comes from equipment knowledge. |
| Irradiance decomposition | `sim/cielo.js`: `extraterrestre`, `fraccionDifusaErbs`, `descompon` | **MIRROR** | Local Erbs implementation corresponding to SolarGPT/pvlib's declared method. |
| Battery study | `bateria.html`: `consumoTCU`, `solarPos`, `trackAngleFrom`, `poaAt`, `simulate`, `rainflow`, `calFadeRatePctYr`, `cyclesAnalysis` | **Independent analytical simulator + MIRROR + ADAPTER** | Performs local annual simulation and aging analysis; may call canonical `/tcubalance`, but extensive local physics remains. |
| Modbus schema | `sim/modbus-map.js`: `MODBUS_MAP`, `MODBUS_BLOQUES` | **GENERATED MIRROR / ADAPTER** | Generated from `cobertura-zigbee/modbus.html`; declares NCU R7, TCU v6, HSU R23 and 515 addresses. |
| Modbus register state | `sim/planta.js`: `regsTCU`, `regsHSU`, `regsNCU` | **Independent simulator using mirrored schema** | Encodes locally simulated behavior into register images. Schema parity does not by itself demonstrate behavioral parity. |
| Modbus writes | `sim/planta.js`: `ESCRITURA`, `Planta.escribe`, `_escribeNcu` | **Independent control simulator** | Rejects unknown/RO/out-of-range writes and gives selected registers behavioral effects. Only a subset of firmware behavior is modeled. |
| HTTP bridge | `sim/servidor.mjs` | **ADAPTER** | Runs the same plant engine in Node for external SCADA/Modbus tooling. |
| Repeater | `sim/planta.js`: `TCU` option `repetidor` and branches in `decide`, `mueve`, `energia` | **Independent simulator / APPROXIMATION** | Modeled as a fixed TCU sharing electronics, battery, and firmware assumptions but without tracker or motor. |
| Plant/site inventory | `sim/plantas.js`, `sim/cartera.js` | **GENERATED MIRROR** | Derived from layouts in `cobertura-zigbee` and an export from `factiun-cartera`. |
| Historical architecture document | `docs/gemelo-digital-tcu.md` | **LEGACY** | Refers to obsolete filenames, older thresholds, and a target WebSocket architecture; not reliable as a current implementation description. |

## Local physics inventory and expected authorities

| Local physical calculation | Local implementation | Expected canonical source | Class | Current parity evidence |
|---|---|---|---|---|
| Solar declination, equation of time, civil/solar time, elevation, azimuth | `sim/planta.js`: `declinacion`, `husoDe`, `desfaseSolar`, `posicionSolar`; separately duplicated in `index.html` and `bateria.html` | Prefer `cobertura-zigbee/sol.js` or one named SolarGPT/pvlib implementation | Plant fallback: **APPROXIMATION**; other copies: **LEGACY** | No repository-contained cross-implementation golden. |
| Canonical solar position in external-BT path | `sim/bt.js`: `BT.solarPos` | `cobertura-zigbee/sol.js` | **ADAPTER** | Direct call is structurally strong, but sibling was absent and could not be tested. |
| True tracking | `sim/planta.js`: `angulos`; `index.html`: `trackAngle`; `bateria.html`: `trackAngleFrom` | SolarGPT/pvlib tracker convention | **MIRROR / LEGACY** | No direct local-formula golden found. |
| Flat-ground backtracking | Local single-viewer/battery paths | SolarGPT tracker or `cobertura-zigbee` | **LEGACY / APPROXIMATION** | No current parity evidence. |
| Nine plant/terrain BT policies | `sim/bt.js`: `BT.angulos` | `cobertura-zigbee/backtracking.html`, `sol.js`, `irradiancia.js`, `produccion.html` | **ADAPTER** | Harness exists but could not run without sibling repository. |
| GHI decomposition | `sim/cielo.js`: `descompon` | `solargpt_core.meteo.decompose_ghi` / pvlib Erbs | **MIRROR** | Local behavior tests only; no stored Python golden. |
| Perez transposition and POA scoring | `sim/fisica.js`: `perezCielo`, `poaAt` | SolarGPT POA/Perez functions and pvlib | **MIRROR** | Passed 27 pvlib anchors and 6,930 independent-oracle cases for diffuse scoring. Battery-context counterpart remains unmerged/unproved. |
| Diffuse optimization state machine | `sim/difusa.js`: `Difusa.paso` | `solargpt_core/tracker.py` / `DiffuseConfig` | **MIRROR / fallback** | Local invariants only; no direct Python state-sequence golden. |
| Wind stow | `sim/viento.js`: `Abanderamiento.paso` | `solargpt_core/wind_stow_strategies.py` | **MIRROR** | Local tests for four strategies; no Python-generated golden. |
| Fixed stow side | `sim/viento.js` | Real equipment behavior / `cobertura-zigbee/terreno.html` | **CANONICAL local equipment rule** | Regression coverage, but no field parity proof. |
| HSU wind ramp/gust/snow | `sim/planta.js`: `Meteo.paso`, `HSU.paso` | HSU firmware and field telemetry | **APPROXIMATION** | No field golden. |
| Thermal lag and PCB heat rise | `sim/planta.js`: `TCU.energia` | BatteryModel/physical measurements | **APPROXIMATION** | No parity evidence. |
| Inclinometer error, offset, drift, noise, quantization/filtering | `sim/planta.js`: `TCU.mide` | SUNNER firmware and hardware calibration | **Independent simulator / APPROXIMATION** | Local tests only; no captured TCU trace. |
| Actuator slew/deadband | `sim/planta.js`: `TCU.mueve`, `cfgTcu` register-backed parameters | `tracker.py` defaults and SUNNER firmware | **MIRROR + independent equipment model** | Full loop harness blocked by missing `control_core.js`. |
| Motor power/energy | `sim/fisica.js`: `motorW`, `consumoTCU` | `tcu.py`, `tcu_compare.py`, measured motor campaign | **MIRROR** | Included in 85 passing core comparisons at `1e-9`. |
| Stall/hard-axis physics and alarms | `sim/planta.js`: `TCU.mueve`, `TCU.paso` | Firmware plus measured actuator behavior | **Independent simulator** | Local behavioral tests only. |
| Battery voltage/OCV | `sim/planta.js`: `TCU.energia`; simplified separately in `index.html` | SolarGPT BatteryModel v2 / cell data | Plant: **APPROXIMATION**; viewer: **LEGACY** | No direct parity. |
| C-rate and hot JEITA admission | `sim/fisica.js`: `cRateSafeLFP`, `hotDerate`; consumers in plant/battery page | `tcu_availability`/BatteryModel and hardware specification | **MIRROR, unguarded** | No Python goldens; local point tests only. |
| Heater draw | `sim/fisica.js`: `heaterW` | `tcu_compare.py` | **MIRROR** | Golden-covered. |
| Charger efficiency | `sim/fisica.js`: `etaCharger` | `tcu_compare.py::_eta_charger`, PS26002 curve | **MIRROR** | Golden-covered. |
| SOC integration and charge ceiling | `sim/planta.js`: `TCU.energia`; `bateria.html`: `simulate` | SolarGPT `run_tcu_sim` / BatteryModel v2 | **Independent simulator + MIRROR** | Partial local testing; preferred API delegates, local fallback lacks integrated golden. |
| Rainflow, Palmgren-Miner, Arrhenius calendar aging | `bateria.html`: `rainflow`, `calFadeRatePctYr`, `cyclesAnalysis` | BatteryModel v2 and study notebooks | **MIRROR / independent analytical simulator** | No canonical output golden. |
| Snow charging derate | `sim/planta.js`: `TCU.energia` (`poaChg *= 0.05`) | Field/availability model | **APPROXIMATION** | No parity evidence. |
| SP/String/AC energy-source behavior | `sim/planta.js`: `TCU.energia` | `tcu.py` profiles and canonical TCU balance | **MIRROR + APPROXIMATION** | Profile data mirrored; full local transfer behavior not golden-tested. |
| Repeater energy | `sim/planta.js`: flat plane branch in `TCU.energia` | Repeater hardware configuration | **APPROXIMATION** | No hardware/field parity evidence. |

## Local control inventory

| Control calculation/rule | Primary symbol | Classification | Expected authority and evidence |
|---|---|---|---|
| Priority hierarchy: stop, wind/SP1, snow/SP3, cleaning/SP4, generic SPs, battery, manual, auto | `TCU.decide` | **Independent simulator / MIRROR** | Expected authority is TCU/NCU firmware and operating specification. Local scenarios only. |
| Emergency stop debounce, normally-closed semantics, latch/reset | `TCU.leeSeta`, `TCU.limpiaAlarmas`, `TCU.mueve` | **Independent simulator** | Expected authority is TCU firmware/electrical drawing. Local tests only. |
| Wind partial/full stow and destow hysteresis | `Abanderamiento.paso`, `TCU.decide` | **MIRROR** | Expected authority is SolarGPT wind strategy plus EPC defaults. No direct golden. |
| Canonical trajectory selection/night behavior | `Planta.canonEn`, `TCU.decide` | **ADAPTER when connected; fallback otherwise** | SolarGPT `/tracker`; local fallback is not fully proven. |
| Diffuse optimization and protection precedence | `Difusa.paso`, `TCU.decide` | **MIRROR / fallback** | Expected authority is `tracker.py`. Local invariant tests. |
| Critical-SOC defense and +2% rearm | `TCU.energia`, `TCU.decide` | **MIRROR** | Expected authority is canonical battery strategy. No integrated Python time-series golden. |
| Summer/winter charge policy | `Planta.aplicaPolitica`, `FISICA.politica` | **MIRROR** | Expected authority is `tcu.py::policy_for_mode`; constants locally asserted, source revision not pinned. |
| AUTO/MANUAL/OFF and jog | `Planta.escribe`, `TCU.decide` | **Independent control simulator** | Expected authority is TCU firmware/map. Local tests only. |
| NCU group SP forcing | `_escribeNcu`, `NCU.forzadoDe` | **Independent control simulator** | Expected authority is NCU R7 firmware. Local register tests only. |
| NCU AUTO/MANUAL group bitmaps | `_escribeNcu` | **Independent control simulator** | Expected authority is NCU R7 firmware. |
| HSU threshold writes | `Planta.escribe` HSU branch | **Independent simulator** | Expected authority is HSU R23; three thresholds modeled. |
| Direction-specific and low-capacity deadbands | `TCU.mueve`, registers 41060/41061/41063 | **Independent simulator / MIRROR** | Expected authority is SUNNER firmware. Full parity harness unavailable. |
| Overcurrent, retry and blocked-axis inference | `TCU.mueve`, `TCU.paso` | **Independent simulator** | Expected authority is SUNNER firmware. No trace golden. |
| Health classification | `TCU.salud`, `TCU.systemOk`, `HSU.salud` | **MIRROR** | Expected authority is SCADA criteria. No external SCADA golden. |
| Register encoding | `regsTCU`, `regsHSU`, `regsNCU` | **Independent simulator** | Expected authority is firmware behavior and map documents. Map provenance is stronger than value parity. |
| Write validation and effects | `ESCRITURA`, `Planta.escribe`, `_escribeNcu` | **Independent simulator** | Subset semantics only; no full firmware conformance suite. |

## JavaScript mirrors and canonical-source map

| JavaScript area | Expected source | Candidate class | Status |
|---|---|---|---|
| `sim/fisica.js` profiles/defaults/policies | `SolarGPTfull/solargpt/solargpt_core/tcu.py` | **MIRROR** | Python explicitly declared authoritative. |
| `motorW`, heater, charger efficiency, `consumoTCU` | `tcu.py`, `tcu_compare.py` | **MIRROR** | Golden-covered. |
| `cRateSafeLFP`, `hotDerate` | Unmerged `tcu_availability` / BatteryModel logic | **MIRROR** | Unguarded. |
| `poaAt` / Perez | SolarGPT POA functions and pvlib | **MIRROR** | Strong external-reference evidence for diffuse scoring; incomplete battery authority. |
| `sim/cielo.js` | SolarGPT meteo decomposition / pvlib Erbs | **MIRROR** | Formula present, no Python fixtures. |
| `sim/difusa.js` | `solargpt_core/tracker.py` | **MIRROR / APPROXIMATION** | Explicit browser fallback. |
| `sim/viento.js` | `wind_stow_strategies.py` | **MIRROR** | Has an intentional equipment extension. |
| `bateria.html` | `run_tcu_sim`, BatteryModel v2, notebooks | **MIRROR + independent simulator** | Scope greatly exceeds guarded physics subset. |
| `index.html` local model | Modern SolarGPT and `sim/*` modules | **LEGACY** | Separate, older implementation. |
| `sim/modbus-map.js` | `cobertura-zigbee/modbus.html` and controlled map documents | **GENERATED MIRROR** | No source commit embedded. |
| `sim/planta.js` equipment behavior | Firmware, SCADA rules, hardware tests | **Independent simulator** | Not merely a register mirror. |
| `sim/bt.js` | `cobertura-zigbee` source | **ADAPTER** | Loads the source instead of porting it. |
| `sim/canon.js` | `SolarGPTfull/server/app.py` | **ADAPTER** | Preferred canonical path. |

## Live, simulated, and visual-only state

### Live

- `index.html` polls `GET {SCADA_URL}/live`, defaulting to `http://localhost:8000`, filters by NCU/TCU, and maps fields including angle, target, SOC, battery voltage, and state into shared viewer state (`index.html:198-261`).
- This is polling, not the WebSocket architecture described in the historical design document.
- Only mapped measured fields become live; the page's local engine still supplies other scene and simulation values. A field-by-field authority contract is absent.

### Simulated

`sim/planta.js` locally simulates TCU, NCU, HSU, repeaters, meteo, sensor error, physical and measured angle, actuator execution, faults, battery/thermal state, offline timestamps, health, register images, writes, and deterministic scenarios. Its `TCU.paso` sequence reads inputs, decides, moves, integrates energy, evaluates alarms, and publishes contact state (`sim/planta.js:1296-1325`).

### Visual-only

- Three.js meshes, transforms, sky color, sun light, cloud/weather appearance, shadows, wind arrow, cable rails, labels, and cameras are visual-only.
- Render shadows do not feed the POA or backtracking model.
- Top-level documentation explicitly says the single viewer's accumulated snow is visual and does not penalize PV production (`README.md:52-55`).
- `sim/campo3d.js` is cleanly downstream of plant state. `index.html` is less cleanly separated because its animation loop also evolves locally simulated angle and SOC.

### Modbus boundary

- `sim/planta.js` creates register state and processes writes but does not itself implement Modbus TCP.
- `sim/servidor.mjs` exposes the engine over HTTP.
- The wire-protocol slave is described as `scada/tools/ncu_simulada.py --gemelo`, outside this repository.

## Parity evidence

### Demonstrated

1. `node tools/carea_fisica.mjs`
   - Passed 85 comparisons at tolerance `1e-9`.
   - Covered `motorW`, `heaterW`, `etaCharger`, and `consumoTCU`.
   - `sim/fisica.js:14-23` and `sim/goldens-fisica.json` explicitly record the incomplete 4/7 coverage.

2. `node tools/carea_difusa.mjs`
   - Passed 27 pvlib anchors.
   - Passed 6,930 independent-oracle conditions.
   - Zero differing diffuse-policy decisions.
   - Maximum numerical difference was floating-point noise.

3. `sim/modbus-map.js`
   - Clearly declares generation from NCU R7, TCU v6 and HSU R23 source material and reports 515 addresses (`sim/modbus-map.js:1-8`).

4. Direct adapters
   - `sim/canon.js` calls canonical trajectory/balance APIs instead of reimplementing them on the preferred path.
   - `sim/bt.js` loads sibling physics and terrain constructors instead of retaining another preferred BT implementation.

### Partial or unavailable

- `sim/prueba.mjs` contains broad regression coverage for register encoding, wind strategies, hysteresis, emergency stop, inclinometer behavior, forcing, repeater behavior, profiles, charge policies, canonical/local selection, interpolation, and deterministic scenarios. It did not execute because the external BT sibling was absent.
- `tools/carea_bt.mjs` and `tools/carea_lazo.mjs` exist but could not run without `cobertura-zigbee` and `js/control_core.js`.
- Browser-level battery and simulator tests require Playwright and/or the sibling repository.

### Not demonstrated

- Exact SolarGPT source revision parity.
- Exact `cobertura-zigbee` revision parity.
- Firmware-trace parity for TCU/NCU/HSU behavior.
- Full battery time-series parity.
- Geometry/CAD parity.
- Local solar-position fallback parity.
- End-to-end Modbus TCP parity within this repository alone.
- Live-SCADA fixture parity.

## Discrepancies

| ID | Finding | Classification | Consequence |
|---|---|---|---|
| D-01 | Documentation says canonical tracking/battery logic is called, while broad local fallback and annual simulations remain. | **UNKNOWN** | Users may mistake local outputs for canonical results without per-result provenance. |
| D-02 | `README.md` says physics coverage is “3 of 6”; the implementation, golden metadata, and harness say **4 of 7**. | **BUG** | Stale audit/coverage statement. |
| D-03 | `docs/gemelo-digital-tcu.md` describes obsolete filenames, old behavior, and target rather than current architecture. | **LEGACY** | Misleading implementation reference. |
| D-04 | `index.html` retains separate local solar, BT, actuator, and battery formulas. | **LEGACY** | A second behavioral twin can diverge from the plant simulator. |
| D-05 | `sim/difusa.js` locally ports canonical policies for offline operation. | **INTENTIONAL / APPROXIMATION** | Acceptable only when visibly identified as fallback; direct parity is not proven. |
| D-06 | Wind stow fixes the side once stowed, although this is absent from declared SolarGPT canon. | **INTENTIONAL** | Equipment rule must be distinguished from canonical algorithm policy. |
| D-07 | `cRateSafeLFP`, `hotDerate`, and battery-context `poaAt` lack Python goldens. | **UNKNOWN** | Battery output can drift while the partial suite remains green. |
| D-08 | Thermal lag, PCB rise, snow derate, noise, gust, and failure-response parameters are local assumptions. | **APPROXIMATION** | Material effect on alarms, consumption, and SOC without field validation. |
| D-09 | Main plant angle calculation refuses to proceed without external BT; repository-alone smoke tests fail. | **INTENTIONAL** | Enforces one BT source but sacrifices standalone reproducibility. |
| D-10 | Modbus map is generated, but behavioral values/writes are local. | **UNKNOWN** | Address parity is not firmware-behavior parity. |
| D-11 | Only selected writable registers have modeled effects. | **APPROXIMATION** | A successful write can still diverge from real firmware behavior. |
| D-12 | Generated/mirrored artifacts lack immutable source SHA declarations. | **BUG** | Successful tests cannot identify the precise canonical revision. |
| D-13 | `/health` `pipeline_version` is descriptive but no SHA/schema compatibility is required or persisted. | **UNKNOWN** | Runtime canonical compatibility is not enforced. |
| D-14 | Single-viewer battery voltage is a linear 24–27 V simplification. | **LEGACY / APPROXIMATION** | Not numerically comparable to BatteryModel v2. |
| D-15 | Actual Modbus TCP slave is external. | **INTENTIONAL** | This repository alone cannot prove wire-level parity. |
| D-16 | `sim/goldens-fisica.json` lacks generator SHA, source SHA, generation timestamp, schema, and dependency versions. | **BUG** | Golden lineage is not reproducible enough for strict audit. |
| D-17 | “Canonical” is used for Python authority, local single source, generated sibling data, EPC default, and field-derived equipment rule. | **UNKNOWN** | Ownership and classification are ambiguous. |

## Unresolved UNKNOWN items

1. Whether `/tracker` or `cobertura-zigbee` is the final authority for tracking/backtracking and how their domains divide.
2. Whether all local diffuse state sequences are behaviorally equal to the current Python implementation.
3. Whether local wind state sequences equal the current Python implementation apart from the intentional fixed-side extension.
4. Whether unguarded battery curves match the intended BatteryModel or unmerged `tcu_availability` branch.
5. Whether TCU sensor filtering, debounce, latch, deadband, retry, and fault inference match shipping firmware.
6. Whether NCU/HSU aggregation and command behavior match R7/R23 firmware.
7. Whether SCADA health colors and stale/offline logic exactly match the external SCADA implementation.
8. Whether Modbus register values, word order, scales, timestamps, and write effects match real captures across all scenarios.
9. Whether geometry dimensions and coordinate transforms agree with controlled CAD/DWG sources.
10. Whether repeater electrical behavior truly matches a TCU minus tracker/motor.
11. Whether local thermal and snow assumptions are calibrated or purely illustrative.
12. Whether the annual aging model is intended as authoritative twin behavior or only a study tool.
13. Whether runtime results may be labeled “SolarGPT” without immutable model provenance.
14. Whether mixed live/local state in `index.html` is an intended mode or an architectural residue.

## Missing golden tests

1. Solar position across all three local implementations versus the selected canonical implementation, including DST, leap day, midnight, low sun, and longitude extremes.
2. True tracking, flat BT, and all nine terrain policies, including slope, drive groups, edge rows, and sign conversion.
3. Step-by-step diffuse-policy state-machine parity with variable time steps and protection precedence.
4. A1/A2/B1/B2 wind state-sequence parity, with the fixed-side extension tested separately.
5. Full battery time-series parity for SOC, energy, temperature, heater, calibration, and nonavailability across all profiles and climates.
6. Canonical goldens for `cRateSafeLFP`, `hotDerate`, and battery-context `poaAt`.
7. TCU loop parity for quantization, filtering, offsets, directional deadbands, stop latch, stall, hard axis, retry, and overcurrent.
8. NCU/HSU golden scenarios for aggregation, digital inputs, group commands, communications, snow, wind, and gusts.
9. Complete register snapshots and read-after-write/exception tests.
10. Wire-level FC03/04/06/16 tests through the external SCADA Modbus slave.
11. Recorded `/live` adapter fixtures for missing fields, duplicates, staleness, and offline state.
12. Numeric geometry/transform goldens against CAD/DWG and generated layouts.
13. Required API schema/version compatibility tests.
14. Legacy-viewer equivalence for a defined reduced domain, or explicit deprecation tests.
15. Machine-readable provenance assertions for every generated/mirrored artifact.

## External repositories and controlled sources requiring verification

### `SolarGPTfull` — mandatory

Verify:

- `solargpt/solargpt_core/tcu.py`
- `solargpt/solargpt_core/tcu_compare.py`
- `solargpt/solargpt_core/tracker.py`
- `solargpt/solargpt_core/wind_stow_strategies.py`
- `solargpt/solargpt_core/meteo.py`
- `solargpt/solargpt_core/poa.py`
- BatteryModel v2 and `run_tcu_sim`
- `solargpt/scripts/genera_goldens_fisica.py`
- `server/app.py`, `/health`, `/tracker`, and `/tcubalance` schemas

### `cobertura-zigbee` / `Cobertura-Zigbee` — mandatory

Verify:

- `sol.js`
- `irradiancia.js`
- `backtracking.html`
- `produccion.html`
- `js/control_core.js`
- measured `*_cotas.json`
- generated `*_layout.json`
- `modbus.html`
- `terreno.html`

The name/case convention must also be reconciled: runtime/test output expected `/workspace/Cobertura-Zigbee`, while documentation commonly says `cobertura-zigbee`.

### `scada` — mandatory for live and Modbus claims

Verify the `/live` contract, health/staleness rules, `tools/ncu_simulada.py --gemelo`, polling/exception/timestamp behavior, and write routing to `sim/servidor.mjs`.

### `factiun-cartera` — required for plant provenance

Verify the source CSV schema, project coordinates, generator procedure, and immutable version of the 2026-09-09 export.

### Firmware/map controlled sources — mandatory

Verify NCU Modbus Map R7, SUNNER TCU Modbus Map v6/FW v1.4.3, HSU Modbus Map R23, firmware behavior or field captures, emergency-stop wiring, motor/current campaign data, and inclinometer calibration records.

### Panel/proyectos repository — secondary

Verify only deployment metadata and panel integration; it is not the physics/control authority.

## Candidate mirror contract

### Required labels

Each exported computation should declare exactly one implementation class:

- `CANONICAL`: authoritative implementation for a defined domain.
- `MIRROR`: port with named canonical source and golden parity.
- `ADAPTER`: calls/loads canonical implementation without recreating it.
- `LEGACY`: compatibility/demo implementation excluded from parity claims.

Each known difference should declare one discrepancy class:

- `INTENTIONAL`
- `APPROXIMATION`
- `LEGACY`
- `BUG`
- `UNKNOWN`

### Proposed ownership

| Domain | Proposed authority | Twin obligation |
|---|---|---|
| Solar position | One explicitly chosen SolarGPT or `cobertura-zigbee/sol.js` implementation | Adapter; offline approximation visibly labeled. |
| Tracking/backtracking | SolarGPT `/tracker` or `cobertura-zigbee`, with an explicit boundary | Execute setpoints; no unlabeled duplicate preferred implementation. |
| Diffuse policy | SolarGPT tracker | Adapter; versioned/golden fallback only. |
| Wind strategy | SolarGPT wind strategy | Golden mirror; equipment fixed-side rule documented separately. |
| Tracker geometry | Named controlled CAD/layout source | Render controlled dimensions/transforms. |
| TCU consumption | SolarGPT TCU model | Mirror allowed with complete goldens. |
| Battery model | SolarGPT `/tcubalance` | Adapter; local simulator labeled approximation until complete parity. |
| TCU/NCU/HSU behavior | Firmware specification/captures | Separately versioned independent simulator contract. |
| Modbus map | Controlled R7/v6/R23 documents | Generated mirror. |
| Modbus transport | `scada` | Adapter. |
| Live state | SCADA API | Adapter only. |
| Animation | This repository | Visual-only and prohibited from silently feeding authoritative calculations. |

### Required provenance

Each mirror/generated artifact should record canonical repository, canonical commit, module/document, schema/model version, generator commit, mirror commit, golden suite, case count, tolerance, covered functions, and explicit exclusions.

Each runtime result should record:

```json
{
  "source": "canonical-api | canonical-sibling | local-mirror | local-approximation | live-scada",
  "model_version": "...",
  "source_commit": "...",
  "schema_version": "...",
  "fallback_reason": null,
  "parameters_overridden": {},
  "timestamp_generated": "..."
}
```

Fallback from canonical to local must never be silent. Parameter overrides must change the result classification to a local variant. Canonical incompatibility must be distinguished from service absence. A mirror should be called parity-proven only when source and generator commits are pinned, public behavior is covered or exclusions are machine-readable, integrated scenarios are compared, conventions are included, and CI checks all required sibling repositories.

## Questions to escalate to 00_MASTER

1. Is the authoritative tracker SolarGPT `/tracker` or the nine-policy implementation in `cobertura-zigbee`, and what is the precise boundary?
2. Is the desired product a canonical mirror or a firmware/equipment simulator? If both, must they be separate versioned layers?
3. Who owns truth for stop wiring, sensor filtering, retries, Modbus writes, NCU aggregation, and SCADA health?
4. Are thermal constants, noise, wind/gust ramps, stall inference, snow derate, and string behavior validated assumptions?
5. Should the independent simulator embedded in `index.html` be deprecated?
6. May output be labeled “SolarGPT” without source SHA and compatible schema?
7. Should a missing/incompatible canonical dependency fail closed, or permit a visibly downgraded fallback?
8. What immutable revisions correspond to NCU R7, TCU map v6/FW v1.4.3, HSU R23, diffuse schema 2.1.0, BatteryModel v2, and the SolarGPT pipeline?
9. Is the fixed-side wind-stow extension approved as canonical equipment behavior?
10. Is battery aging authoritative twin physics or an analytical study feature?
11. What Modbus conformance level is required: encoding only, subset behavior, or full commissioning substitute?
12. When SCADA is live, which local calculations must stop rather than coexist with live fields?
13. Where is canonical geometry owned: CAD/DWG, `seguidor.js`, layouts, or some combination with a versioned generation chain?
14. Should external repositories be pinned as submodules, vendored fixtures, or checked out by CI?
15. May the stale historical architecture document be retired or rewritten to prevent it being treated as evidence?

## Tests and checks executed

| Command | Result |
|---|---|
| `find .. -name AGENTS.md -print` | **PASS** — no applicable `AGENTS.md` found. |
| `rg --files -g '!node_modules/**' \| sort` | **PASS** — repository inventory collected. |
| `rg -n -i -g '!node_modules/**' 'solar\|sun\|azimuth\|elevation\|tracker\|tracking\|backtrack\|tcu\|ncu\|hsu\|repeater\|modbus\|battery\|bater[ií]a\|scada\|websocket\|mqtt\|animation\|canonical\|version\|python\|formula\|angle\|angulo\|control' .` | **PASS** — audit search completed. |
| `node tools/carea_fisica.mjs` | **PASS** — 85 comparisons at `1e-9`; 4/7 functions covered. |
| `node tools/carea_difusa.mjs` | **PASS** — 27 pvlib anchors and 6,930 oracle cases passed. |
| `node sim/prueba.mjs` | **ENVIRONMENT BLOCKED** — missing `/workspace/Cobertura-Zigbee/sol.js`; no test assertion ran. |
| `node tools/carea_bt.mjs` | **ENVIRONMENT BLOCKED** — `cobertura-zigbee` sibling absent. |
| `node tools/carea_lazo.mjs` | **ENVIRONMENT BLOCKED** — external `js/control_core.js` absent. |
| `node tools/prueba_bateria.mjs` | **ENVIRONMENT BLOCKED** — Playwright not installed. |
| `node tools/prueba_simulador.mjs` | **ENVIRONMENT BLOCKED** — external backtracking sibling absent. |
| `git status --short --branch` before persistence | **PASS** — clean audit base on local `work`. |

## Evidence index

- `README.md:5-18` — declared live/local modes, plant simulator, canonical service, mirrors, Modbus integration, and battery-study scope.
- `README.md:52-56` — visual snow limitation and repository provenance.
- `index.html:198-261` — SCADA polling and record mapping.
- `index.html:283-305`, `458-569` — local solar, tracking, wind, actuator, and simplified battery calculations.
- `seguidor.js:1-20` — local single-source geometry declaration and axis convention.
- `sim/canon.js:2-28` — declared algorithm/equipment boundary and sign convention.
- `sim/canon.js:35-117` — health, trajectory, and balance adapters.
- `sim/canon.js:120-164` — local interpolation of canonical daily series.
- `sim/bt.js:82-124` — direct loading/evaluation of sibling physics blocks.
- `sim/bt.js:127-186` — measured terrain, drive grouping, and sibling-owned geometry construction.
- `sim/bt.js:189-244` — sibling loading, angles, and solar adapter.
- `sim/fisica.js:1-37` — declared authorities and incomplete golden coverage.
- `sim/fisica.js:53-129` — duplicated profiles, policies, and defaults.
- `sim/fisica.js:138-166` — motor data and charge-efficiency mirror.
- `sim/fisica.js:168-227` — Perez/POA mirror and documented prior discrepancy.
- `sim/fisica.js:229-264` — consumption functions and exports.
- `sim/goldens-fisica.json` — generated core fixtures and explicit 4/7 coverage metadata.
- `sim/cielo.js` — Erbs decomposition mirror.
- `sim/difusa.js` — diffuse-policy mirror/fallback.
- `sim/viento.js` — four wind strategies and local fixed-side rule.
- `sim/planta.js:35-140` — provenance, canonical defaults, and local simulator parameters.
- `sim/planta.js:331-426` — local random, solar, angle, and AOI helpers.
- `sim/planta.js:451-503` — HSU simulation.
- `sim/planta.js:541-754` — TCU/repeater, sensor, and emergency-stop simulation.
- `sim/planta.js:764-930` — embedded control hierarchy and movement decision.
- `sim/planta.js:1175-1294` — sky/POA, energy source, battery integration, and defense state.
- `sim/planta.js:1296-1367` — execution order, alarms, and health.
- `sim/planta.js:1378-1466` — NCU and meteorology simulation.
- `sim/planta.js:1474-1649` — canonical trajectory adapter, plant construction, and stepping.
- `sim/planta.js:1666-1956` — TCU/HSU/NCU register images.
- `sim/planta.js:2026-2203` — Modbus write catalog, validation, and effects.
- `sim/modbus-map.js:1-8` — generated map provenance and counts.
- `sim/campo3d.js` — visual rendering downstream from the plant engine.
- `sim/servidor.mjs` — HTTP bridge for the headless plant engine.
- `sim/prueba.mjs` — broad local smoke/regression suite and intended parity assertions.
- `bateria.html:275-875` — local physical defaults, battery simulation, rainflow, and aging calculations.
- `docs/gemelo-digital-tcu.md` — historical/legacy architecture evidence.

## Final determination

`gemelo-digital` should be governed as a **versioned independent equipment simulator with canonical adapters and partially verified mirrors**, not as a pure presentation-layer mirror. Canonical trajectory/backtracking integrations reduce duplication on the preferred path, but substantial physical and control behavior remains local and materially determines outputs. Until the unresolved external, firmware, battery, geometry, and provenance checks are closed, output must identify whether it came from live SCADA, a canonical service, dynamically loaded canonical sibling code, a guarded mirror, or a local approximation.
