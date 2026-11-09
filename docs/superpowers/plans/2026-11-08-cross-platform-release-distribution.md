# Cross-Platform Build, Release & Distribution — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitOrbit'i Windows/macOS/Linux için GitHub Releases üzerinden otomatik build edilen installer'larla dağıtılabilir hale getirmek: tag → paralel 3-OS build → installer + checksum + latest.json → yayınlanan Release, ayrıca GitHub Pages indirme sayfası ve uygulama içi otomatik güncelleme.

**Architecture:** Tauri 2'nin yerel bundle + updater altyapısı kullanılır (framework değişmez). `release.yml` workflow'u tag tetiklemesinde kalite kapılarını koşup 4 matris ayağında (Linux x64, Windows x64, macOS aarch64, macOS x86_64) `tauri-action` ile installer üretir ve taslak Release'e yükler; final job SHA-256 checksum + changelog ile release'i yayınlar. İndirme sayfası `site/` altında derlemesiz statik site olarak GitHub Pages'ten yayınlanır ve sürüm bilgisini Releases API'sinden dinamik çeker. Uygulama içi güncelleme `tauri-plugin-updater` (GitHub endpoint, minisign imzalı `latest.json`) ile yapılır.

**Tech Stack:** Tauri 2.12 / Rust, tauri-plugin-updater + tauri-plugin-process, @tauri-apps/plugin-updater (JS), tauri-action@v0, GitHub Actions matrix + Releases API, GitHub Pages (vanilla JS/ESM), vitest.

**Spec:** Kullanıcı isteği (2026-11-08 sohbeti) — bölüm özeti bu planın "Kapsam ve tasarım kararları" başlığında; AGENTS.md kalıcı kuralları ayrıca bağlayıcıdır.

## Kapsam ve tasarım kararları (kullanıcı isteğinin özeti + verilen kararlar)

Kullanıcı isteği (özet): GitHub Releases altyapısı (Win `.exe` NSIS + portable, macOS `.dmg`/`.zip`, Linux AppImage/`.deb`/`.rpm`), tag ile tetiklenen paralel Actions build'i, OS algılamalı dinamik indirme sayfası, kurulum/ilk çalıştırma deneyimi, otomatik güncelleme, checksum + secrets + pre-release ayrımı, mevcut framework'e sadakat, aşama aşama + her aşamada test + uçtan uca doğrulama, "test edilmeyeni başarılı raporlama" yasağı.

Verilen tasarım kararları (builder kararı — kullanıcı "devam et" dedi):

1. **Yaklaşımlar:** (A) Tauri yerel bundler + `tauri-action` + GitHub Releases — SEÇİLDİ: framework'ün kendi yolu, en az bakım, updater ile entegre. (B) Harici NSIS/dmg build scriptleri — framework'ün yaptığı işi yeniden yazmak; elendi. (C) Kendi dağıtım sunucusu/CDN — gereksiz altyapı, "GitHub Releases" isteğine aykırı; elendi.
2. **İmzalama koşullu:** Apple Developer ID / Windows Authenticode sertifikalarının varlığı bilinmiyor. Workflow imza secret'ları varsa uygular, yoksa paketi imzasız üretir ve Release body'sinde + indirme sayfasında **dürüstçe** "imzasız — Gatekeeper/SmartScreen notu" belirtilir (AGENTS.md dürüstlük ilkesi).
3. **Sürüm tek kaynağı:** `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` üçünün sürümü eşit olmak zorunda; release-meta job'u tag ile karşılaştırıp uyuşmazlıkta yayınlanmadan patlar. Sürüm `0.1.0 → 0.3.0` (README v0.2.x serisinin paketli devamı).
4. **Universal binary ve ARM64 Linux/Windows: bilinçli erteleme.** macOS x64 + ARM64 ayrı artefaktlar (updater platform-anahtarı doğruluğu için ayrı build daha güvenli); Windows ARM64 x64 paket emülasyonla çalışır; Linux ARM64 cross-build maliyeti yüksek. Üçü README "bilinçli sınırlar"a yazılır.
5. **Linux updater dürüstlüğü:** Tauri updater yalnızca `.deb` kurulumunu güncelleyebilir. AppImage/dev tespiti Rust tarafında sınıflandırılır; desteklenmeyen kurulum biçiminde "güncel" yalanı söylenmez, indirme sayfasına yönlendirilir.
6. **Updater imza anahtarı:** minisign çifti geliştirme sırasında `tauri signer generate` ile üretilir; özel anahtar **repoya girmeden** `~/.tauri/`'de tutulur, public key `tauri.conf.json`'a yazılır, gizli anahtar GitHub Secret olur. Secret yoksa release installer'ları yine üretilir, `latest.json` üretilmez (koşullu `createUpdaterArtifacts`).
7. **Beta/pre-release:** tag içinde `-` varsa (ör. `v0.3.1-rc.1`) veya `workflow_dispatch` input `prerelease=true` ise Release prerelease işaretlenir; `/releases/latest` API'si prerelease'i dönmediği için indirme sayfası yalnızca stable görür.
8. **İndirme sayfası:** bu repoda `site/`, GitHub Pages ile yayınlanır; derleme adımı yoktur (vanilla ESM); sürüm/tarih/varlıklar `releases/latest` API'sinden; salt-okunur mantık test edilebilir saf fonksiyonlardır.
9. **Kullanıcı verisi güncellemede korunur:** updater yalnızca ikameleri değiştirir; `%APPDATA%/com.gitorbit.app`, `~/.config`, Keyring'e dokunulmaz — README'de belirtilir.

## Global Constraints

- Kullanıcıyla iletişim ve commit mesajları Türkçe, conventional-commit önekiyle (`feat(release): … (WP-n)`).
- Her görev = bir commit; commit öncesi kapılar: `cargo test --manifest-path crates/gitorbit-core/Cargo.toml --features test-support`, `src-tauri/`de `cargo fmt` + `cargo check` + `cargo test`, kökte `npx tsc --noEmit` + `npx vitest run` + `npm run build`. Rust'a dokunulmayan görevde Rust kapıları son bilinen haliyle geçerli.
- Kök `Cargo.toml` yok; cargo komutları crate başına.
- Token/refresh yalnızca OS keyring'de; **minisign özel anahtarı da repoya, loga, Release body'sine giremez**. Hassas bilgiler yalnızca GitHub Actions Secrets'ta.
- Dürüstlük: imzasız/geniclenmemiş bir artefakt "hazır/test edildi" olarak raporlanmaz; `recovery_hint` yutulmaz (tek gösterim `src/lib/errors.ts`).
- README her görevden sonra güncellenir (yetenek haritası, bilinçli sınırlar, kalite kapıları, sürüm özeti).
- Yıkıcı Git işlemi yok (force/hard reset/silme yok); push ve tag'i kullanıcı onayıyla biz atarız (Görev 7).
- Tauri config'te `build.additionalWatchFolders` (camelCase eski ad) olduğu gibi kalır.

## Review Focus

Spesifikasyonun ima edip hiçbir görevin doğrudan test etmediği, kullanıcıya en pahalıya patlayacak beş sınıf:

1. **İmzasız macOS/Windows paketi + Gatekeeper/SmartScreen:** kullanıcı ilk açılışta uyarı görür → beklenti: sayfa ve Release body aynı dürüst yönergeyi (sağ tık → Aç / More info) vermeli; imza secret'ı girilince metin kendiliğinden kalkmalı. (Testi: Görev 6 — body/sayfa metinlerinin koşullu üretim mantığı + Görev 7 yerinde doğrulama.)
2. **AppImage kullanıcısına "güncel" demek:** en sık kurulum biçimi AppImage'tır; updater sessizce null döner → beklenti: "Kurulum biçimin otomatik güncellemeyi desteklemiyor, indirme sayfasına git" yönlendirmesi. (Testi: Görev 2 Rust sınıflandırma birim testleri + Görev 3 `updates.test.ts` `unsupported` dalı.)
3. **Tag ↔ sürüm uyuşmazlığı:** `v0.4.0` atılıp config `0.3.0` kalırsa yanlış etiketli yayın çıkar → beklenti: hiçbir artefakt üretilmeden job kırmızı. (Testi: Görev 4'te `release-meta` mantığının bağımsız betikle yerel testi.)
4. **Testleri geçmemiş sürümün yayınlanması:** Gates job'ı build matrisinden önce koşmalı, `needs` zinciri koparsa yayın yok. (Testi: Görev 4 actionlint + `needs` grafiğinin gözden geçirilmesi; Görev 7'de kasıtlı başarısız gates denemesi opsiyonel.)
5. **Release varlık adları değişirse indirme sayfası çökmesin:** regex tabanlı eşleme + eşleşme yoksa butonlar Releases sayfasına düşmeli, JS hatası beyaz ekran üretmemeli. (Testi: Görev 5 `releases.test.mjs` fixture'ları.)

---

### Görev 1: Sürüm hizalama + bundle yapılandırması + ADR-0005

**Files:**
- Modify: `package.json` (version), `src-tauri/tauri.conf.json` (version + bundle), `src-tauri/Cargo.toml` (version), `src-tauri/Cargo.lock` (kargo günceller)
- Create: `docs/adr/0005-v0-3-v0-3-paketli-dagitim-ve-updater.md`
- Modify: `docs/adr/0004-linux-paketleme-bicimi.md` (Durum satırı: "ADR-0005 ile süresi doldu")
- Modify: `README.md` (sürüm satırı + kısa dağıtım notu)

**Interfaces:**
- Produces: tüm sonraki görevlerin okuduğu sürüm `0.3.0`; `tauri.conf.json`'da `bundle.publisher`, `bundle.category`, `license`, `bundle.windows.webviewInstallMode: {kind:"downloadBootstrapper"}` (offline installer değil — kurulumda WebView2 indirir, MSI/NSIS'te zorunlu değildir ama temiz varsayılandır).

- [ ] **Step 1: Sürümleri 0.3.0 yap.** `package.json`, `tauri.conf.json`, `src-tauri/Cargo.toml` → `"0.3.0"`. `cd src-tauri && cargo check` (Cargo.lock'un güncellenmesi için). Beklenen: check yeşil, `Cargo.lock`'ta `gitorbit 0.3.0`.
- [ ] **Step 2: Bundle yapılandırmasını tamamla.** `tauri.conf.json` `bundle` bloğu:
  ```json
  "bundle": {
    "active": true,
    "targets": "all",
    "publisher": "GitOrbit Contributors",
    "license": "MIT",
    "category": "DeveloperTool",
    "shortDescription": "Yerel Git ve GitHub çalışma alanı",
    "longDescription": "GitOrbit — çok depolu Git/GitHub masaüstü çalışma alanı. Tamamen yerel; hesap zorunluluğu ve telemetri yok.",
    "windows": { "webviewInstallMode": { "kind": "downloadBootstrapper" } },
    "icon": [ …mevcut… ]
  }
  ```
  Not: `publisher` MSI/WiX için **zorunludur**; bu olmadan Windows bundle'ı CI'da patlar.
- [ ] **Step 3: Yerel Linux bundle doğrulaması (gerçek çıktı).** `npm run tauri build -- --bundles deb,appimage` (arka plan, ~10 dk; webkit2gtk kurulu varsayımı—değilse `sudo apt-get install -y libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev` öner, kullanıcıya sor). Beklenen: `src-tauri/target/release/bundle/{deb,appimage}/` altında `gitorbit_0.3.0_amd64.deb` ve `GitOrbit_0.3.0_amd64.AppImage`. `dpkg-deb -I` ile paket meta'sını, `--appimage-extract` ile AppImage iskeletini kontrol et (bu, sayfanın/vadelerin ilk gerçek kanıtı — README'ye "Linux paketi yerelde üretildi ve doğrulandı" yazılabilir; Win/mac için yazılamaz).
- [ ] **Step 4: ADR-0005 yaz** (ADR-0004'ün süresi doldu notunu ekle). İçerik: karar (bundle'lı GitHub Releases + updater + Pages), gerekçe, ADR-0004'ün "takip (v0.2)" maddesinin karşılandığı, bilinçli sınırlar (imzasız başlangıç, universal yok, ARM64 Linux yok).
- [ ] **Step 5: Kapılar + README + commit.** Tüm Global Constraints kapıları; README sürüm satırı `v0.3.0` ve "bilinçli sınırlar"a ertelenmiş platform satırları.
  `git commit -m "feat(release): surum 0.3.0 hizalamasi + tauri bundle yapilandirmasi + ADR-0005 (WP-9)"`
  (WP numarası depo sıralamasına göre; mevcut WP-8 sonrası WP-9.)

---

### Görev 2: Updater — Rust tarafı, imza anahtarı, yapılandırma, kurulum-biçimi sınıflandırma

**Files:**
- Modify: `src-tauri/Cargo.toml` (+`tauri-plugin-updater = "2"`, +`tauri-plugin-process = "2"`), `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json` (`plugins.updater`), `package.json` (+`@tauri-apps/plugin-updater`, +`@tauri-apps/plugin-process`)
- Create: `~/.tauri/gitorbit-updater.key` (repo DIŞI), anahtar parolası dosyası `~/.tauri/gitorbit-updater.key.password` (0600)

**Interfaces:**
- Produces:
  - IPC komutu `update_packaging_kind() -> String` (Görev 3 `tauriCommands.ts` sarmalayıcısı ve Settings kullanır).
  - Saf Rust fonksiyonu `fn classify_packaging(os: &str, exe_path: &str, appimage_env: Option<&str>, is_debug: bool) -> &'static str` → `"dev" | "appimage" | "deb" | "app" | "installer" | "unknown"`.
  - `plugins.updater.endpoints = ["https://api.github.com/repos/burakcnaksy0/gitorbit/releases/latest/download/latest.json"]`, `plugins.updater.pubkey` (üretilen minisign public key), `plugins.updater.windows.installMode = "passive"`.

- [ ] **Step 1: minisign çiftini üret.** `npm run tauri -- signer generate -w ~/.tauri/gitorbit-updater.key -p <openssl rand -hex 16 çıktısı>`; public key çıktıyı al. Parolayı `~/.tauri/gitorbit-updater.key.password` dosyasına yaz (`chmod 600`). Public key dışında hiçbir anahtar materyali repoya/konuşmaya yazılmaz (public key gizli değildir, yazılabilir).
- [ ] **Step 2: Rust bağımlılıkları + plugin init.** `Cargo.toml`'a iki plugin; `lib.rs` `run()` builder zincirine `.plugin(tauri_plugin_updater::Builder::new().build())` ve `.plugin(tauri_plugin_process::init())`; `invoke_handler`'a `update_packaging_kind` ekle.
- [ ] **Step 3: Sınıflandırma testi yaz (TDD).** `lib.rs` `mod tests` içine `classify_packaging` tablo testi:
  ```rust
  // (os, exe_path, appimage_env, is_debug) → beklenen
  // ("linux", "/tmp/.mount_GitOrbXXXX/gitorbit", Some("/tmp/.mount_…/GitOrbit.AppImage"), false) → "appimage"
  // ("linux", "/usr/bin/gitorbit", None, false) → "deb"
  // ("linux", "/opt/GitOrbit/gitorbit", None, false) → "deb"
  // ("linux", "/home/u/dev/gitorbit", None, true)  → "dev"
  // ("macos", "/Applications/GitOrbit.app/Contents/MacOS/gitorbit", None, false) → "app"
  // ("windows", r"C:\Program Files\GitOrbit\gitorbit.exe", None, false) → "installer"
  // ("linux", "", None, false) → "unknown"
  ```
  `cargo test --manifest-path src-tauri/Cargo.toml` ile ÖNCE kırmızıyı gör.
- [ ] **Step 4: `classify_packaging` + komutu implement et.** Komut: `std::env::current_exe()` + `std::env::var_os("APPIMAGE")` + `cfg!(debug_assertions)` ile saf fonksiyonu besler. Yeşili doğrula.
- [ ] **Step 5: Config + capability.** `tauri.conf.json`: `plugins.updater` (endpoints/pubkey/installMode yukarıdaki exact değerlerle). `capabilities/default.json` permissions: `"updater:default"`, `"process:default"` ekle.
- [ ] **Step 6: JS paketleri.** `npm i @tauri-apps/plugin-updater @tauri-apps/plugin-process` (lockfile'ı kuruma göre sabitle).
- [ ] **Step 7: Kapılar + README (updater altyapısı satırı) + commit.**
  `git commit -m "feat(updater): tauri-plugin-updater + paket bicimi siniflandirma (WP-10)"`
  Not: `tauri.conf.json`'da `createUpdaterArtifacts` BİLİNÇLİ yok — CI secret varsa enjekte eder (Görev 4).

---

### Görev 3: Updater — frontend akışı (lib + modallar + Ayarlar)

**Files:**
- Create: `src/lib/updates.ts`, `src/lib/updates.test.ts`, `src/components/common/UpdateModal.tsx`, `src/components/common/UpdateModal.test.tsx`
- Modify: `src/lib/tauriCommands.ts` (sarmalayıcı), `src/components/layout/Shell.tsx` (otomatik kontrol + modal mount), `src/features/settings/SettingsView.tsx` ("Uygulama Güncellemeleri" kartı)

**Interfaces:**
- Consumes: `update_packaging_kind` (Görev 2), `@tauri-apps/plugin-updater` `check()`, `update.downloadAndInstall(cb)`, `@tauri-apps/plugin-process` `relaunch()`, `errorMessage`/`errorHint` (errors.ts), `useNotify`, `useDialogA11y`.
- Produces (Görev 5 buna benzemez; bağımsızdır):
  ```ts
  // src/lib/updates.ts
  export type UpdateOutcome =
    | { status: "available"; version: string; body?: string; date?: string }
    | { status: "upToDate" }
    | { status: "unsupported"; kind: string }   // appimage/dev/portable → sayfa yönlendirmesi
    | { status: "error"; message: string; hint?: string };
  export type UpdateDeps = {
    check: () => Promise<UpdaterLike | null>;   // enjekte edilebilir (test)
    packagingKind: () => Promise<string>;
    openDownloadPage: () => void;
  };
  export async function checkForUpdates(deps: UpdateDeps, opts?: { manual?: boolean }): Promise<UpdateOutcome>;
  export async function installUpdate(update: UpdaterLike, onProgress: (pct: number) => void): Promise<void>; //成功后 relaunch çağrılmaz — çağıran çağırır
  ```
  `UpdaterLike = { version: string; body?: string; date?: string; downloadAndInstall: (cb?) => Promise<void> }`.

- [ ] **Step 1: `updates.test.ts` yaz (önce kırmızı).** Durumlar: (a) `check→null` + kind `"installer"` → `upToDate`; (b) `check→null` + kind `"appimage"` → `unsupported{kind:"appimage"}` VE `openDownloadPage` çağrılmamış (yalnız sonuç döner, otomatik akış sayfaya ZORLA atmaz); (c) `check→update` → `available` alanları taşır; (d) `check` reject (mesaj "update not found" / ağ hatası) → `error` ve `hint` korunmuş; (e) `check` reject ve mesaj `unsupported` imli ("not supported" içerir) → `unsupported{kind:"unknown"}`. (f) `import.meta.env.DEV` gerçek modülü hiç kullanmadan: kind `"dev"` → `unsupported{kind:"dev"}` (kontrol hiç yapılmaz — `check` çağrılmadığını spy ile doğrula).
- [ ] **Step 2: `updates.ts` implement et** — testleri geçiren en küçük modül. `checkForUpdates`: önce `packagingKind()`; `"dev"`/`"appimage"`/`"unknown"` → `check` çağırmadan `unsupported`. Yoksa plugin `check()`; `null` → `upToDate`; hata → mesajına göre `error`/`unsupported`. `installUpdate`: `update.downloadAndInstall` progress olaylarını `{event:"progress", contentLength, chunkLength}` üzerinden yüzdeye çevirip `onProgress`'e iletir.
- [ ] **Step 3: `tauriCommands.ts`'e ekle:** `export async function updatePackagingKind(): Promise<string> { return tauriCall<string>("update_packaging_kind"); }` (mevcut `tauriCall` desenine uy).
- [ ] **Step 4: `UpdateModal.test.tsx` (önce kırmızı) + `UpdateModal.tsx`.** Modal: `useDialogA11y` odak tuzağı + Escape; başlık "GitOrbit {version} hazır"; gövde `body` varsa notlar, yoksa sürüm satırı; Linux'ta (kind `"deb"`) ek satır: "Kurulum için sistem yöneticisi parolası istenebilir."; butonlar `[İndir ve Kur]` (onInstall → progress % gösterimi, bitince `relaunch`) ve `[Şimdi Değil]` (onDismiss). Test: available state'te sürüm/not görünür, buton tıklamaları callback tetikler, Escape `onDismiss` çağırır.
- [ ] **Step 5: Shell entegrasyonu.** `Shell.tsx`: mount sonrası tek seferlik (ref bayrağı) `checkForUpdates` `setTimeout(5000)`; `available` → toast `info` "GitOrbit {v} indirilmeye hazır" + modal aç; `unsupported{kind:"appimage"|"dev"}` → sessiz (Ayarlar'dan manuel denetlenebilir); `error` → yalnızca manuel denetimde göster, otomatikte sessiz. Modal `ActionNoticeModal` yanında Şema'nın modal yığınına eklenir.
- [ ] **Step 6: SettingsView "Uygulama Güncellemeleri" kartı.** Mevcut section deseninde: mevcut sürüm (`app_get_info`), kurulum biçimi etiketi (`updatePackagingKind` → kullanıcı-dostu Türkçe karşılık: deb→".deb paketi", appimage→"AppImage", installer→"Windows kurulumu", app→"macOS uygulaması", dev→"geliştirme kurulumu"), `[Güncellemeleri denetle]` butonu, sonuç satırı (`upToDate`/`available`+modal aç/`unsupported`+`openDownloadPage` (opener)/`error`+`errorMessage`+`errorHint`).
- [ ] **Step 7: Kapılar + README + commit.**
  `git commit -m "feat(updater): uygulama ici guncelleme denetimi, modali ve ayarlar karti (WP-11)"`
  Not: `connect-src` CSP değişikliği GEREKMEZ — updater HTTP'yi Rust tarafında yapar.

---

### Görev 4: `release.yml` — tag'den Release'e tam pipeline

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/release-meta.mjs` (tag↔sürüm doğrulama + meta çıktıları — yerel test edilebilir saf betik)
- Create: `scripts/release-meta.test.mjs` → vitest `include`'a ekle (vite.config.ts: `"scripts/**/*.{test,spec}.mjs"`)
- Create: `docs/RELEASE_PROCESS.md` (secret kurulumu + tag akışı + imzalama koşulları — Görev 6'da olgunlaşır, burada iskelet)
- Modify: `docs/RELEASE_CHECKLIST.md` (yeni kapı: release gate özeti)

**Interfaces:**
- Consumes: Görev 2 updater config/pubkey; Görev 1 sürüm hizası.
- Produces:
  - `scripts/release-meta.mjs <tag>` → JSON: `{ ok, version, prerelease, errors: [] }`. Kurallar: tag `^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$`; `version` üç dosyada da (package.json, tauri.conf.json, src-tauri/Cargo.toml) tag ile birebir eşit; önek (`-rc.1`) varsa `prerelease: true`.
  - Release asset adımları: Tauri varsayılan adları kalır (`GitOrbit_0.3.0_x64-setup.exe`, `GitOrbit_0.3.0_x64_en-US.msi`, `gitorbit_0.3.0_amd64.deb`, `GitOrbit_0.3.0_amd64.AppImage`, `gitorbit-0.3.0-1.amd64.rpm`, `GitOrbit_0.3.0_aarch64.dmg`, `GitOrbit_0.3.0_x64.dmg`, `*_app.tar.gz`, `*_app.tar.gz.sig`, `*-setup.exe.sig`, `latest.json`) + elle eklenen `GitOrbit-0.3.0-portable-x64.exe`, `SHA256SUMS.txt`.

- [ ] **Step 1: `release-meta.test.mjs` (önce kırmızı).** Fixtures: `v0.3.0`+üç dosya 0.3.0 → `{ok:true, prerelease:false}`; `v0.4.0`+0.3.0 → `ok:false` ve hatada dosya adı; `v0.3.0-rc.1` (üç dosya 0.3.0) → `ok:true, prerelease:true, version:"0.3.0-rc.1"`; `v0.3` → ok:false; üçü geçersiz `vx` → ok:false. Betik dosya okumalarını `fs`'ten yaptığı için test geçici dizinde sahte manifestlerle kurulur (mevcut depo dosyalarını silme!).
- [ ] **Step 2: `release-meta.mjs` implement et; vitest include'u güncelle; testler yeşil.**
- [ ] **Step 3: `release.yml` yaz.** Tetikler: `push.tags: ["v*"]` + `workflow_dispatch` (girdi: `tag` string, `prerelease` bool). Job'lar:
  - `meta`: checkout → `node scripts/release-meta.mjs "$TAG"` (`TAG` = `github.ref_name` ya da dispatch girdisi; dispatch girdisiyle de aynı kurallar) → `gh release create` varsa atla, yoksa `--draft --title "GitOrbit <tag>"` (dispatch `prerelease` girdisi tag kuralına VE'lenir) → `release_id`, `version`, `prerelease` output'ları.
  - `gates`: ci.yml'deki üç job'un aynısı (frontend kapıları; core fmt/clippy/test; tauri fmt/clippy/test) — ayrı işler, matris build'den ÖNCE (`needs: [meta, gates]`).
  - `build` matrisi (4 ayak):
    ```
    {os: ubuntu-24.04,  label: linux-x64,   target: x86_64-unknown-linux-gnu,  bundles: deb,rpm,appimage}
    {os: windows-latest, label: win-x64,    target: x86_64-pc-windows-msvc,    bundles: nsis,msi}
    {os: macos-latest,   label: mac-arm64,  target: aarch64-apple-darwin,      bundles: dmg,app}
    {os: macos-latest,   label: mac-x64,    target: x86_64-apple-darwin,       bundles: dmg,app}
    ```
    Adımlar: checkout → Linux sistem bağımlılıkları (ci.yml listesi + `rpm` paketi; `libayatana-appindicator3-dev` zaten var) → rust stable + `rustup target add <target>` → node 22 + `npm ci` → `tauri-apps/tauri-action@v0` ile `tagName: <tag>`, `releaseId: meta.release_id`, `projectPath: src-tauri`, `args: "--target <target> --bundles <bundles> <updater-config>"`, `includeUpdaterJson: true`.
    - Updater config enjeksiyonu: adım `if: env.TAURI_SIGNING_PRIVATE_KEY != ''` → `$GITHUB_ENV`e `UPDATER_CONFIG=--config {\"bundle\":{\"createUpdaterArtifacts\":true}}`; `args`'a `${{ env.UPDATER_CONFIG }}`. Secret yoksa build imzasız ama düzgün tamamlanır.
    - macOS koşullu imzalama: `env: APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID / APPLE_SIGNING_IDENTITY` secret'lardan map'lenir (boşsa Tauri imzalamayı atlar — davranış olarak doğrulanmış: env yoksa plain build).
    - Windows portable: bundle sonrası `src-tauri/target/<target>/release/gitorbit.exe` varsa `gh release upload` ile `GitOrbit-<tag>-portable-x64.exe` (WebView2 zorunluluğu notu Görev 6 dokümanında).
    - env genelinde `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` secret'lardan.
  - `finalize`: `needs: [meta, gates, build]`; `gh release download <tag> --dir dist/`; `cd dist && sha256sum * > SHA256SUMS.txt` (imza `.sig` dosyaları da dahil); `gh release upload`; body: `docs/RELEASE_NOTES_v<version>.md` varsa ondan (`gh release edit --notes-file`), yoksa `--generate-notes`; imzasızlık dürüstlük notu: `if: env.APPLE_ID == ''` adımında body'ye "⚠️ Paketler henüz code-sign/notarization yapılmamış — ilk açılış yönergeleri için README/indirme sayfası" ekle; prerelease işaretle; `--draft=false` ile YAYINLA.
  - Hata davranışı: matris ayağı patlarsa finalize `needs` başarısızlığıyla koşmaz → taslak release olduğu gibi kalır, hiçbir şey yayınlanmaz (isteğin "build hatasıysa süreç başarısız" maddesi).
- [ ] **Step 4: Yerel doğrulama.** `scripts/release-meta.mjs` testleri yeşil (Step 2'de eklenen vitest include ile). Workflow YAML'ı için actionlint: `tmpdir=$(mktemp -d /tmp/opencode/actionlint.XXXX)` içine actionlint indir (`curl -sSfL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash | bash`), `actionlint .github/workflows/release.yml` → hatasız çıkmalı. `git ls-remote --tags origin` ile tag çakışması olmadığını doğrula (yeni tag atmadan).
- [ ] **Step 5: RELEASE_PROCESS.md iskeleti:** secrets tablosu (TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD, koşullu APPLE_*, gelecekte WINDOWS_CERTIFICATE değerlendirme notu), anahtar üretme/kurulum adımları (Görev 2 komutlarıyla birebir), tag akışı (`git tag -a v0.3.0 -m "…" && git push origin v0.3.0`), pre-release akışı (`v0.3.1-rc.1` → otomatik prerelease), "secret yokken ne üretilir/ne üretilmez" dürüstlük tablosu. RELEASE_CHECKLIST §4'e release.yml + meta kapısı satırları.
- [ ] **Step 6: Kapılar + README + commit.**
  `git commit -m "feat(ci): release.yml — tag tetiklemeli uc-os installer pipeline + release-meta kapisi (WP-12)"`

---

### Görev 5: GitHub Pages indirme sayfası (`site/`)

**Files:**
- Create: `site/index.html`, `site/site.css`, `site/site.js`, `site/lib/releases.mjs`, `site/lib/releases.test.mjs`
- Create: `.github/workflows/pages.yml`
- Modify: `vite.config.ts` (test include'a `"site/**/*.test.mjs"` ekle)

**Interfaces:**
- Consumes: public repo `burakcnaksy0/gitorbit`, `GET /repos/burakcnaksy0/gitorbit/releases/latest` (prerelease/draft hariç — stable'ın tek kaynağı).
- Produces:
  ```js
  // site/lib/releases.mjs — saf, DOM'suz, test edilebilir
  export function detectPlatform(uaString) → "windows" | "macos" | "linux" | "unknown";
  export function pickAssets(release, platform, osHint) → {
    primary: {label, url, name, size} | null,     // platformun varsayılan installer'ı
    alternatives: [{label, url, name, size}],     // diğer biçimler/mimari
    checksumsUrl: string | null,
  };
  export function releaseView(release) → { version, publishedAt, url };
  ```
  Eşleme kuralları (regex, ada sabitlemek yerine): windows primary `/x64-setup\.exe$/i`, alts: `en-US\.msi`, `portable-x64\.exe`; macos primary osHint `"arm64"`→`/_aarch64\.dmg$/i` yoksa `/_x64\.dmg$/i` (osHint yoksa aarch64 öner + x64 alternatif; `.zip` alternatifi varsa ekle), linux primary `/\.AppImage$/i`, alts: `\.deb$`, `\.rpm$`. Hiçbiri yoksa `primary:null` → JS butonları `release.html_url`'e yönlendirir (Review Focus #5).

- [ ] **Step 1: `releases.test.mjs` (önce kırmızı).** Gerçekçi fixture release (Görev 4 asset adlarıyla): üç OS primary/alternatif seçimi; `detectPlatform` UA örnekleri (Win10 Chrome, macOS Safari arm64=x64 UA ayrımtı yok → "macos", Linux Firefox, iPhone → "unknown"); `pickAssets(release,"linux")` `.deb` de döndürmeli; asset listesi boşsa `primary:null` + çökme yok; `size`'lar `null` güvenle.
- [ ] **Step 2: `releases.mjs` implement et** → vitest yeşil.
- [ ] **Step 3: `site/index.html` + `site/site.css` + `site/site.js`.** Koyu tema (uygulama estetiği: slate-900 paleti), tek dosya CSS, inline SVG logo. Yapı: başlık + `releaseView`'den sürüm/tarih (`Intl.DateTimeFormat("tr-TR")`) → üç büyük buton Windows / macOS / Linux (algılanan OS vurgulu `primary-button`, diğeri ikincil stil) → buton altı satır: primary asset adı + boyutu + alternatifler listesi → "Sistem gereksinimleri" bölümü (Win10+/WebView2, macOS 12+ ayrımı x64/ARM64, Linux webkit2gtk-4.1 notu AppImage için gerekmez/`.deb` bağımlılıkları) → "Kurulum" üç kolon (NSIS sihirbazı + "%PROGRAMFILES%… kısayollar", DMG sürükle-bırak + **imzasız Gatekeeper yönergesi**, AppImage `chmod +x` / `dpkg -i`) → SHA256SUMS.txt linki → "Tüm sürümler" (releases sayfası) + "Kaynak kodu". `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src https://api.github.com; img-src 'self' data:">`; fetch hata/404 → butonlar `releases/latest` HTML URL'ine düşer, sayfa boş kalmaz; imza durumunu asset varlığından değil RELEASE_NOTES'tan okumaz — şimdilik sabit dürüst satır: "Paketler henüz imzalanmamıştır; ilk açılış yönergelerine bakın." (Görev 6 body ile tutarlı).
- [ ] **Step 4: `pages.yml`:** `push.paths: ["site/**"]` main + dispatch; `permissions: {contents: read, pages: write, id-token: write}`; `actions/configure-pages@v5`, `upload-pages-artifact@v4` (`path: site`), `deploy-pages@v4`. `concurrency` bloğu ekle.
- [ ] **Step 5: Yerel önizleme + kapılar.** `npx vitest run` (yeni testler dahil), `npm run build` dokunulmadığını kanıtlar; sayfa için `python3 -m http.server` smoke (opsiyonel, kullanıcıya URL ver). Pages yayın ayarının (Settings → Pages → Source: GitHub Actions) elle açılması RELEASE_PROCESS.md'ye madde olarak eklendi (Görev 6).
- [ ] **Step 6: Commit.** `git commit -m "feat(site): os-algilamali GitHub Pages indirme sayfasi + releases mantik testleri (WP-13)"`

---

### Görev 6: Dokümantasyon sertleştirmesi (README / PROCESS / AGENTS / RELEASE_NOTES)

**Files:**
- Modify: `README.md` (dağıtım bölümü: indirme sayfası link yeri, installer envanteri, updater davranışı, güncellemede veri koruması, bilinçli sınırlar tablosu: imzasız paketler / universal binary yok / ARM64 yok / Linux updater yalnızca .deb / AppImage→sayfa yönlendirmesi; kalite kapılarına release.yml + site testleri)
- Modify: `docs/RELEASE_PROCESS.md` (tamamlar: Pages yayın kaynağı adımı, Gatekeeper/SmartScreen metin şablonu, WINDOWS_CERTIFICATE Authenticode değerlendirme notu — sertifikasız bugün uygulanamaz, dürüstçe "değerlendirme" seviyesinde)
- Modify: `docs/RELEASE_CHECKLIST.md` §4 (v0.3 kapılarıyla yenile, sayıları DOĞRULANMIŞ değerlerle)
- Modify: `AGENTS.md` (kalıcı kapılara ekle: "Sürüm yayını yalnızca release.yml kapılarından geçer; tag sürümü üç manifestle eşit olmak zorundadır")
- Create: `docs/RELEASE_NOTES_v0.3.0.md` (dağıtım sistemi + WP-9..13 özetli; finalize job'ının okuyacağı dosya)

- [ ] **Step 1:** README'yi yukarıdaki maddelerle güncelle — hiçbir iddia doğrulanmamış bırakılmasın (Win/mac paketleri henüz runner'da bile üretilmediyse README "üretilmeye v0.3.0 tag'iyle başlanır" der; Görev 7 sonrası düzeltilecek satırları "doğrulanmayı bekliyor" diye işaretle).
- [ ] **Step 2:** RELEASE_PROCESS.md + CHECKLIST + AGENTS.md + RELEASE_NOTES_v0.3.0.md yaz.
- [ ] **Step 3:** Kapılar + commit. `git commit -m "docs(release): dagitim belgeleri, surum notlari ve kalici kapilar (WP-14)"`

---

### Görev 7: Uçtan uca doğrulama (kullanıcı onaylı etkileşimli görev)

**Ön koşullar (kullanıcı eylemi — plan burada durur ve sorar):**
1. GitHub → repo Settings → Secrets and variables → Actions: `TAURI_SIGNING_PRIVATE_KEY` (Görev 2 özel anahtar dosyasının içeriği) ve `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
2. Settings → Pages → Source: **GitHub Actions**.

- [ ] **Step 1:** Ön koşulları kullanıcıdan teyit al (secret'ların *varlığını* sor, içeriğini ASLA).
- [ ] **Step 2:** Tag: `git tag -a v0.3.0 -m "GitOrbit v0.3.0"` + `git push origin v0.3.0` (kullanıcı onayıyla; push yıkıcı değil).
- [ ] **Step 3: İzleme (gh kurmadan, public API):** `curl -s https://api.github.com/repos/burakcnaksy0/gitorbit/actions/runs?per_page=5` ile run-id/yakala, `.../actions/runs/<id>/jobs` 30sn aralıkla (arka plan shell döngüsü, ≤45 dk). Kırmızı job → log URL'ini kullanıcıyla paylaş, düzelt, tag'ı silip yeniden atma: `git push origin :refs/tags/v0.3.0` yerine sürümü artır (v0.3.1) — tag silme yıkıcı işlem kuralına girer, kullanıcıya sor.
- [ ] **Step 4: Yayın doğrulaması (kanıta dayalı, "runner'da üretildi" ≠ "test edildi"):**
  - `curl -s .../releases/latest` → asset listesi tam mı, `latest.json` var mı (secret kurulduysa), `SHA256SUMS.txt` + `.sig`'ler.
  - Linux'u YERELDE gerçekten test et: `SHA256SUMS.txt`'ten AppImage hash'ini `sha256sum -c` ile doğrula; AppImage'ı `--appimage-extract-and-run` ile masaüstünde çalıştır (kullanıcı oturumu — pencere açılıyor mu); `dpkg-deb -I` meta kontrolü (kurulum yapma, sudo istemez).
  - Win/mac: runner başarısı + asset mevcutu + checksum; **fiziksel cihaz testi yoksa raporda "runner'da doğrulandı, cihazda test edilmedi" yaz.** (isteğin açık yasağı.)
  - Updater zinciri: AppImage güncelleme desteklemez — deb güncellemesi ancak kurulu sistemde test edilir; bugün için kanıt seviyesi: `latest.json`'in imzalı artifact'ları doğru platform anahtarlarıyla (windows-x86_64, darwin-aarch64, darwin-x86_64, linux-x86_64) listelemesi + uygulamanın `check()`'inin AppImage'da `unsupported` dalına düşmesinin yerel manuel denetimi (Settings → Güncellemeleri denetle).
  - Pages: `curl -sI <pages-url>` 200 + asset regex eşleşmesi canlı API ile.
- [ ] **Step 5: README "doğrulanmayı bekliyor" işaretlerini gerçek sonuçlarla değiştir; RELEASE_CHECKLIST'i son durumla mühürle; commit + (onayla) push.**
  `git commit -m "docs(release): v0.3.0 uctan uca dogrulama sonuclari (WP-15)"`
- [ ] **Step 6:** Kullanıcıya platform-platform dürüst durum raporu + sonrakiler: Apple Developer ID / Authenticode secret'ları girildiğinde otomatik imzalamanın devreye gireceği; stable/prerelease akışı.

---

## Öz-değerlendirme notları (plan yazarı)

- Kapsam kontrolü: istekteki §1 (Görev 4), §2 (Görev 4), §3 (Görev 5), §4 (Görev 1+4+6), §5 (Görev 2+3), §6 (Görev 2+4+6), §7 (plan geneli), §8 (görev sırası + kapılar + Görev 7) — açık kalan: ARM64/universal/PPA → bilinçli sınır olarak belgelendi.
- Etkileşimli duraklar: Görev 2 Step 1 (anahtar), Görev 7 Step 1–2 (secret onayı, tag push) — uygulayıcı bunlarda kullanıcıya sormadan geçmez.
