# ADR-0004 — v0.1.0 Dağıtım Biçimi: Bundle'sız Çalıştırılabilir Binary

- **Durum:** Kabul edildi — ADR-0005 ile kısmen yürürlükten kaldırıldı (v0.2.1+)
- **Tarih:** 2026-11-06
- **İlgili gereksinimler:** Spec v1.1 §11.1, §16.3; PRD §19.2

## Bağlam

Spec, desteklenecek Linux paket formatlarının README'de kesinleştirilmesini istiyor. Paketleme; imzalama, depolama altyapısı ve platform bazlı smoke-test yükü getirir. Spec ayrıca "imzalı paket varmış gibi sunulmamasını" açıkça emreder (§11.2).

## Seçenekler

1. **AppImage:** Dağıtımdan bağımsız, tek dosya; ancak GPG imzalama ve güncelleme zinciri ayrıca tasarlanmalıdır.
2. **.deb:** Debian/Ubuntu hedefli; dağıtım kanalı (PPA/depo) ve `control` bağımlılık yönetimi gerektirir.
3. **Bundle'sız binary (`tauri build -- --no-bundle`):** Hedef makinenin sistem kütüphanelerini (`webkit2gtk-4.1`, `libdbus`) varsayar; kurulum rehberi README'de verilir.

## Karar

**v0.1.0 için Seçenek 3.** Release adayı, platformun sistem bağımlılıklarını karşılayan kullanıcılarına yönelik **çalıştırılabilir binary** olarak dağıtılır. Release artefact'ı üretilirken paket/bundle iddiasında bulunulmaz; Windows/macOS için imzalama/notarization yapılmadığı sürece yalnızca CI derleme doğrulaması yayınlanır (spec §11.2 dürüstlük ilkesi).

## Sonuçlar

- Artı: Sıfır imzalama/noter maliyetiyle ilk sürüm; yanıltıcı "paket hazır" iddiası yok.
- Eksi: Kurulum adımları kullanıcıya kalır (README'de tam komut listesi mevcut).
- Takip (v0.2): AppImage tek dosya hedefiyle `tauri bundle` yapılandırması, checksum üretimi ve temiz ortam smoke-testi ayrı faz olarak planlanacak; karar bu ADR revize edilerek kesinleştirilecek.
