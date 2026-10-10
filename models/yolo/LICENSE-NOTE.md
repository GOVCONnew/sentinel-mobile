# YOLO models — licence note
`yolov8n.onnx` and `yolo11n.onnx` were exported by us from the official Ultralytics weights (`yolov8n.pt`, `yolo11n.pt`) with
`ultralytics` (`YOLO(..).export(format='onnx', dynamic=True, simplify=True, opset=17)`). Ultralytics models are licensed under
**AGPL-3.0** (https://github.com/ultralytics/ultralytics/blob/main/LICENSE). They are optional in SENTINEL (not the default model);
this repository is public and its source is available, which satisfies AGPL's source-availability requirement for this use.
The default detector, EfficientDet-Lite0 (`models/effdet/`), is Apache-2.0 (Google MediaPipe).
