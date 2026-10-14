# DeepFilterNet3: исследование A–G и NoiseLab 0.3.0

Дата: 14 октября 2026. Все семь способов практически проверены; итоговый движок — официальный Rust/WASM с минимальным мостом освобождения состояния. Истинный model inference выполняется в общем Worker-пайплайне и доступен в ABPlayer, A/B, экспорте и потоке из файла. Одна карточка DeepFilterNet3; дополнительные production npm-зависимости не добавлены.

## Исходный проект и архитектура

До изменений сохранён `research/deepfilternet3/noiselab-before-0.3.zip`. В 0.2.1 DeepFilterNet3 был отключён, исполняемого backend не было. Предыдущий C-license blocker был действительным; невозможность официального WASM из него не следовала.

Electron 44.7.2, Node 24.21.0, electron-builder 26.15.3, ASAR. Vanilla ESM и loopback HTTP. contextIsolation/sandbox включены, nodeIntegration выключен. CSP допускает только собственные ресурсы и WASM. WAV читается ограниченными блоками, OGG декодируется локально в OPFS, ABPlayer синхронно воспроизводит Dry/Wet. Worker и safe Save As уже существовали; production AudioWorklet не требовался.

Все эксперименты находятся в `research/deepfilternet3/experiments`, вне сборки. Контракт: initialize → последовательный PCM/файловый offline render → конечный PCM/метрики → playback → dispose. Общий материал: существующая официальная `research/reference-speech.wav`, 48 kHz mono, 508 591 отсчёт, 10,595646 s. Точный 10 s — начальный участок; 60 s — повтор этой записи, а не новая уникальная речь.

## A — @lofcz/deepfilternet-web 0.1.0

[Пакет](https://www.npmjs.com/package/@lofcz/deepfilternet-web), [fork](https://github.com/lofcz/DeepFilterNet), snapshot `773cf0ca65da1f82bc63ee5d8fd15d9314190231`. Установлен с `--ignore-scripts` только в папку эксперимента. Проверены README, ESM и build workflow. Действительный API: DeepFilter.create({wasmUrl,model,attenuationLimit}), frameLength, process, setPostFilterBeta, destroy. Движок основан на Rust/Tract 0.23 и WASM SIMD.

Node и браузер обработали реальную речь. В WASM 34 135 648 байт найден полный официальный архив по смещению 17 488 783. Встроенный и явно переданный архивы дали одинаковый Float32 SHA256 `4dc92cfc1ea0fbcfa2f409723d3f37044c523062defac23f9dd2cb61179d3c1f`. Delay 1440 компенсирован, длина точная, peak 0,339104, RMS 0,0456122. Analyser реального Web Audio подтвердил ненулевой выход. Node memory: 30 343 168 байт при первом состоянии и 40 108 032 после второго внешнего model init; это не RSS. Первый Node init 530 ms, повторный с внешним архивом 298 ms.

Код заявлен MIT OR Apache-2.0, оба текста включены в пакет. Это не отдельное подтверждение разрешения исходного автора весов. Итог: **работает в локальном эксперименте, не выбран для поставки встроенных весов**. Предупреждение deprecated init относится к опубликованной обёртке и не скрыто.

## B — Mezon deepfilternet3-noise-filter 1.3.0

[Пакет](https://www.npmjs.com/package/deepfilternet3-noise-filter), [исходник](https://github.com/mezonai/mezon-noise-suppression), snapshot `a5212661245a2184370fc3c3dd1f52dc4dffb2a5`. Использован непосредственно DeepFilterNet3Core, без LiveKit-кода; npm peer LiveKit установлен только в изолированной папке. Фактические пути 1.3.0: v3/pkg/df_bg.wasm и v3/models/DeepFilterNet3_onnx.tar.gz. Ресурсы получены с указанного авторами CDN, хешированы и локально размещены. WASM 16 418 651 байт, SHA256 `440b5d12b6ea7d95008736f844221d7874ee15de5cb10d3015002470fdba0432`. Model hash совпадает с официальным.

Штатный API под CSP NoiseLab воспроизвёл `AbortError: Failed to load worklet module script: blob:...`. Изолированный сервер с разрешённым blob подтвердил совместимость OfflineAudioContext после предварительного initialize. Затем отдельно проверено исправление: встроенный worklet сохранён как локальный JS, loader направлен на него. **Этот вариант работает под неизменённым CSP**, а не только при его ослаблении. Все ресурсы локальны, параметр подавления 100 dB, микрофона/MediaRecorder нет. Получен конечный изменённый PCM и измерен реальный playback.

Ring buffer добавляет 512 отсчётов к model delay после стартового перехода; на имеющейся речи выравнивание 1952 даёт RMS-различие с A 8,9e-9. Для flush подавались дополнительные 4800 нулей; сохранённый raw output не назван готовым выровненным NoiseLab-буфером. Core.destroy отключает узел/ссылки, но опубликованный API не освобождает raw state отдельным df_free. Память worklet достоверно не измерена. Код Apache-2.0 OR MIT; отдельное разрешение модели не подтверждено. Итог: **работает после локального исправления загрузки; не выбран из-за lifecycle/контекстной сложности**.

## C — boredland/noise

[Проект](https://github.com/boredland/noise), snapshot `711c6db41c20f47e49ee6d699d32af8822b0637a`. Изучены src/main.js, offline render, локальные assets, service worker, mono mix, EQ/normalization и экспорт. Отдельно установлен alias mezon-v2@npm:deepfilternet3-noise-filter@1.2.1, соответствующий примерному стеку, и использованы его v2 ресурсы из public/model. Архив совпал с официальным.

Собственный harness повторяет файловую последовательность initialize → OfflineAudioContext → source/filter → startRendering. UI, extra EQ, автоматическая нормализация и потеря стерео через чужой mono mix не перенесены. C — другой способ подключения того же Mezon-стека, а не новая нейросеть. Blob-CSP ошибка воспроизведена; на изолированном сервере получен реальный воспроизводимый сигнал. RMS-различие с A после 1952 отсчётов — 1,25e-8. 10 и 60 s проверены; пример удерживает полный PCM, большие произвольные файлы так не объявлены проверенными.

Отдельного LICENSE приложения в snapshot нет. Его нетривиальный код не скопирован; собственный тест только использует лицензионный Mezon API и файловую последовательность. Итог: **работает в эксперименте; не выбран**, ограничения B также применимы.

## D — C/WASM

[Порт](https://github.com/kdrkdrkdr/DeepFilterNet3.c.wasm), snapshot `1695a9b3282e20515ab08eb97c83520f20d23138`. Изучены build.sh, dfn3_wasm.c, dfn3.h, weights conversion и FFT/AGC. Официальный Emscripten SDK 6.0.12 установлен в исследовательскую папку без постоянного изменения PATH. Сторонний build.sh не запускался без анализа.

Первый поиск emcc.bat был ошибочным для SDK 6: там emcc.exe. Исправленная команда собрала ES6 factory, SIMD, fixed memory 64 MiB, input/output pointers, malloc/free и destroy. Input/output AGC и HPF явно выключены, postfilter 0 — исходный worklet включал дополнительные эффекты. Выполнены копирование весов, create, непрерывные фреймы 480, чтение копии output и освобождение ресурсов. Звук действительно воспроизводится, конечность/длина соблюдены; peak 0,334619.

RMS-различие с A 0,005456, поэтому численная эквивалентность не заявлена. Полного подтверждения преобразованных weights не выполнено. В дереве нет разрешения на собственный C inference code; лицензия KissFFT его не покрывает. Итог: **работает локально, непригоден для поставки при нынешнем правовом статусе**. C/WASM и weights отсутствуют в production.

## E — официальный Rust/WASM, выбран

[Upstream](https://github.com/Rikorose/DeepFilterNet), snapshot `d375b2d8309e0935d165700c91da9de862a99c31`, libDF 0.5.7-pre. wasm32 target установлен, код реально собран. Первое cargo build --locked остановилось: upstream workspace lock требовал обновления. Оригинал сохранён как Cargo.lock.upstream; зависимости разрешены один раз, итоговый lock закреплён в runtime/deepfilternet3/Cargo.lock.

Команда: `cargo build --locked --lib -p deep_filter --target wasm32-unknown-unknown --no-default-features --features wasm --release -j 4`. Rust 1.98.1, Tract 0.21.4, wasm-bindgen-cli 0.2.92 собран из исходника, target web. Сборка завершилась; lifetime/name-section warnings сохранены, не названы неисправностью модели.

Первичный PCM был правильным, но экспериментальный вызов внутреннего __wbg_dfstate_free(rawPointer) дал `RuntimeError: unreachable` в dealloc. Он предназначен для другого wasm-bindgen handle. Минимальная правка wasm.rs: panic hook и df_free через drop(Box::from_raw(st)). После пересборки create/process/reset/recreate/destroy проходят; JS не допускает double-free или process уничтоженного состояния. Neural/DSP не переписаны.

WASM 14 692 791 байт, SHA256 `f414193e213d5dfdd8c3dfd09a9c77a4afde688036ddb50aef2a584ff0207e56`, без встроенного model archive. RMS-различие с A 1,25e-8; независимые stereo states. Delay 1440 по config и native formula. Найден отдельный 0 dB режим, который сразу возвращает вход: для него delay 0. Это проверено на начале и хвосте; последний неполный frame и точная длина покрыты тестами. Память при 10/60 s одинакова — 31 064 064 байта; повторные destroy/recreate не дали неограниченного роста.

Интегрирован в registry/createDenoiser/processWav/Worker/ABPlayer. Внешний ModelFile проверяется по SHA256 в UI и перед обработкой. Runtime/bridge MIT OR Apache-2.0. Весовой архив не включён в EXE/ASAR. Итог: **работает и выбран**: официальный компактный backend, явное владение памятью, прежний CSP, достаточная скорость и отсутствие дополнительных пользовательских средств выполнения.

## F — ONNX Runtime Web

Источники: [#472](https://github.com/Rikorose/DeepFilterNet/issues/472), [samejs first_demo](https://github.com/grazder/samejs/tree/first_demo/deepfilternet3) snapshot `3f8826bb90b2d2915cf1d46361dd6b61fb08d8ea`, [torchDF fork](https://github.com/grazder/DeepFilterNet/tree/torchDF-changes/torchDF) snapshot `1097015d53ced78fb234e7d7071a5dd4446e3952`. ONNX Runtime Web закреплён на 1.30.0.

В samejs отсутствует готовый denoiser_model.ort: инструкция требует полного экспорта. Не выдан запуск encoder за аудиопроцессор. В отдельном venv установлены CPU torch/torchaudio 2.1.0, NumPy 1.26.4, deepfilterlib 0.5.6, onnx 1.14.1, onnxruntime 1.16.3 и служебные пакеты. Официальный checkpoint epoch 120 распакован локально. Использован существующий TorchDFPipeline со STFT/ERB/нормами/ISTFT и recurrent state.

TorchScript и opset-14 export завершились: full graph 16 139 334 байта, input_frame[480], states[45304], scalar atten_lim_db; outputs frame[480], states[45304], lsnr[1]. Native session исполнила граф. Первый web run ошибся типом: Python 100 экспортировался int64, а был подан float. После BigInt64 scalar полный файл исполнился через ONNX Runtime Web. State переносилось между фреймами; тензоры/session освобождались, tail/1440 delay обработаны.

Выход конечный, точной длины, peak 0,339101; analyser подтвердил playback. RMS-различие с A 8,55e-7. Это полноценная обработка DSP+DNN, не частичный encoder. Код исходного fork наследует MIT/Apache-2.0 декларацию; модельный вопрос остаётся. Итог: **работает, не выбран**: сложнее экспорт/сопровождение, больше зависимостей. Python/torch/ORT и full graph не нужны и не включены в NoiseLab.

## G — нативный Electron

Официальный CLI из того же upstream собран командой `cargo build --locked -p deep_filter --bin deep-filter --no-default-features --features bin,tract,wav-utils,transforms,default-model --release -j 4`. Первое штатное -D обрезало model delay без flush, последний неполный frame прекращался. Поэтому обёртка дополнила вход до целого frame с нулевым tail и обрезала только padding до original count.

Defaults CLI −15/35/35 сначала дали RMS-разницу 0,0228; для честного сравнения thresholds приведены к WASM −10/30/20. После этого отличие 1,55e-5, включая PCM16-квантизацию CLI writer. Не скрыта первоначальная разница параметров.

Экспериментальный main обрабатывает fixed IPC, проверяет sender, запускает известный CLI через spawn(shell:false, windowsHide:true), читает ограниченный output, возвращает bytes. Произвольных renderer-команд нет; sandbox/contextIsolation сохранены. В настоящем ABPlayer подтверждены ненулевые отсчёты, pause/resume и A/B delta 0. Python для этого backend не требуется. 10/60 s проверены. Native CLI с default weights остаётся лишь исследовательским артефактом вне приложения. Итог: **работает; резервная независимая проверка, не выбран**.

## Сравнение производительности

Текущий Windows x64, Ryzen 7 5700X. Точные 10/60 s; 60 s повторяют имеющуюся речь. Один измеренный проход, без runtime-сети. performance.now включает wrapper/DSP. B/C render также включает создание worklet state; G total включает процесс и WAV I/O. Это не чисто neural-core timings, не сертифицированный benchmark и не оценка естественности речи.

| Метод | Load/create для 10 s, ms | Process 10 s, ms | Process 60 s, ms | RTF 60 s | Memory |
|---|---:|---:|---:|---:|---|
| A | 557 | 641 | 3000 | 0,0500 | Node first 30,34 MB; browser n/a |
| B | 130 | 1008 | 3840 | 0,0640 | n/a |
| C | 102 | 1681 | 7337 | 0,1223 | n/a |
| D | 65 | 315 | 1466 | 0,0244 | 67 108 864 B fixed WASM |
| E | 644 | 1301 | 7633 | 0,1272 | 31 064 064 B WASM, 10 и 60 s |
| F | 435 | 2633 | 13283 | 0,2214 | n/a |
| G | Входит в total | 916 total | 3150 total | 0,0525 total | n/a |

Для A отдельно измерены first/repeat init и identical embedded/external weights. Повторные E init, очистка и обработка проверены. Отдельных достоверных warm-init цифр всех остальных стеков нет; они не придуманы. Быстрейший D не выбран из-за правового статуса и численного отличия. E не заявлен быстрее SIMD A — выбран по совокупности свойств.

## Изменённые файлы и зависимости

- algorithms/deepfilternet3.js и index.js: официальный runtime, hash, параметр модели, независимые состояния, ownership, metadata.
- audio/pipeline.js, workers/processor.js, ui/jobs.js: общий ModelFile/стадии/ошибки, ACK и error привязаны к конкретной задаче/Worker.
- ui/app.js/i18n.js, player/player.js: одна карточка, модельный выбор и attenuation control; generation/revision защищают смену файла/контекста и устаревшие ожидания.
- electron/main.cjs/preload.cjs: ограниченное чтение и bookmark выбранной модели, локальная диагностика. Node isolation/CSP не ослаблены.
- public/vendor/deepfilternet3, runtime/deepfilternet3, manifests, notices, docs, тесты и инструменты сборки.

Новые production npm-зависимости не добавлены. A, Mezon, LiveKit peer, ORT, Python, Emscripten размещались только в исследовательских папках; они исключены из сборки. В основном коде нет семи backend, подмены модели, online enhancement, скрытой нормализации или AGC. Другие проекты и пользовательские записи не изменялись.

## Тесты, лицензии и ограничения

39/39 Node tests прошли без skips: инициализация, отсутствующие/подменённые веса, 48/44.1 mono/stereo, неполный frame, точная длина, finite/nonzero/silence/noise, независимость каналов, reset/destroy/dead handles, ограниченный рост памяти, отмена/ошибка и отложенная смена AudioContext. Общие browser regressions RNNoise/GTCRN прошли, включая stream underruns, экспорт, waveform, A/B и scaling.

Новый UI test проверил все три модели на одной речи, реальные analyser samples, A/B, pause/resume, полный float32 export, limiter/reprocess, смену файла во время inference/stream, отмену и ожидание Save As, локализацию и 100/125/150%. Local-only requests и отсутствие uncaught errors подтверждены. Dev Electron проверил native model/audio FileInput, bookmark reload, сохранение через IPC, реальное playback/A-B/repeat и последующий 44.1 stereo. Production-проверка фиксируется в дополнении ниже; автоматическое окно не называется человеческим прослушиванием.

138 normal/build Rust-пакетов имеют inventory версий/SPDX/авторов и сохранённые полные supplied notices. crunchy 0.2.2 и realfft 3.3.0 явно заявляют MIT в metadata, но не включают отдельный LICENSE: сохранены Cargo.toml.orig/README, attribution и отмеченная стандартная MIT-декларация; они не выдаются за upstream files. Unicode notices сохранены. Runtime/bridge MIT OR Apache-2.0.

Отдельное разрешение исходного автора весов не подтверждено: [#697](https://github.com/Rikorose/DeepFilterNet/issues/697), [#700](https://github.com/Rikorose/DeepFilterNet/issues/700), [#709](https://github.com/Rikorose/DeepFilterNet/issues/709) остаются открыты. **В распространяемом EXE/ASAR нет весов DFN3**, пользователь выбирает внешний локальный архив. Не заявлено безусловное право коммерческой поставки модели, C-порта или чужого приложения.

Нет корпуса чистой речи с target, STOI/PESQ, человеческого сравнения шёпота/клавиатуры/вентилятора. Синтетические случаи проверяют инфраструктуру, не заменяют качество реальной речи. Preview остаётся 60 s/12 MiB на вариант; full export ограничен RIFF и читает блоками. Реальное время зависит от CPU/каналов. Другие model hashes/fine-tunes пока не принимаются.

Исходники, конкретные ошибки и численные JSON/выходные WAV сохранены в research/deepfilternet3/results и experiments. Дополнительные Python/npm-окружения и загруженные SDK ZIP удалены после фиксации результатов; package-lock.json и python-requirements.txt сохранены. Для повторения A/B/F выполните npm ci --ignore-scripts в experiments; Python-экспорт требует отдельного venv с зафиксированными пакетами. [Порядок запуска и сборки](deepfilternet3.md). Готовому NoiseLab исследовательские SDK/зависимости не нужны.

## Финальная production-проверка

Собран и действительно запущен `dist/release-0.3.0/win-unpacked/NoiseLab.exe`, не только dev-сервер. Native model FileInput, ошибочный модельный архив с ожидаемой записью диагностики, затем успешный выбор весов, WAV FileInput, все три алгоритма, настоящий ABPlayer/analyser, A/B и pause/resume, повторный DFN3 и локальный WAV save через IPC прошли. После reload восстановился выбранный model path, затем успешно обработано 44.1 kHz stereo.

Production output: 508 591 frame при 48 kHz mono, peak 0,33910396695137024; непосредственно проигрываемый analyser peak 0,31959205865859985 в окончательном прогоне. Следующий stereo input: 44 100 Hz, 2 канала, 32 237 frame. `nodeIntegration` в renderer — undefined. Непредвиденных renderer errors в проверке нет; намеренная ошибка модели записана с этапом и версионной диагностикой. Финальный отдельно запущенный тест завершился чистым stdout result. В одном более раннем параллельном запуске Chromium выдал Widget-строку при CDP pointer injection; assertions и звук прошли, она не объявлена ошибкой инференса и не скрыта.

На окончательном EXE также прошли RNNoise/GTCRN smoke, native export/source protection и закрытие во время активного Worker с удалением временного output. Browser OGG regression отдельно обработал Vorbis/Opus mono/stereo всеми тремя моделями. 39/39 Node tests без skips, общие browser regressions и новый DFN3 UI test пройдены.

ASAR проверен по списку файлов и поиску полных байтов официального model archive: runtime присутствует, archive отсутствует, research/LiveKit/lofcz/ORT/Python/Emscripten не включены. Итоговый размер ASAR 59 335 391 байт; фактический аудит в `test-output/dfn3/packaging.json`. Пользовательские файлы и старая запущенная версия сохранены. Для перехода закройте старую NoiseLab, запустите новый EXE и один раз выберите внешний официальный архив по инструкции.

Визуальная проверка также завершена: у скрытого автоматизированного окна сначала сохранялся старый compositor frame после reload. Только тестовый helper отключает background throttling и ждёт два animation frame перед capture; обычный режим программы не меняется. Проверены DOM и актуальный снимок production: выбран 44.1 stereo файл, активен DeepFilterNet3, состояние «Готово», waveform и управление воспроизведением видимы. Снимок: `test-output/dfn3/electron.png`.
