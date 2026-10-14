$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'research\deepfilternet3\rebuild'
$expectedCommit = 'd375b2d8309e0935d165700c91da9de862a99c31'
if (-not (Test-Path -LiteralPath $sourceRoot)) {
    git clone https://github.com/Rikorose/DeepFilterNet.git $sourceRoot
    if ($LASTEXITCODE -ne 0) { throw 'Source download failed' }
    git -C $sourceRoot checkout --detach $expectedCommit
    if ($LASTEXITCODE -ne 0) { throw 'Source revision checkout failed' }
}
$actualCommit = git -C $sourceRoot rev-parse HEAD
if ($actualCommit -ne $expectedCommit) { throw 'Unexpected source revision' }
$compilerVersion = rustc --version
if (-not $compilerVersion.StartsWith('rustc 1.98.1 ')) { throw 'Reproducible build requires Rust 1.98.1 and wasm32-unknown-unknown target.' }
$bindgen = Join-Path $projectRoot 'research\deepfilternet3\toolchain\bin\wasm-bindgen.exe'
if (-not (Test-Path -LiteralPath $bindgen)) { throw 'Build wasm-bindgen-cli 0.2.92 into research/deepfilternet3/toolchain first; see docs/deepfilternet3.md.' }
if ((& $bindgen --version) -ne 'wasm-bindgen 0.2.92') { throw 'Wrong wasm-bindgen version' }
Copy-Item -LiteralPath (Join-Path $projectRoot 'runtime\deepfilternet3\wasm.rs') -Destination (Join-Path $sourceRoot 'libDF\src\wasm.rs')
Copy-Item -LiteralPath (Join-Path $projectRoot 'runtime\deepfilternet3\Cargo.lock') -Destination (Join-Path $sourceRoot 'Cargo.lock')
Push-Location $sourceRoot
try {
    cargo build --locked --lib -p deep_filter --target wasm32-unknown-unknown --no-default-features --features wasm --release -j 4
    if ($LASTEXITCODE -ne 0) { throw 'DeepFilterNet WASM build failed' }
    $generated = Join-Path $sourceRoot 'noiselab-bindgen'
    & $bindgen 'target/wasm32-unknown-unknown/release/df.wasm' --target web --out-dir $generated
    if ($LASTEXITCODE -ne 0) { throw 'WASM bindings generation failed' }
    Copy-Item -LiteralPath (Join-Path $generated 'df.js') -Destination (Join-Path $projectRoot 'public\vendor\deepfilternet3\df.js')
    Copy-Item -LiteralPath (Join-Path $generated 'df_bg.wasm') -Destination (Join-Path $projectRoot 'public\vendor\deepfilternet3\df_bg.wasm')
} finally { Pop-Location }
Write-Output 'Official DeepFilterNet3 runtime rebuilt. Run npm run vendor to refresh asset hashes.'
