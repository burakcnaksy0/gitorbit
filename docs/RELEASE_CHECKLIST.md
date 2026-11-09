# Gybe — Sürüm Kontrol Listesi (Release Checklist v0.1.0)

Bu liste, Gybe'in her kararlı sürüm veya sürüm adayı (Release Candidate) öncesinde doğrulanması gereken zorunlu kalite kapılarını tanımlar.

---

## 1. Kod Kalitesi ve Statik Kapılar

- [x] **Prettier Kod Biçimlendirme**: `npm run format:check` hatasız geçiyor.
- [x] **ESLint Statik Kod Analizi**: `npm run lint` sıfır hata ve sıfır uyarı ile tamamlanıyor.
- [x] **TypeScript Tip Güvenliği**: `npm run typecheck` (`tsc --noEmit`) sıfır hata veriyor.
- [x] **Rust Kod Biçimlendirme**: `cargo fmt --check` hem `crates/gybe-core` hem de `src-tauri` için temiz.
- [x] **Rust Clippy Lint**: `cargo clippy --all-targets -- -D warnings` sıfır uyarı/hata ile geçiyor.

---

## 2. Test ve Doğrulama Matrisi

- [x] **Frontend Birim & Bileşen Testleri**: 9 test paketi, 40/40 birim/bileşen testi başarılı.
- [x] **E2E Kullanıcı Akışı Testi**: `workflow.test.tsx` ile repo keşfi, staging, commit, branch, sync ve GitHub akışı başarılı.
- [x] **Erişilebilirlik (a11y) & Klavye Testi**: `accessibility.test.tsx` ile landmark rolleri, erişilebilir isimler ve modal tuş kontrolleri başarılı.
- [x] **Çekirdek Rust Kabul Testleri**: `crates/gybe-core` altında 40 kabul testi (`faz2`, `faz3`, `faz4`, `faz5`, `faz6`) ve 10 modül birim testi yeşil.
- [x] **Veritabanı Migration Testleri**: SQLite schema v1 ve v2 migration'ları temiz ortamda test edildi.

---

## 3. Güvenlik ve Veri Bütünlüğü

- [x] **Token İzolasyonu**: GitHub OAuth tokenleri yalnızca işletim sistemi Keyring'inde saklanıyor; SQLite veya loglara yazılmıyor.
- [x] **IPC İzolasyonu**: `DeviceFlowSession` modelinde `device_code` ön yüze aktarılmıyor.
- [x] **Yıkıcı İşlem Koruması**: Dirty working tree durumunda checkout ve pull işlemleri veri kaybını önlemek için güvenle reddediliyor.
- [x] **Bağımlılık Denetimi**: Lisans envanteri (`docs/LICENSE_INVENTORY.md`) tamamlandı; çalışma zamanında bilinen güvenlik açığı bulunmuyor.

---

## 4. Platform ve Dağıtım Doğrulaması

- [x] **Web Bundle**: `npm run build` ile `dist/` paketi 60 KB CSS ve 338 KB JS boyutunda hatasız üretiliyor.
- [x] **Linux Desktop Build**: `npm run tauri build -- --no-bundle` ile çalıştırılabilir binary oluşturulabiliyor.
- [x] **Multi-Platform CI**: `.github/workflows/ci.yml` üzerinde Linux, macOS ve Windows derleme adımları tanımlandı.
- [x] **Dokümantasyon**: `README.md`, kurulum adımları, sistem bağımlılıkları ve bilinen sınırlamalar eksiksiz.
