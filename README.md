# GitOrbit — Developer Workspace (v0.1.0 RC)

GitOrbit, yerel Git geliştirme süreçleri ile GitHub hesap yönetimini tek bir modern, hızlı ve güvenli masaüstü uygulamasında birleştiren açık kaynaklı bir **Developer Workspace** ürünüdür.

Masaüstü kabuğu olarak **Tauri 2**, kullanıcı arayüzü için **React 19**, **TypeScript** ve **Tailwind CSS v4**, çekirdek Git ve sistem işlemleri için **Rust** (`gitorbit-core`) kullanılmaktadır.

---

## 🚀 Öne Çıkan Yetenekler

- **Yerel Git Durum Motoru:** Makine tarafından okunabilir (`\0`) çıktı ayrıştırma, dosya değişiklikleri, hızlı indeksleme ve çakışma tespiti.
- **Gelişmiş Staging & Diff:** Satır düzeyinde renklendirilmiş Unified Diff önizleme, güvenli değişiklik iptali (`discard`), büyük dosya budama koruması ve ikili dosya ayrımı.
- **Commit & Kimlik Koruması:** Git Identity Guard (isim/e-posta eksikliğinde commit engelleme), sayfalı geçmiş ve dal bazlı arama.
- **Dal (Branch) Yönetimi:** Yerel ve uzak dallar hiyerarşisi, tek tıkla checkout, güvenli birleştirilmemiş dal silme kontrolleri.
- **Uzak Depo & Senkronizasyon:** Push, Fetch, Pull işlemleri, non-fast-forward push'larda veri kaybını önleyici otomatik force yasağı.
- **Güvenli GitHub Entegrasyonu:** Zero-Token Storage (OAuth belirteçleri yalnızca işletim sistemi Keyring'inde saklanır), Device Flow yetkilendirme, hesap yönetimi ve sayfalı repo listeleme.
- **Sertleştirilmiş Erişilebilirlik & CI:** Klavye navigasyonu (WCAG standartları, Esc ile modal kapatma), 40+ Rust kabul testi, 38 Frontend birim/E2E testi, multi-platform CI (Linux, macOS, Windows).

---

## 🛠️ Teknoloji Yığını

| Katman                | Teknoloji              | Açıklama                                                      |
| --------------------- | ---------------------- | ------------------------------------------------------------- |
| **Masaüstü Kabuğu**   | Tauri 2                | Düşük bellek tüketimli, native pencere ve güvenli IPC köprüsü |
| **Kullanıcı Arayüzü** | React 19 + TypeScript  | Reaktif bileşen mimarisi ve tam tip güvenliği                 |
| **Stil Sistemi**      | Tailwind CSS v4        | HSL tabanlı koyu/açık modern tasarım sistemi ve tokenler      |
| **Çekirdek Sistem**   | Rust (`gitorbit-core`) | Git CLI subprocess yönetimi, SQLite kataloğu, OS Keyring      |
| **Paketleme & Test**  | Vite 8 + Vitest 5      | Hızlı geliştirme ortamı, birim/bileşen ve E2E test koşucu     |

---

## 💻 Desteklenen İşletim Sistemleri

- **Linux:** Ubuntu 22.04 LTS+, Debian 12+, Fedora 38+ (x86_64, aarch64)
- **macOS:** macOS 12 Monterey veya üzeri (Apple Silicon & Intel)
- **Windows:** Windows 10 (Build 19041+) veya Windows 11 (64-bit)

---

## 📋 Kurulum ve Başlangıç

### 1. Ön Koşullar

- **Node.js:** `v20+` (önerilen `v22 LTS`) ve npm `v10+`
- **Rust:** Stable toolchain (`1.80+`)
- **Git CLI:** Yerel terminalde kurulu `git` (minimum `2.23`, önerilen `2.40+` — bkz. `docs/adr/0003-minimum-git-surumu.md`)

#### Linux Sistem Paketleri (Ubuntu/Debian):

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  pkg-config \
  libssl-dev \
  libdbus-1-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

### 2. Projeyi Çalıştırma

```bash
# 1. Bağımlılıkları yükleyin
npm install

# 2. Ön yüz geliştirme sunucusunu başlatın (Tarayıcı önizleme)
npm run dev

# 3. Masaüstü uygulamasını geliştirici modunda başlatın (Tauri 2 Dev)
npm run tauri dev
```

### 3. GitHub Entegrasyonu (Opsiyonel)

GitHub hesap bağlama ve depo listeleme, **OAuth Device Flow** ile çalışır (bkz. `docs/adr/0001-github-device-flow.md`). Varsayılan OAuth App `client_id`'sı uygulama içine gömülüdür; kendi OAuth App kaydınızı kullanmak isterseniz uygulamayı şu ortam değişkeniyle başlatın:

```bash
GITORBIT_GITHUB_CLIENT_ID=<CLIENT_ID> npm run tauri dev
```

> Not: `client_id` RFC 8628 gereği gizli bir sır değildir. **Client secret kullanılmaz ve istenmez.** App oluştururken "Enable Device Flow" seçeneği işaretli olmalıdır. Yerel Git işlevleri (repo, commit, branch, remote) GitHub bağlantısı gerektirmez ve internet olmadan da çalışır.

---

## 🧪 Test ve Kalite Kapıları

Proje katı kalite kapılarıyla korunmaktadır:

```bash
# Kod formatı kontrolü
npm run format:check

# Statik kod analizi (ESLint)
npm run lint

# TypeScript tip kontrolü
npm run typecheck

# Ön yüz birim, bileşen, e2e ve a11y testleri (Vitest)
npm test

# Çekirdek Rust kabul testleri (Faz 2 - Faz 6 kabul testleri)
cargo test --manifest-path crates/gitorbit-core/Cargo.toml --features test-support

# Rust Clippy ve Format denetimi
cargo fmt --manifest-path crates/gitorbit-core/Cargo.toml -- --check
cargo clippy --manifest-path crates/gitorbit-core/Cargo.toml --features test-support --all-targets -- -D warnings

# Masaüstü üretim derlemesi
npm run build
npm run tauri build -- --no-bundle
```

---

## 📁 Proje Dizin Yapısı

```text
GitOrbit/
├── .github/workflows/       # Multi-platform CI (Linux, macOS, Windows)
├── CONTRIBUTING.md          # Katkı rehberi ve kalite kapıları
├── crates/
│   └── gitorbit-core/       # Rust çekirdek alan modeli, Git CLI adaptörü & SQLite
│       ├── src/
│       │   ├── db/          # SQLite migrations ve DAO katmanı
│       │   ├── git/         # Git status, diff, commit, branch, remote motoru
│       │   ├── services/    # Repository & GitHub servisleri
│       │   └── credential_store.rs # OS Keyring soyutlaması
│       └── tests/           # Faz 2-6 resmi entegrasyon kabul testleri
├── docs/                    # PRD, Engineering Spec, Lisans Envanteri ve Sürüm Notları
│   ├── adr/                 # Architecture Decision Record'ları (ADR-0001..0004)
│   ├── LICENSE_INVENTORY.md # Bağımlılık ve güvenlik denetimi
│   ├── RELEASE_CHECKLIST.md # Release kalite kapıları kontrol listesi
│   └── RELEASE_NOTES_v0.1.0.md # Sürüm notları ve bilinen sınırlamalar
├── LICENSE                  # MIT
├── SECURITY.md              # Güvenlik açığı bildirim politikası
├── src/                     # React 19 UI
│   ├── components/          # Ortak bileşenler ve Shell iskeleti
│   ├── features/            # Welcome, Repositories, Changes, History, Branches, GitHub
│   ├── lib/                 # Tauri IPC komut sarmalayıcıları
│   ├── test/                # E2E ve Accessibility test paketleri
│   └── types/               # IPC ve navigasyon tip sözleşmeleri
├── src-tauri/               # Tauri 2 masaüstü uygulaması ve komut yönlendirme
├── package.json             # Web bağımlılıkları ve scriptler
└── vite.config.ts           # Vite + Vitest + Tailwind yapılandırması
```

---

## 🔒 Güvenlik İlkeleri

1. **Token Asla Diske Yazılmaz:** GitHub OAuth belirteçleri SQLite veritabanına, günlük (log) dosyalarına veya IPC yanıtlarına dahil edilmez. Yalnızca işletim sistemi anahtarlığında (`Keyring`) korunur.
2. **Sessiz Veri Kaybı Engeli:** Kirli çalışma ağacı (`dirty worktree`) varken branch checkout veya pull gibi işlemler kullanıcıyı uyarmadan çalıştırılmaz; veri ezilmesini önlemek için işlem güvenle durdurulur.
3. **Şeffaf ve Dürüst Arayüz:** Gerçekleştirilmemiş hiçbir işlem için arayüz sahte başarı bildirimi vermez.

---

## 📦 Dağıtım

v0.1.0, **bundle'sız çalıştırılabilir binary** olarak dağıtılır (`npm run tauri build -- --no-bundle`). Paket formatı (AppImage/.deb) kararı ve gerekçesi: `docs/adr/0004-linux-paketleme-bicimi.md`. İmzalı/notarize edilmiş paket iddiası yoktur; Windows ve macOS derlemeleri CI'da doğrulanır, imzalama sonraki sürüm hedefidir.

---

## 📜 Lisans

Bu proje [MIT lisansı](LICENSE) altında yayınlanmıştır. Bağımlılık lisans uyumluluğu: `docs/LICENSE_INVENTORY.md`. Güvenlik sorunları için: `SECURITY.md`.
# gitorbit
