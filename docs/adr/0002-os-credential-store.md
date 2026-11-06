# ADR-0002 — Token Saklama: OS Credential Store, Fallback YASAK

- **Durum:** Kabul edildi
- **Tarih:** 2026-11-06
- **İlgili gereksinimler:** PRD ADR-006; Spec v1.1 §6.2, §7.1, §11.1; GT-011

## Bağlam

GitHub access token'ları uygulamanın en hassas verisidir. Spec, token'ın düz metin dosyaya, SQLite'a veya loga düşmesini mutlak olarak yasaklar; keyring kullanılamıyorsa "güvenli hata" davranışı zorunludur.

## Seçenekler

1. **`keyring` crate (v2):** Linux'ta Secret Service (D-Bus), macOS'ta Keychain, Windows'ta Credential Manager üzerinde tek tip API. Bakımlı, yaygın kullanımlı, MIT/Apache-2.0.
2. **Platform bazlı elle implementasyon:** Üç OS için ayrı kod ve test maliyeti; hata yüzeyi büyük.
3. **Şifreli dosya tabanlı depo (ör. age/sodium):** "Keyring yoksa çalışır" avantajı sağlar ancak uygulama kendi kasa anahtarını da diskte tutmak zorunda kalacağından tehdit modelini zayıflatır ve spec'in "düz metin fallback yok" ilkesinin ruhuna aykırı bir kaydırma alanı yaratır.

## Karar

**Seçenek 1 — `keyring` crate v2**, `OsCredentialStore` soyutlaması arkasında (trait: `CredentialStore`). Servis katmanı yalnızca trait ile konuşur; testler in-memory mock kullanır.

Zorunlu davranışlar:

- Keyring erişilemezse `CREDENTIAL_STORE_UNAVAILABLE` döner; **hiçbir düz metin yedeği yazılmaz** (GT-011 kabul testi).
- SQLite `github_accounts` tablosu yalnızca `credential_ref` referansı tutar; token alanı bulunmaz (faz6 kabul testi: `test_ac1_token_not_in_db_...`).
- Hesap ayırma, hem keyring kaydını hem DB metadata'sını temizler; idempotent silme.
- Linux headless (D-Bus Secret Service yok) ortamında hata mesajı kullanıcıya sorumlu çözümü (keyring kurulumu) açıklar.

## Sonuçlar

- Artı: Platform standartlarına uygun saklama; sıfır disk yazımı; denetlenmesi tek dosya (`credential_store.rs`).
- Eksi: Linux'ta `libdbus-1-dev` / Secret Service çalışma zamanı bağımlılığıdır; Docker/CI gibi headless ortamlarda GitHub özellikleri bilinçli olarak devre dışıdır (README "Bilinen Sınırlamalar").
