# ADR-0001 — GitHub Kimlik Doğrulama: OAuth Device Flow (Public Client)

- **Durum:** Kabul edildi
- **Tarih:** 2026-11-06
- **İlgili gereksinimler:** Spec v1.1 §6.2, §16.1; PRD §14.3

## Bağlam

GitOrbit, masaüstünde çalışan ve merkezi backend'i olmayan (ADR: "MVP'de backend yok") bir public client'tır. GitHub API erişimi için bir OAuth akışı seçilmelidir. Kısıtlar:

- Uygulama binary'sine `client_secret` gömülmesi **yasaktır** (spec §6.2).
- Token; loga, SQLite'a, UI state'ine veya URL query'ye düşmemelidir.
- Redirect/deep-link callback altyapısı (yerel HTTP sunucu veya custom scheme) ekstra yüzey alanı ve platform varyansı (Wayland/X11, tarayıcı odak davranışı) getirir.

## Seçenekler

1. **OAuth App + Authorization Code + loopback callback:** Redirect doğrulaması, state/PKCE yönetimi ve tarayıcı entegrasyonu gerektirir; masaüstünde callback çakışması ve firewall/sandbox sorunları bilinmektedir.
2. **OAuth App + Device Flow (RFC 8628):** `client_secret` gerektirmez; kullanıcı tarayıcıda tek seferlik `user_code` girer; uygulama `device_code` ile periyodik token polling yapar.
3. **GitHub App:** Organizasyon yönetimi ve kurulum akışı MVP kapsamının ötesindedir; kişisel kullanım senaryosunda ek karmaşıklık yaratır.

## Karar

**Seçenek 2 — Device Flow.** GitHub "Enable Device Flow" işaretli bir OAuth App kullanılır. `client_id` RFC 8628 gereği gizli sır değildir ve binary'ye gömülür (`DEFAULT_GITHUB_CLIENT_ID`); fork/özel kayıt senaryoları için `GITORBIT_GITHUB_CLIENT_ID` ortam değişkeni ile override edilebilir. Scope minimumda tutulmuştur: `read:user,public_repo`.

Uygulama içi güvenlik önlemleri:

- `device_code` yalnızca Rust belleğinde (`PendingDeviceFlow`) yaşar; IPC sözleşmesinde (`DeviceFlowSession`) alan olarak bulunmaz (kabul testi: IPC izolasyonu).
- Ön yüze dönen `session_token` kriptografik sır değil, tek oturumlu korelasyon ID'sidir; uyuşmazlıkta `oauth_state_mismatch` ile reddedilir (GT-012).
- Token, exchange edilir edilmez **yalnızca** OS credential store'a yazılır (ADR-0002).

## Sonuçlar

- Artı: Backend, callback sunucusu ve secret yönetimi gerekmez; headless olmayan tüm masaüstü ortamlarında çalışır.
- Eksi: Etkileşimli olmayan (CI/headless) ortamlarda login mümkün değildir — bu zaten desteklenen bir senaryo değildir.
- Eksi: Kullanıcı kodu girişi iki adımlıdır; UI `user_code` ve doğrulama URL'sini belirgin göstererek bunu telafi eder.
- Takip: Scope genişletme gereksinimi (ör. PR yönetimi, P1) yeni bir ADR ile değerlendirilmelidir.

## Ek — 2026-11-09

Metindeki `GITORBIT_GITHUB_CLIENT_ID` ortam değişkeni isim değişikliğiyle
`GYBE_GITHUB_CLIENT_ID` oldu (ADR, tarihî kayıt olarak eski adla duruyor).
Device Flow kararı değişmedi; yalnızca varsayılan OAuth App artık proje
sahibinin kişisel hesabı yerine **gybeio organizasyonu** altına kayıtlı
(client_id sır olmadığı için kod yorumunda + CHANGELOG'da notlu). Eski kişisel
App, eski kurulumlar göç edene kadar silinmeyecek.
