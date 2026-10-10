# SENTINEL Mobile 2.0 — results

Every number below comes from the reproducible benchmark in `bench/` (dataset and protocol: `docs/V2_AUDIT.md` §3; licences: `bench/ATTRIBUTION.md`).
**Headless Chrome uses software rendering (SwiftShader) and runs WASM single-threaded with no COOP/COEP, same as GitHub Pages. Treat latencies as relative only.** The image set is small (82 images, 70 foliage frames), so ±1 image moves recall by 5–6 points.
"Tuned" thresholds were picked on this same set: the best F1 per category, with a cap of ≤3 % of foliage frames firing. That is an optimistic estimate. A real field test with the Field tab is the next step.

## Before / after (headline)

| Metric | v1.0 (COCO-SSD lite, global 0.5) | v2.0 default (EfficientDet-Lite0, per-category thr + 3-of-5 confirmation) |
|---|---|---|
| Person precision / recall | 100 % / 59 % | 100 % / **94 %** |
| Animal precision / recall | 100 % / 65 % | 87 % / **100 %** |
| Vehicle precision / recall | 100 % / 88 % | 100 % / **94 %** |
| Overall F1 (image level) | 82 % | **95 %** |
| Recall, hard subset (small / low light) | 36 % | **93 %** |
| Detector raw FP/min, wind-blown foliage | 0.0 | 3.2 (single frames, mostly 'bird'/'person' on branches) |
| Detector **confirmed** FP/min, foliage (persistence) | 0.00 | **0.00** |
| Motion false alerts, 10 negative sequences (133 s) | 7 (3.2 /min) | **0 (0.0 /min)** |
| Motion intruder sequences detected | 1 / 3 * | 2 / 3 |
| Audio watch FP, wind/rain (98 s) | 8 (4.9 /min) | **1 (0.6 /min)** |
| Audio positives detected | 6 / 7 | 6 / 7 |
| Detector latency p50 / p95, bench | 357 / 483 ms | **97 / 131 ms** |
| Detector latency p50 / p95, live app (fake camera, with YAMNet running) | ≈ 378 ms (v1 results.json) | 98–103 / 157–160 ms |
| Detections per second, live app | ≈ 2.6 | ≈ 4.0–4.4 |

\* v1 fired constantly on that sequence (it also fired at t = 0.1 s, before the intruder appeared).

## STEP 1 — detector comparison

| Config | Backend | Thresholds | Person P/R | Animal P/R | Vehicle P/R | Overall F1 | Hard-subset recall | Raw FP/min (foliage) | Confirmed FP/min | p50 / p95 ms | pre / infer / post ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| coco-lite@320 | webgl | all 0.5 | 91% / 59% | 100% / 65% | 100% / 75% | 79% | 36% | 0.0 | 0.00 | 371 / 420 | 0 / 14 / 356 |
| coco-lite@320 | webgl | 0.3/0.2/0.3 | 88% / 82% | 95% / 90% | 100% / 81% | 89% | 64% | 1.6 | 0.00 | 371 / 420 | 0 / 14 / 356 |
| coco-mnv2@320 | webgl | all 0.5 | 93% / 76% | 100% / 55% | 100% / 69% | 79% | 43% | 0.0 | 0.00 | 952 / 1064 | 0 / 14 / 937 |
| coco-mnv2@320 | webgl | 0.35/0.25/0.25 | 88% / 88% | 89% / 80% | 93% / 81% | 86% | 71% | 0.0 | 0.00 | 952 / 1064 | 0 / 14 / 937 |
| effdet0@320 | mediapipe-gpu | all 0.5 | 100% / 94% | 100% / 70% | 100% / 88% | 91% | 79% | 1.6 | 0.00 | 675 / 745 | 0 / 675 / 0 |
| effdet0@320 | mediapipe-gpu | 0.45/0.25/0.45 | 100% / 94% | 87% / 100% | 100% / 94% | 95% | 93% | 3.2 | 0.00 | 675 / 745 | 0 / 675 / 0 |
| effdet0@320-cpu | mediapipe-cpu | all 0.5 | 100% / 94% | 100% / 70% | 100% / 88% | 91% | 79% | 1.6 | 0.00 | 97 / 131 | 0 / 97 / 0 |
| effdet0@320-cpu | mediapipe-cpu | 0.45/0.25/0.45 | 100% / 94% | 87% / 100% | 100% / 94% | 95% | 93% | 3.2 | 0.00 | 97 / 131 | 0 / 97 / 0 |
| effdet0@320-cpu+enh | mediapipe-cpu | all 0.5 | 100% / 88% | 100% / 65% | 100% / 88% | 88% | 64% | 1.6 | 0.00 | 113 / 129 | 4 / 108 / 0 |
| effdet0@320-cpu+enh | mediapipe-cpu | 0.45/0.25/0.5 | 100% / 88% | 87% / 100% | 100% / 88% | 93% | 79% | 1.6 | 0.00 | 113 / 129 | 4 / 108 / 0 |
| effdet2@448 | mediapipe-gpu | all 0.5 | 89% / 100% | 89% / 80% | 100% / 94% | 91% | 79% | 34.1 | 3.43 | 1734 / 1905 | 0 / 1734 / 0 |
| effdet2@448 | mediapipe-gpu | 0.6/0.25/0.7 | 100% / 100% | 80% / 100% | 100% / 69% | 91% | 93% | 3.2 | 1.71 | 1734 / 1905 | 0 / 1734 / 0 |
| effdet2@448-cpu | mediapipe-cpu | all 0.5 | 89% / 100% | 94% / 80% | 100% / 94% | 92% | 79% | 32.4 | 3.43 | 264 / 318 | 0 / 264 / 0 |
| effdet2@448-cpu | mediapipe-cpu | 0.6/0.25/0.75 | 100% / 100% | 83% / 100% | 100% / 63% | 90% | 93% | 1.6 | 0.00 | 264 / 318 | 0 / 264 / 0 |
| v1-coco-lite | webgl | all 0.5 | 100% / 59% | 100% / 65% | 100% / 88% | 82% | 36% | 0.0 | 0.00 | 357 / 483 | 0 / 357 / 0 |
| v1-coco-mnv2 | webgl | all 0.5 | 92% / 65% | 100% / 50% | 100% / 81% | 77% | 29% | 3.2 | 1.71 | 916 / 1033 | 0 / 916 / 0 |
| yolo11n@320 | ort-wasm | all 0.5 | 100% / 88% | 100% / 70% | 100% / 69% | 86% | 79% | 3.2 | 0.00 | 114 / 132 | 5 / 107 / 0 |
| yolo11n@320 | ort-wasm | 0.35/0.2/0.5 | 94% / 94% | 95% / 95% | 100% / 69% | 91% | 86% | 4.9 | 0.00 | 114 / 132 | 5 / 107 / 0 |
| yolo11n@416 | ort-wasm | all 0.5 | 94% / 100% | 100% / 65% | 100% / 75% | 88% | 71% | 21.1 | 3.43 | 148 / 201 | 6 / 141 / 1 |
| yolo11n@416 | ort-wasm | 0.35/0.2/0.65 | 94% / 100% | 90% / 95% | 100% / 63% | 90% | 93% | 1.6 | 0.00 | 148 / 201 | 6 / 141 / 1 |
| yolo11n@416+enh | ort-wasm | all 0.5 | 100% / 100% | 100% / 65% | 100% / 81% | 90% | 79% | 9.7 | 1.71 | 154 / 205 | 7 / 144 / 1 |
| yolo11n@416+enh | ort-wasm | 0.45/0.25/0.6 | 100% / 100% | 95% / 90% | 100% / 75% | 93% | 86% | 3.2 | 1.71 | 154 / 205 | 7 / 144 / 1 |
| yolo11n@640 | ort-wasm | all 0.5 | 89% / 100% | 93% / 65% | 100% / 88% | 88% | 86% | 35.7 | 3.43 | 350 / 486 | 11 / 337 / 1 |
| yolo11n@640 | ort-wasm | 0.6/0.2/0.8 | 94% / 100% | 91% / 100% | 100% / 50% | 89% | 93% | 8.1 | 1.71 | 350 / 486 | 11 / 337 / 1 |
| yolov8n@320 | ort-wasm | all 0.5 | 100% / 100% | 100% / 50% | 100% / 75% | 85% | 71% | 9.7 | 1.71 | 114 / 148 | 6 / 108 / 0 |
| yolov8n@320 | ort-wasm | 0.4/0.2/0.6 | 100% / 100% | 94% / 85% | 100% / 69% | 91% | 79% | 3.2 | 1.71 | 114 / 148 | 6 / 108 / 0 |
| yolov8n@416 | ort-wasm | all 0.5 | 100% / 100% | 100% / 60% | 100% / 81% | 88% | 71% | 21.1 | 3.43 | 178 / 238 | 7 / 170 / 1 |
| yolov8n@416 | ort-wasm | 0.5/0.2/0.6 | 100% / 100% | 94% / 85% | 100% / 75% | 92% | 79% | 3.2 | 0.00 | 178 / 238 | 7 / 170 / 1 |
| yolov8n@640 | ort-wasm | all 0.5 | 85% / 100% | 79% / 55% | 93% / 81% | 81% | 71% | 29.2 | 3.43 | 415 / 538 | 11 / 401 / 1 |
| yolov8n@640 | ort-wasm | 0.65/0.2/0.7 | 100% / 100% | 83% / 95% | 100% / 63% | 89% | 86% | 1.6 | 0.00 | 415 / 538 | 11 / 401 / 1 |

**Chosen: EfficientDet-Lite0 (float16, MediaPipe Tasks Vision 0.10.21, CPU/XNNPACK delegate) at 320 px.**
* It had the best overall F1 (95 % tuned, 91 % at 0.5) and the best hard-subset recall (93 %, tied) of all candidates. It was also the fastest at 97 ms p50.
* YOLO11n @416 came close (F1 90–93 %, 148 ms) but raised raw foliage FPs at 0.5 (21/min). YOLOv8n was similar. Both are AGPL-3.0, so with comparable accuracy the permissive **Apache-2.0** EfficientDet won, as the brief preferred. YOLO11n/YOLOv8n stay as options (the repo is public, so AGPL is acceptable; see `models/yolo/LICENSE-NOTE.md`).
* EfficientDet-Lite2 (448) had higher person recall but **10× more foliage FPs at 0.5** and 2.7× the latency, so it is an option, not the default.
* MediaPipe's GPU (WebGL) delegate was 7× slower than CPU in headless. The CPU delegate is the default; it is also the predictable choice on iOS.
* **COCO-SSD is kept as the "lite" fallback** (it is used automatically if the main model fails to load). It is now decoded from the raw graph outputs, with letterboxing and our own class-aware NMS. That alone raises its F1 from 82 % to 89 % at tuned thresholds. Its p50 is dominated by GPU→CPU readback under SwiftShader.
* Letterboxing: implemented for all backends (grey 114 padding, exact inverse mapping, checked by the harness's padded-image test, IoU 0.67).
* Input size: 320/416/640 for YOLO and 300/320/416 for COCO-SSD; EfficientDet is fixed by the model (320 / 448). **Adaptive mode** steps the size down when p50 > 1.3× the budget (180 ms normal / 400 ms low-power) or on latency drift, and back up when p50 < 0.45× the budget.
* NMS: greedy **class-aware** NMS with a configurable IoU (default 0.5). Suppressed boxes are reported to Diagnostics as `nms suppressed`.
* **Low-light enhancement** (auto gamma + 1–99 % contrast stretch when mean luma < 0.38) made things **worse** for EfficientDet (F1 95 → 93 %, hard recall 93 → 79 %). It helped YOLO11n slightly (90 → 93 %). → **off by default**, available as a toggle.

## STEP 2 — temporal confirmation

ByteTrack-style two-stage association: high-score detections (≥ category threshold) are matched first (IoU ≥ 0.3), then low-score ones (≥ 0.5 × threshold, IoU ≥ 0.2). Matching uses a box predicted by an alpha-beta constant-velocity filter. Low-score matches keep a track alive but **do not count toward confirmation**. Matching stays within a category group, and the label is a score-weighted vote (dog ↔ horse flicker does not split a track).
Defaults (Settings › Confirmation): person 0.45, 3 of 5 · animal 0.25, 3 of 6 · vehicle 0.45, 3 of 5 · other 0.55, 4 of 6.
Layers: RAW (dashed, dimmed, labelled with a rejection reason) → CONFIRMED tracks (solid, with ID) → EVENTS (confirmed **and** foot-point inside the ROI / outside exclusion zones). Reasons shown in Diagnostics: `below class threshold`, `class filtered`, `pending persistence`, `outside roi`, `in exclusion zone`, `nms suppressed`.
Effect on foliage FPs: the 1.6–3.2 raw FP/min turn into **0.00 confirmed FP/min** for EfficientDet. Unit tests cover isolated flicker (never confirms), a 4-frame occlusion (same ID kept), and low-score continuation.

## STEP 3 — motion

| Sequence | Type | v1 alerts | v1 false/min | v1 detected | v2 alerts | v2 false/min | v2 detected (delay s) | v2 ms/frame (Node) |
|---|---|---|---|---|---|---|---|---|
| synth_sway | negative | 0 | 0.0 | — | 0 | 0.0 | — | 3.35 |
| synth_sway_strong | negative | 2 | 8.6 | — | 0 | 0.0 | — | 3.39 |
| synth_sunflicker | negative | 2 | 8.6 | — | 0 | 0.0 | — | 3.21 |
| synth_light | negative | 0 | 0.0 | — | 0 | 0.0 | — | 2.49 |
| synth_shadow | negative | 0 | 0.0 | — | 0 | 0.0 | — | 2.38 |
| synth_shake | negative | 2 | 8.6 | — | 0 | 0.0 | — | 2.42 |
| synth_sway_light_shake | negative | 0 | 0.0 | — | 0 | 0.0 | — | 3.19 |
| pos_intruder_sway | positive | 2 | 4.3 | yes | 0 | 0.0 | NO | 2.57 |
| pos_intruder_shake_light | positive | 0 | 0.0 | NO | 1 | 0.0 | yes (1) | 2.44 |
| foliage_wind_1 | negative | 0 | 0.0 | — | 0 | 0.0 | — | 2.47 |
| foliage_wind_2 | negative | 1 | 4.3 | — | 0 | 0.0 | — | 2.87 |
| foliage_wind_3 | negative | 0 | 0.0 | — | 0 | 0.0 | — | 2.36 |
| pos_intruder_realfoliage | positive | 0 | 0.0 | NO | 1 | 0.0 | yes (0.3) | 2.46 |
Motion negatives: 133 s; v1 7 false alerts (3.2/min), v2 0 (0.0/min). Positives detected: v1 1/3, v2 2/3.

The engine (160×120) does five things:
* Block-matching global shift (±6 px, SAD on the gradient image), which aligns the background model.
* Global gain compensation.
* A per-pixel running mean/variance background (MOG-lite). Pixels count as foreground only if **both** the intensity and the gradient structure change. Shadows and light ramps rarely change edges.
* 3×3 majority filtering and connected components.
* Blob tracking that needs ≥ 4 frames of persistence, ≥ 10 % of frame width net travel, and coherence (net/path) ≥ 0.55. Oscillating branches fail this; walkers pass.

Parameters came from a small grid search over these same sequences (sens 60 and 80), so expect less on new scenes.
**Didn't improve:** `pos_intruder_sway` — a small, low-contrast walker crossing strongly swaying foliage — is **missed**. The variance learned there hides it. Motion is a cue: by default it only raises the detector rate (600 ms idle → back-to-back while blobs/movers are present) and never opens an incident unless "Coherent motion alone may open an incident" is enabled.
Zones: ROI and exclusion polygons are drawn on the Live view (tap the corners). They are saved in localStorage and applied to both the motion mask and the object foot-point.
Cost: ~2.5–3.5 ms/frame in Node and ~26–29 ms p50 in the headless page (it shares the thread with WASM inference). Unoptimised; see "Next".

## STEP 4 — audio

| Clip | Type | YAMNet top classes (max) | v1 events | v1 FP | v2 events | v2 FP |
|---|---|---|---|---|---|---|
| neg_wind_1 | negative | Vehicle 0.95; Rail transport 0.88; Subway, metro, underground 0.88 | Vehicle@1.0, Vehicle@11.0 | 2 | — | 0 |
| neg_rain_1 | negative | Boat, Water vehicle 0.82; Rowboat, canoe, kayak 0.78; Vehicle 0.72 | Vehicle@0.5, Vehicle@10.5 | 2 | — | 0 |
| neg_rain_2 | negative | Pink noise 0.77; Noise 0.77; Rustle 0.62 | — | 0 | — | 0 |
| neg_rainwind_3 | negative | Water 0.94; Ocean 0.93; Stream 0.93 | Vehicle@0.5, Vehicle@14.5 | 2 | — | 0 |
| neg_rain_thunder_4 | negative | Thunderstorm 1.00; Thunder 0.99; Animal 0.85 | Vehicle@3.5, Dog@8.5 | 2 | Dog@14.0 | 1 |
| pos_bird_1 | positive | Bird 0.98; Wild animals 0.97; Bird vocalization, bird call, bird song 0.96 | Bird@5.0, Bird@15.0 | 0 | Bird@6.0, Bird@16.0 | 0 |
| pos_chainsaw_1 | positive | Insect 0.82; Speech 0.64; Buzz 0.63 | Speech@4.0 | 1 | — | 0 |
| pos_dog_1 | positive | Animal 0.95; Domestic animals, pets 0.91; Dog 0.91 | Dog@0.0 | 0 | Dog@0.0 | 0 |
| pos_footsteps_birds_1 | positive | Silence 1.00; Animal 0.99; Crow 0.96 | Bird@5.0 | 0 | Bird@3.5 | 0 |
| pos_cars_birds_1 | positive | Wild animals 0.96; Bird 0.96; Animal 0.96 | Bird@0.0, Bird@10.5 | 0 | Bird@0.5, Bird@13.0 | 0 |
| pos_cars_2 | positive | Vehicle 0.95; Rail transport 0.74; Train 0.70 | Vehicle@2.0, Vehicle@12.0 | 0 | Vehicle@5.0 | 0 |
| pos_gunshot_1 | positive | Cap gun 0.90; Gunshot, gunfire 0.86; Explosion 0.84 | Gunshot@0.5 | 0 | Gunshot@0.5 | 0 |

Audio negatives: 98 s total; v1 8 FP (4.9/min), v2 1 FP (0.6/min). Positives hit: v1 6/7, v2 6/7; FP on positives v1 1, v2 0.

The pipeline works per watch category. Each category is a set of AudioSet classes: Gunshot, Chainsaw, Vehicle, Dog, Speech, Footsteps, Bird, Scream, Glass.
1. Max class score.
2. Median-of-3, then EMA (α 0.5). Impulsive categories (min 1 window) keep 85 % of the raw peak.
3. An adaptive ambient baseline is subtracted. It is learned continuously, 8× slower while the category fires, so a sustained sound reports its onset and is absorbed after about 1 minute.
4. An ambient-weather boost: +0.2 on thresholds while the wind/rain/water/thunder classes' EMA is ≥ 0.4.
5. A quiet gate: below the running 10th-percentile floor + 3 dB and below −45 dBFS.
6. Per-category threshold and minimum duration (Settings › Sound). 10 s debounce.

The largest single win was **removing YAMNet's generic "Vehicle" class** from the Vehicle category, because it fires at 0.7–0.95 on wind and rain. Specific classes (Car, Truck, Engine, Idling, Motor vehicle…) are required instead. The car clip is still detected.
There is no true spectral gate: YAMNet takes raw waveform, and a pre-filter would change its input distribution. The per-class baseline subtraction (the brief's alternative) is used instead.
**Didn't improve:** the thunder clip still produces one "Dog" event (thunder rumble → Growling/Dog). The chainsaw clip is heard by YAMNet as insect/buzz, so it is missed by both versions. Adaptive suppression also lowers sensitivity in heavy rain, and this is documented in Help.

## STEP 5 — incidents & history

Incidents open only on confirming evidence: a confirmed in-zone track, an audio watch event, a manual mark, or coherent motion if opted in. Motion cues are attached as context. An incident closes after the configurable gap (30 s) once none of its tracks are visible.
Each record holds: start/end, tracks (label, peak, time-to-confirm, best-frame snapshot), audio categories + top YAMNet labels, motion stats, and reason codes such as `CONFIRMED_TRACK:person (3/5≥0.45)` and `AUDIO_WATCH:Dog`.
When visual and audio evidence fall within 10 s they are tagged **"co-occurring — possibly related; SENTINEL does not determine that they come from the same source."**
Events and incidents moved from localStorage to **IndexedDB** (v1 events are migrated automatically). History has filters for text, label, type, minimum confidence and date range.
Storage: `navigator.storage.estimate()` usage, a `persist()` request on start plus a button, and a Safari 7-day-eviction warning. Exports: CSV (events + incidents), JSON, and ZIP with snapshots.

## STEP 6 — diagnostics

The DIAG tab shows:
* Model, input size and adaptive state; backend; detections/s.
* Detector p50/p95 split into pre / infer / post, plus motion, YAMNet and draw p50.
* Frame policy (latest-frame only, queue depth 0/1), skipped detector slots, and camera frames vs. analysed (via `requestVideoFrameCallback`).
* JS heap (Chromium only) and `tf.memory()`.
* A latency-drift / thermal hint (+60 % vs. post-warm-up baseline → step the size down and log it).
* The latest raw detections with raw score vs. class threshold vs. track confidence and the **rejection reason**.
* The track table (state, hits N/M, age, peak, zone) and audio categories (raw / smoothed / baseline / effective / threshold).

## STEP 7 — field test

**Tap-to-label sessions**: tap a confirmed box → TP / FP; tap empty space → missed object with a class. Metrics: per-class and overall TP/FP/FN, precision, recall, F1, **FP per hour**, mean confidence, **time-to-confirm**.
The anonymised JSON/CSV export contains no images, relative seconds instead of timestamps, only the date, and GPS only if ticked (rounded to 0.01°). The test suite checks for absence of ISO timestamps, image references and precise coordinates.
The v1 timed-trial flow is kept unchanged.

## STEP 8 — iOS realism

`visibilitychange`, `pagehide` and camera track `mute`/`ended` all pause analysis. On return SENTINEL logs a `MONITORING GAP` event ("NOT monitoring for N s (reason) from <time>"), resets the background/tracker/audio models, and restarts the camera if iOS ended the track.
The HUD always shows "FOREGROUND ONLY" (and "PAUSED — NOT MONITORING" during a gap). The splash and Help say plainly that background monitoring is impossible in Safari.
Thermal throttling is handled through drift detection and adaptive size/rate. Help covers camera permission re-prompts (aA › Website Settings, Settings › Apps › Safari) and storage eviction.

## Test suite

`node test/run_tests.js` runs:
* Unit tests: core (21) + v2 (25: NMS, enhancement, tracker lifecycle/zones, motion shake/light/walker/exclusion, audio wind confusion/dog/baseline, incidents/co-occurrence, search, field metrics, anonymisation).
* The model harness: EfficientDet-Lite0 / YOLO11n / COCO-SSD each find person+dog, letterbox mapping, tracker confirmation, YAMNet dog → Dog event.
* An end-to-end app run in an iPhone-sized viewport with a fake camera and microphone. It checks confirmed person+dog tracks, object and sound events, an incident with co-occurrence, a simulated background gap logged, tap-to-label TP+miss, CSV/JSON/ZIP/anonymised exports, and zero JS errors.

## Dropped / not done

* EfficientDet input size cannot be changed (it is fixed by the model). Adaptive mode lowers the *rate* for it instead; size adaptation applies to YOLO and COCO-SSD.
* No WebGPU result: headless had no WebGPU adapter. ORT tries WebGPU first and falls back to WASM, and the fallback is the path that was measured. iOS 26 Safari exposes WebGPU, but this is unverified on a device.
* WASM is single-threaded on GitHub Pages (no cross-origin isolation headers).
* The image-level eval does not score localisation (no boxes were labelled).
* There is no real occluded-person video. The occlusion test is synthetic (tracker unit test).
