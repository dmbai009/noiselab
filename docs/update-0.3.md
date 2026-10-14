# NoiseLab 0.3.0

DeepFilterNet3 работает в общем интерфейсе: настоящий инференс, прослушивание, A/B, repeat, WAV export и поток из файла. Backend — официальный Rust/Tract WASM с минимальным мостом владения состоянием. Python, LiveKit, Emscripten и ONNX Runtime для работы не нужны.

Нажмите **«Выбрать модель»** у DeepFilterNet3 и укажите локальный `DeepFilterNet3_onnx.tar.gz`. Официальная копия для проведённого исследования есть в `research/deepfilternet3/sources/official/models/`. Electron запоминает путь; затем откройте WAV/OGG и нажмите **«Обработать участок» → «Слушать» → «Воспроизвести»**. Native attenuation limit в dB отдельно от Dry/Wet; изменение требует нового расчёта.

Дистрибутив содержит движок без weights: самостоятельные условия их распространения у исходного автора не уточнены. Выбираемый архив остаётся внешним локальным файлом, не частью EXE/ASAR. [Исследование A–G](deepfilternet3-integration-research.md), [инструкция/лицензии/пересборка](deepfilternet3.md). Субъективная оценка человеком не проводилась.
