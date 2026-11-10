# Değişiklik Günlüğü — Gybe

Biçim: [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/); sürümlemede
SemVer. Sürüm notlarının ayrıntılı kaynakları `docs/RELEASE_NOTES_*.md`.

## [0.2.3] — 2026-11-10

### Düzeltildi

- **Windows: işlem başlatırken arka planda konsol (terminal) penceresi açılması
  ve odak kaynaklu takılmalar (saha raporu):** Gybe Windows'ta konsolsuz GUI alt
  sistemi olarak çalışır; türetilen her `git`/`where` süreci `CREATE_NO_WINDOW`
  bayrağı olmadan kendi konsolunu ayırıp bir an görünür oluyor, ön plana çıkarak
  uygulamayı donmuş hissettiriyordu. Tüm süreç doğurtmaları artık tek bir
  constructor'dan geçiyor ve bayrak Windows'ta her doğurtmaya uygulanıyor
  (`git_command()` + regresyon testleri).
- **Açılışta kısa pencere donması:** `app_get_environment` senkron komutuydu;
  iki süreç doğurtan tespiti ana iş parçacığında çalıştırıyordu (GO-01
  denetiminin kaçırdığı tek komut). Blocking havuzuna taşındı.

Not: makine Windows üzerinde doğrulanamadı (geliştirme ortamı Linux); düzeltme
mekanizma temelli ve yeni regresyon testleriyle kilitlidir — v0.2.3 paketi
çıktığında Windows'ta ilk deneyen geri bildiriminiz değerli.

## [0.2.2] — 2026-11-09

### Eklendi

- **Çapraz platform release kanalı (ADR-0005 tadilatı):** `v*` tag push'u artık
  tek GitHub Release'e üç platformun paketini koyar — Linux AppImage + .deb,
  macOS **universal** `.dmg` (Apple Silicon + Intel), Windows NSIS `.exe`.
  Paketlerin tümü **imzasız kalmaya devam eder**; release gövdesi kurulum ve
  ilk-açılış (Gatekeeper/SmartScreen) talimatlarını otomatik içerir
  (`docs/release-footer.md`).

### Düzeltildi

- Release gövdesi artık güvenilir biçimde CHANGELOG dilimi + dipnottan
  kurulur (v0.2.1'de tauri-action'a devredilince gövde commit mesajı olarak
  kalmıştı); release oluşturma işi üç build job'ı toplayan ayrı bir job'a
  taşındı.

### Değişti

- **Depo ve OAuth kimliği `gybeio` organizasyonuna taşındı:** depo adresi
  `github.com/gybeio/gybe` (eski adres redirect ediyor); varsayılan
  `client_id` artık organizasyon altındaki OAuth App'e ait. Refresh token'lar
  client_id'ye bağlı olduğundan v0.2.1'den yükselten kurulumlar GitHub'ı **bir
  kez yeniden bağlamak** zorundadır (yalnızca GitHub entegrasyonunu
  kullanıyorsan; yerel Git özellikleri etkilenmez). Eski (kişisel hesap
  altındaki) OAuth App, eski kurulumlar göç edene kadar yayından
  kaldırılmayacak. `GYBE_GITHUB_CLIENT_ID` override'ı aynen geçerli.

## [0.2.1] — 2026-11-09

### Değişti

- **İsim:** Proje **GitOrbit → Gybe** olarak yeniden adlandırıldı (GitHub'da
  aynı adla yayında olan başka bir açık kaynak Git istemcisiyle çakışma
  nedeniyle). Keyring hizmet adı ve veri dizini değişti: mevcut kurulumlarda
  GitHub hesabının bir kez yeniden bağlanması, depoların bir kez eklenmesi
  gerekir.

### Eklendi

- **OAuth token otomatik yenileme:** cihaz kodu yanıtındaki `refresh_token`
  yalnızca OS anahtarlığında saklanır; bitişe 2 dk kala şeffaf refresh grant,
  rotlanan anahtar güncellemesi, reddedilirse "yeniden bağlan" önerisi
  (`AUTH_EXPIRED`).
- **Release kanalı (ADR-0005):** `v*` tag push'u Linux **AppImage + .deb**
  üretip GitHub Release'e yükler (imzasız — README/ADR'de açıkça belirtilir).
  macOS/Windows için CI derleme doğrulaması sürer.
- **İngilizce README:** `README.md` İngilizce ana dosya oldu, orijinal Türkçe
  metin `README.tr.md`'ye taşındı; `docs/screenshots/` altında demo vereli
  ekran görüntüleri galerisi.

### Düzeltildi / İyileştirildi (uçtan uca denetim — WP-0…WP-8)

- Eşzamanlı token yenileme koruması, dürüst token hatası, SQLite WAL bakımı.
- Arayüzde çift-tık/lifecycle ve bayat-yanıt yarış koşulları (seq-guard).
- Git subprocess'lerinde süreç/pipe/zaman-aşımı sertleştirmesi; kimlik
  bilgisi sızdırma kapıları (askpass tüpü, env redaksiyonu).
- Tauri komutları ana olay döngüsünden alındı; kilit boşlukları kapatıldı.
- fetch/pull token simetrisi, tek örnek (single-instance) pencere,
  detached HEAD/dal düzeltmeleri.
- `recovery_hint` tek merkezden gösterim, poison-mutex kurtarması,
  device-flow istemci hız sınırlama (`slow_down` uyumu), commit mesajı
  kontrol-karakteri kapısı.
- Performans: `git status` tek çağrıya indirildi, diff sınırlı okuma,
  linked-worktree'te ignore hedefinin `git-common-dir` ile çözümü.
- Erişilebilirlik: 15 dialogun tümünde odak tuzağı + Escape + odağın
  tetikleyiciye dönmesi; `prefers-reduced-motion` desteği.
- Geliştirme yapılandırması: `tauri dev` artık `crates/` değişimini izler
  (`build.additionalWatchFolders`).
- **Kalite kapıları yeniden gerçek anlamda yeşil:** `npm run lint` ve
  `clippy -D warnings` kapıları ara birimde sessizce kırık durumdaydı (React
  Compiler'ın saflık kuralları + birikmiş clippy uyarıları). Ref-in-render
  desenleri saf hâline çevrildi (çakışma sayacı state'e, palet sıfırlaması
  koşullu mount'a, repo-değişimi reset'i `key` remount'ına taşındı); tüm
  davranışlar mevcut testlerle kilitli (bir palet testi yeni sözleşmeye göre
  güncellendi: 130 → 129).

## [0.2.0] — 2026-11

Günlük kullanım paketi (12/12 madde):

- **Yoksay (gitignore):** untracked satırdan `.gitignore` (versiyonlu) veya
  `.git/info/exclude` (yalnız bu makine) seçeneği; `check-ignore` doğrulaması.
- **Stash merkezi:** açıklamalı stash, untracked dahil etme; girdi başına
  Pop / Apply / onaylı Sil; çakışmada stash korunur.
- **Otomatik kontrol (auto-fetch):** 1–60 dk aralıkla tüm depolar fetch;
  ↑/↓ rozetleri; otomatik pull yok.
- **OS bildirimleri:** clone/yayınlama/push reddi pencere arkadayken bildirilir.
- **Kontrollü amend:** yalnızca en son ve push edilmemiş commit mesajı
  düzenlenebilir (`AMEND_PUSHED` koruması).
- **Komut paleti (Ctrl+K):** sekmeler/depolar/dallar/işlemler üzerinde fuzzy
  arama, son komut geçmişi.
- **Klasör sürükle-bırak:** depo olarak aç / başlat / GitHub'da yayınla.
- **Commit grafiği:** lane hesaplı SVG grafik, merge kavşakları, SHA'dan
  türeyen renk paleti.
- **Çakışma yardımcı bandı:** X/Y sayacı, Bizimki/Theirs/Editör eylemleri,
  iki adımlı iptal.
- **Tümünü eşitle:** depo depo ✓/⏭/✗ raporlu tur, ilerleme modalı, durdurma.
- **Depo sabitleme (pin):** SQLite `repositories.pinned` (migration 3).
- **İlk çalışma rehberi:** 3 adımlık onboarding; gerçek hesaptan okunan tikler.
- GitHub OAuth cihaz kodu akışına `slow_down` ve interval desteği.

## [0.1.0] — 2026-11

İlk kararlı sürüm — çekirdek (Faz 2–7):

- Depo kataloğu (SQLite), çoklu depo, son açılanlar.
- Durum/diff/stage/commit akışı; satır düzeyi renkli unified diff; discard
  onayı; büyük dosya ve ikili dosya korumaları.
- Dal yönetimi: yerel/uzak listesi, checkout/create/delete/merge, unmerged
  silme koruması.
- Remote: push/fetch/pull, non-fast-forward dürüst hatası (otomatik force yok).
- GitHub OAuth Device Flow (RFC 8628) + token yalnızca OS keyring'de.
- Git Identity Guard (eksik isim/e-postada commit engeli), sayfalı geçmiş.
- Çok platformlu CI (Linux/macOS/Windows derleme matrisi), erişilebilirlik
  temelleri.
