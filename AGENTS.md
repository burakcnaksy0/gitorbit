# Gybe — Geliştirme Kuralları (agent + insan için kalıcı)

Bu dosya depoda uygulanan işleyişi tanımlar. Yeni bir iş paketine başlamadan
önce buradaki kurallar okunmuş kabul edilir.

## İşleyiş

1. **Bir iş paketi = bir commit.** Kapsamı net, geri döndürülebilir birimlerle
   ilerle; gereksiz refactor yapma, dokunmadığın kodu "düzeltme".
2. **Kapısız commit yok.** İlgili kapılar yeşilmeden commit atılmaz:
   - `cargo test --manifest-path crates/gybe-core/Cargo.toml --features test-support`
   - `cargo fmt` + `cargo check` + `cargo test` (`src-tauri/`)
   - `npx tsc --noEmit` + `npx vitest run` + `npm run build`
     Rust'a dokunulmayan bir pakette Rust kapıları son bilinen haliyle
     geçerlidir; yine de şüphe varsa koştır.
3. **README her işten sonra güncellenir.** Yetenek haritası, "bilinçli
   sınırlar", kalite kapısı sayıları ve sürüm özeti tablosu güncel durumu
   yansıtmalıdır. Test sayıları ve iddialar **doğrulanmış** olmalı — olmayan
   özellik README'ye yazılmaz.
4. **Test borcu ödenir.** Davranış değiştiren her düzeltme hedefli bir
   regresyon testiyle gelir (bulgu kimliğiyle: GO-xx / CB-xx / R-xx).
5. **Doğrulanmamış varsayım yok.** Biçim/sürüm varsayımı yapma; gerçek
   çıktıya bak (ör. `git status --porcelain=v2 -z | od -c`, CLI'ın paketlediği
   `node_modules/@tauri-apps/cli/config.schema.json`).

## Güvenlik ilkeleri (pazarlık konusu değil)

- OAuth token ve refresh anahtarı **yalnızca OS keyring**'de; SQLite'a,
  log'a, URL'e, IPC yanıtına ve frontend state'ine giremez.
- Kullanıcı onayı olmadan yıkıcı Git işlemi (force, hard reset, silme)
  yapılmaz ve UI'a eklenmez; push'u her zaman kullanıcı kendisi yapar.
- Hatalar dürüst gösterilir: sahte başarı yok, `recovery_hint` asla yutulmaz
  (tek gösterim noktası `src/lib/errors.ts`).
- Commit mesajları/girdi yolları doğrulanır; ANSI/kontrol karakteri ve yol
  geçidi girişimleri reddedilir.

## Sürüm yayınlama (v0.2.1+, bkz. docs/adr/0005)

- Sürüm **beş yerde** tutulur ve birlikte değişir: `package.json` +
  `package-lock.json` (`npm version X --no-git-tag-version` ikisini birden
  yapar), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
  `crates/gybe-core/Cargo.toml`. Cargo.lock'lar `cargo metadata` ile tazelenir.
- `CHANGELOG.md`'e `## [X.Y.Z]` başlığıyla (birebir bu biçimde — release
  workflow'u bu başlıktan dilimler) kullanıcıya dönük not eklenir.
- Yayın tetiği **tag push**: `git tag vX.Y.Z && git push origin vX.Y.Z` →
  `release.yml` Linux AppImage + .deb üretip GitHub Release'e koyar. Tag'i her
  zaman kullanıcı atar (push kuralımız geçerli).
- Release sadece Linux artefact yayınlar; macOS/Windows'ta paket yayınlamak
  imza/noter kararı gerektirir (ADR-0005'i yeniden açmadan paket eklenmez).

## Teknik notlar (maziden dersler)

- Kök `Cargo.toml` yok — cargo'yu crate başına çalıştır; core testleri
  `--features test-support` ister.
- `git status --porcelain=v2 -z` biçimi: alanlar **boşluk** ayraçlıdır, XY
  boşluk içerebilir (`.M`) → yol ayrıştırması sabit byte ofsetleriyle yapılır
  (kalibrasyon: git 2.55 gerçek çıktısı). Format testi patlarsa `od -c` ile
  yeniden kalibre et.
- Linked worktree/submodule'da `.git` bir **dosyadır**; git dizini
  `rev-parse --git-common-dir` ile çözülür. `info/exclude` ortak dizinden
  okunur, worktree gitdir'inden değil.
- Tauri config anahtarı: kurulu `@tauri-apps/cli` 2.12.4 şeması yalnızca
  `build.additionalWatchFolders` (camelCase eski ad) kabul eder; güncel
  `additional-watch-directories` Rust tarafında geçerli ama CLI şemasında yok.
  Kurulumlar eşzamanlanana kadar eski ad kalacak.
- Kullanıcıyla iletişim Türkçe; commit mesajları Türkçe, conventional-commit
  önekiyle (`fix(core): … (WP-n)`).
