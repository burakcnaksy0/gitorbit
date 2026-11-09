# Gybe'a Katkı Rehberi

Gybe'e ilgi gösterdiğiniz için teşekkürler! Katkılar; hata düzeltmeleri, yeni özellikler, dokümantasyon ve testler dahil her biçimde hoş karşılanır.

## İçindekiler

- [Geliştirme ortamı](#geliştirme-ortamı)
- [Çalışma akışı](#çalışma-akışı)
- [Kalite kapıları](#kalite-kapıları)
- [Commit ve PR kuralları](#commit-ve-pr-kuralları)
- [Mimari sınırlar](#mimari-sınırlar)
- [Güvenlik ilkeleri](#güvenlik-ilkeleri)

## Geliştirme ortamı

Ön koşullar: **Node.js v20+** (önerilen v22 LTS), **Rust stable (1.80+)**, **Git CLI 2.23+** (önerilen 2.40+) ve Linux'ta README'de listelenen sistem paketleri.

```bash
npm install
npm run dev        # Tarayıcı önizleme (Vite)
npm run tauri dev  # Masaüstü uygulama (Tauri 2)
```

Üretim derlemesi:

```bash
npm run build
npm run tauri build -- --no-bundle
```

Paket formatı kararı (v0.1.0 itibarıyla `--no-bundle` binary) ve gerekçesi için: `docs/adr/0004-linux-paketleme-bicimi.md`.

## Çalışma akışı

1. Sorun veya özellik için önce bir issue açın (küçük yazım düzeltmeleri hariç).
2. `main` dalından kısa ömürlü bir feature branch oluşturun.
3. Küçük, tek sorumluluğu olan değişiklikler halinde çalışın.
4. Her değişiklik ilgili testlerle birlikte gelmelidir (aşağıya bakın).
5. Pull request'i açmadan önce tüm kalite kapılarını yerelde çalıştırın.

## Kalite kapıları

Bir PR ancak aşağıdaki komutların **tamamı** sıfır hata ile geçerse merge edilebilir:

```bash
# Ön yüz
npm run format:check
npm run lint
npm run typecheck
npm test

# Rust çekirdek + Tauri kabuğu
cargo fmt --manifest-path crates/gybe-core/Cargo.toml -- --check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path crates/gybe-core/Cargo.toml --features test-support --all-targets -- -D warnings
cargo test --manifest-path crates/gybe-core/Cargo.toml --features test-support
```

Testi devre dışı bırakarak, atlayarak veya zayıflatarak yeşil kapı elde etmeye çalışmayın. Çalıştırılamayan bir test varsa PR açıklamasında nedenini belirtin.

Rust entegrasyon testleri **geçici dizinlerde gerçek Git repository'leri** oluşturur; geliştiricinin kendi depolarına asla dokunmaz. Ortamda `git` bulunmayan makinelerde bu testler `test-support` feature'ı ile işaretlidir.

## Commit ve PR kuralları

- [Conventional Commits](https://www.conventionalcommits.org/) formatı: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`.
- Bir commit tek mantıksal değişikliği içerir.
- PR açıklamasında: ne değişti, neden değişti, nasıl test edildi ve bilinen sınırlamalar yazılır.
- UI değişikliğinde ekran görüntüsü veya kısa hareketli görüntü ekleyin.

## Mimari sınırlar

- **React UI** yalnızca tanımlı Tauri command'lerini çağırır; Git protokol mantığı bilmez.
- **Rust servis katmanı** iş kurallarının ve güvenlik kontrollerinin evidir.
- UI presentation tipleri (`src/types/navigation.ts`) yalnızca `Shell.tsx` içinde IPC tiplerinden türetilir; sahte/uydurma veri taşımaz.
- Yeni komut eklerken: `src-tauri/src/lib.rs` (command), `crates/gybe-core` (servis mantığı), `src/types/ipc.ts` (tip sözleşmesi) ve `src/lib/tauriCommands.ts` (sarmalayıcı) birlikte güncellenir.

## Güvenlik ilkeleri

Kod incelemede otomatik reddedilen davranışlar:

- Kullanıcı girdisini shell string birleştirmesiyle komuta geçirmek (argüman dizisi ZORUNLU).
- Token/parola/private key'i SQLite'a, loglara, IPC yanıtına veya düz metin dosyaya yazmak.
- `reset --hard`, `clean -fd`, force push gibi yıkıcı işlemleri otomatik veya onaysız çalıştırmak.
- Repository kökü dışına çıkan dosya yollarıyla işlem yapmak (path traversal).
- OAuth client secret'ını istemciye gömmek (Device Flow public-client kullanılır; bkz. `docs/adr/0001-github-device-flow.md`).

Güvenlik açığı bildirmek için: `SECURITY.md`.
