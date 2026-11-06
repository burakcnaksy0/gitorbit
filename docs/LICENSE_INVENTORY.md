# GitOrbit — Bağımlılık Lisans ve Güvenlik Envanteri (Faz 7)

Bu belge, GitOrbit projesinde kullanılan tüm doğrudan çalışma zamanı (runtime) ve geliştirme zamanı (dev) bağımlılıklarının lisans türlerini, kullanım amaçlarını ve güvenlik denetim sonuçlarını içerir.

---

## 1. Lisans Uyumluluk Özeti

GitOrbit, ticari ve açık kaynak kullanımına uygun, telif feragatli ve hoşgörülü (permissive) lisanslara sahip kütüphanelerle inşa edilmiştir. GPL / AGPL gibi copyleft kısıtlayıcı lisanslara sahip hiçbir çalışma zamanı kütüphanesi kullanılmamıştır.

| Kategori | Baskın Lisans Türleri | Uyumluluk Durumu |
|---|---|---|
| **Masaüstü & Sistem (Rust)** | MIT / Apache-2.0 | Uyumlu |
| **Ön Yüz & Arayüz (Web)** | MIT / ISC / Apache-2.0 | Uyumlu |
| **Geliştirme & Test Araçları** | MIT / Apache-2.0 / BSD-3-Clause | Uyumlu |

---

## 2. Rust Bağımlılıkları Envanteri (`crates/gitorbit-core` & `src-tauri`)

| Paket | Sürüm | Lisans | Kullanım Amacı | Güvenlik / İzolasyon Notu |
|---|---|---|---|---|
| `tauri` | `2.x` | MIT / Apache-2.0 | Masaüstü kabuğu, IPC köprüsü ve pencere yönetimi | İzolasyonlu IPC kanalı, context isolation aktif. |
| `tauri-plugin-opener` | `2.x` | MIT / Apache-2.0 | Harici URL açıcı (OAuth tarayıcı yönlendirmesi) | Yalnızca `https://` protokolü ile sınırlandırılır. |
| `rusqlite` | `0.33` (bundled) | MIT | Yerel repo kataloğu ve metadata saklama | Token saklanmaz; SQLite veritabanı yerel kullanıcı dizinindedir. |
| `keyring` | `2.x` | MIT / Apache-2.0 | İşletim sistemi güvenli kimlik deposu (Secret Service / Keychain / Credential Manager) | Token'lar asla diskte düz metin tutulmaz. |
| `ureq` | `2.x` | MIT / Apache-2.0 | Senkron GitHub Device Flow ve Repository HTTP istemcisi | TLS 1.3 zorunlu; ekstra asenkron runtime bağımlılığı gerektirmez. |
| `serde` / `serde_json` | `1.x` | MIT / Apache-2.0 | IPC ve veri serileştirme / deserileştirme | Tip güvenli serde mapping. |
| `chrono` | `0.4` | MIT / Apache-2.0 | UTC zaman damgası ve ISO-8601 tarih formatlama | Bellek güvenli zaman işlemleri. |
| `uuid` | `1.x` | MIT / Apache-2.0 | Hesap kimlikleri ve oturum belirteçleri (v4) | Kriptografik rastgelelik (`v4`). |
| `tempfile` | `3.17` (dev) | MIT / Apache-2.0 | İzolasyonlu geçici test depoları ve sandbox | Sadece test modunda aktiftir. |

---

## 3. Web & Ön Yüz Bağımlılıkları Envanteri (`package.json`)

| Paket | Sürüm | Lisans | Kullanım Amacı | Dağıtım Etkisi |
|---|---|---|---|---|
| `react` | `19.1.0` | MIT | Bildirime dayalı UI bileşenleri | Web derlemesine dahil edilir (`dist/`). |
| `react-dom` | `19.1.0` | MIT | React DOM renderer | Web derlemesine dahil edilir (`dist/`). |
| `@tauri-apps/api` | `^2` | MIT / Apache-2.0 | Tauri IPC çağrıları ve sistem olayları | Web derlemesine dahil edilir. |
| `lucide-react` | `^1.63.0` | ISC | Arayüz vektörel ikonları | Tree-shaken ikonlar, telif problemi yoktur. |
| `tailwindcss` | `^4.3.3` | MIT | Tasarım sistemi ve atomik CSS motoru | Yalnızca CSS çıktısı üretilir (`dist/`). |
| `typescript` | `~6.0.3` (dev) | Apache-2.0 | Statik tip denetimi ve IPC arayüz sözleşmeleri | Derleme aracıdır; üretim paketine girmez. |
| `vite` | `^8.0.16` (dev) | MIT | Modüler geliştirme sunucusu ve üretim bundler | Derleme aracıdır. |
| `vitest` | `^5.0.5` (dev) | MIT | Birim, bileşen ve E2E test koşucusu | Test ortamıdır. |
| `eslint` | `^10.13.0` (dev) | MIT | Statik kod analizi ve kalite kuralları | Geliştirme aracıdır. |
| `prettier` | `^3.9.10` (dev) | MIT | Otomatik kod biçimlendirici | Geliştirme aracıdır. |

---

## 4. Güvenlik Denetimi Raporu (Security Audit)

- **Runtime Bağımlılıkları**: Üretim paketine dahil edilen tüm kütüphanelerde sıfır bilinen yüksek/kritik güvenlik açığı bulunmaktadır.
- **Geliştirme Bağımlılıkları (Dev Toolchain)**:
  - `npm audit` taramasında, `eslint` ve `typescript-eslint` geliştirici aracının dahili bağımlılığı olan `minimatch` kütüphanesinde orta seviye (moderate) bir DoS uyarısı raporlanmıştır.
  - Bu uyarı yalnızca geliştiricinin yerel makinesinde lint çalıştırılması sırasında geçerlidir; derlenmiş olan masaüstü binary paketine veya web `dist` bundle'ına **kesinlikle dahil edilmez**.
  - Gelecek küçük sürümde upstream `typescript-eslint` güncellemesi ile bu araç paketi yükseltilecektir.
