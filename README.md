# Newton SENTINEL Mobile

On-device forest/field wildlife & activity detection for iPhone Safari (iOS 17+). No backend, no paid APIs.
Live: https://govconnew.github.io/sentinel-mobile/

- **Objects:** COCO-SSD 2.2.3 (lite_mobilenet_v2 / mobilenet_v2) on TF.js 4.22 (jsDelivr). WebGL → WASM → CPU fallback.
- **Motion:** 80×60 grayscale frame differencing, sensitivity, heatmap, ROI (box or 4×4 grid), scene change vs reference frame.
- **Sound:** YAMNet (Google, AudioSet 521 classes) TF.js graph model vendored in `models/yamnet/` (from Kaggle Models google/yamnet/tfJs/tfjs/1) + `yamnet_class_map.csv`; mic → AudioWorklet (ScriptProcessor fallback) → 16 kHz mono → 0.975 s windows.
- **Log:** object track / motion / sound / manual events, ISO timestamps, optional GPS, JPEG snapshots in IndexedDB.
- **Field test:** ground-truth trials → TP/FP/FN, precision, recall, F1, mean confidence, time-to-first-detection.
- **Export:** CSV, JSON, ZIP (JSZip 3.10.1) incl. snapshots, Web Share API with download fallback.

Tests: `node test/unit_core.js` and `node test/run_tests.js` (headless Chrome, fake camera/mic). Results in `test/results.json`, screenshots `test/*.png`.
Test media attribution: see `test/ATTRIBUTION.txt`.
