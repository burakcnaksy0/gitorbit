---

## Install & first launch / Kurulum ve ilk açılış

| Platform                                     | File                  | First launch / İlk açılış                                                                                                                                                                                                                                                                |
| -------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Linux** (x86_64)                           | `.AppImage` / `.deb`  | Runs as-is / doğrudan çalışır: `chmod +x Gybe_*_amd64.AppImage && ./Gybe_*_amd64.AppImage` or / ya da `sudo apt install ./Gybe_*_amd64.deb`. System libs / sistem kütüphaneleri gerekir: `libwebkit2gtk-4.1`, `libdbus-1`, `libayatana-appindicator3` (README'deki tek satırlık `apt` komutu). |
| **macOS** (Apple Silicon + Intel, universal) | `_universal.dmg`      | Package is **unsigned / imzasız** — no Apple Developer or notarization / Apple Developer hesabı ve notarization yok (bkz. `docs/adr/0005`). First launch / ilk açılış: **right-click → Open → Open / sağ tık → Aç → Aç** (one time / bir seferlik); terminal alternatifi: `xattr -d com.apple.quarantine /Applications/Gybe.app`.  |
| **Windows** (x64)                            | `_x64-setup.exe`      | Package is **unsigned / imzasız** — SmartScreen shows "Windows protected your PC" once / bir kez "Windows korudu". Geç: **"More info" → "Run anyway" / "Daha fazla bilgi" → "Yine de çalıştır"**.                                                                                              |

**Why unsigned / Neden imzasız:** code signing certificates and Apple
notarization are paid infrastructure this project doesn't run yet — we'd
rather say it plainly than pretend. Her iki uyarı da yalnızca **ilk açılışta**
çıkar; paketlerde telemetri, hesap zorunluluğu veya arka plan servisi yoktur.
Beklenen SHA-256 değerleri her asset'in yanında yazılıdır; bu binary'lere
güvenmiyorsan kendi makinende kaynaktan derleyebilirsin:
`npm ci && npm run tauri build`.
