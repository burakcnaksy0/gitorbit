# ADR-0005 — Release Kanalı: Linux AppImage + .deb, İmzasız, GitHub Release

- **Durum:** Kabul edildi
- **Tarih:** 2026-11-09
- **İlgili:** ADR-0004 (bu ADR onun "Takip (v0.2)" maddesini sonuçlandırır); Spec v1.1 §11.2 (dürüstlük ilkesi)

## Bağlam

ADR-0004, bundle'sız binary kararını "v0.2'de AppImage ile yeniden
değerlendir" notuyla almıştı; bu ADR o "Takip (v0.2)" maddesini
sonuçlandırır. Proje açık kaynak yayınlandığına göre artık bir
**indirme kanalı** gerekiyor: hedef kullanıcının `git clone` + saatlerce derleme
yapmadan deneyebilmesi için tek dosya çalıştırılabilir şart. Aynı anda
dürüstlük ilkesi geçerli: imzalama/noter onayımız yok ve bu, paket üzerinde
varmış gibi duramaz.

## Seçenekler

1. **AppImage (+ .deb) + GitHub Release:** `tauri-apps/tauri-action` tag push'ta
   üretir, GitHub Release'e koyar. İmzasızdır; AppImage POSIX sistemlerde
   doğrudan çalışır, .deb Debian/Ubuntu'da bağımlılıkları paket yöneticisine
   bırakır.
2. **flathub/snap/PPA ekosistemlerine giriş:** Görünürlük artırır ama
   platform hesapları, inceleme süreçleri ve bakım yükü demek — tek kişilik
   projede şu an kapsam dışı.
3. **macOS/Windows paketlerinin de yayınlanması:** İmzasız macOS `.dmg`
   Gatekeeper'ın isolation önbelleği nedeniyle ikinci açılışta sistematik
   olarak engellenir (sahte "virüslü" algısı); imzasız Windows `.msi` SmartScreen
   uyarısı üretir. Dürüstlük ilkesi gereği "paket var" izlenimi veren ama
   kullanıcıyı sebepsiz güvenlik duvarıyla karşılayan bir yayın yapmayız.

## Karar

**Seçenek 1 — v0.2.1'den itibaren Linux-only release kanalı.**

- Tetik: `v*` tag push → `.github/workflows/release.yml`
- Artefact'lar: `Gybe_0.2.1_amd64.AppImage`, `Gybe_0.2.1_amd64.deb`
  (workflow `--bundles appimage,deb` geçirir; `targets:"all"` rpm gibi
  istenmeyen çıktılara izin vermemek için workflow tarafında sabitlenir)
- GitHub Release: otomatik oluşturulur, gövde CHANGELOG'un ilgili bölümünden
  üretilir; **imzasız olduğu release metninde açıkça yazar**
- macOS/Windows: ADR-0004'teki gibi **yalnızca CI derleme doğrulaması**
  (`--no-bundle`) yayılır; imza/noter hikâyesi netleşene kadar paket
  yayınlanmaz (Seçenek 3'ün gerekçesi geçerli)
- Auto-update bilinçli olarak YOK: updater altyapısı imza anahtarı yönetimi
  gerektirir (bkz. ADR-0004 sonuçları); kullanıcı güncellemeyi Release
  sayfasından kendisi indirir

## Sonuçlar

- Artı: `chmod +x && ./Gybe.AppImage` ile sıfır kurulum denemesi; .deb ile
  Debian/Ubuntu'da paket yöneticisi entegrasyonu; yayın süreci tamamen
  otomatik ve depoda tanımlı.
- Artı: README/Release metninde "neden imzasız" ve "neden Linux" dürüstçe
  durur — spec §11.2'yle uyumlu.
- Eksi: AppImage çalıştırmak için hedef makinede `libwebkit2gtk-4.1` gibi
  sistem kütüphaneleri hâlâ gerekir (AppImage bunları içermez) — README'de
  tek satırlık apt komutu olarak verilmeye devam eder.
- Eksi: Windows/macOS kullanıcıları kaynaaktan derlemeye devam eder; bu
  Release notlarında açıkça belirtilir.
- Takip (v0.3+): macOS Developer ID + notarization (paralı Apple Developer
  hesabı gerektirir), GPG checksum imzası, flatpak paketi değerlendirilecek.
