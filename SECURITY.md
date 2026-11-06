# Güvenlik Politikası (Security Policy)

## Desteklenen sürümler

| Sürüm | Destek            |
| ----- | ----------------- |
| 0.1.x | ✅ Aktif          |
| < 0.1 | ❌ Desteklenmiyor |

## Güvenlik açığı bildirme

GitOrbit, kullanıcılarının **GitHub erişim token'lara** ve **yerel kaynak kodu ağaçlarına** erişen bir masaüstü uygulamasıdır; bu nedenle güvenlik açıklarını sorumlu (responsible disclosure) yoluyla bildirmenizi rica ederiz.

- **Özel bildirim:** Projedeki bir GitHub güvenliği sorunu (`Security` sekmesi → "Report a vulnerability") üzerinden özel olarak bildirin.
- **Herkese açık issue AÇMAYIN** — kamuya açık exploit ayrıntıları kullanıcı token'larını doğrudan riske atabilir.
- Olabilirlik (severity) değerlendirmenizi ve yeniden üretim adımlarını ekleyin; günlük/log paylaşıyorsanız **token, oturum kodu ve hassas yol içermediğini** doğrulayın.

Yanıt hedefimiz: 7 gün içinde durum güncellemesi, 30 gün içinde değerlendirme sonucu.

## Bu proje için "güvenlik açığı" sayılan tipik durumlar

1. GitHub OAuth token'ının SQLite'a, loglara, IPC yanıtına veya düz metin dosyaya sızması.
2. Keyring erişilemediğinde token'ın güvenli olmayan bir yedeğinin (fallback) oluşturulması.
3. Device Flow oturum/state doğrulamasının atlanabilmesi (`oauth_state_mismatch` baypası).
4. Shell string birleştirmesi üzerinden komut enjeksiyonu (argüman dizisi ilkesinin ihlali).
5. Repository kökü dışına path traversal (`..`, symlink, mutlak yol) ile dosya okuma/silme.
6. Onaysız yıkıcı Git işlemi (`reset --hard`, `clean -fd`, force push, `-D` force branch delete).
7. Tauri capability/CSP izinlerinin gereğinden geniş olması (ör. UI'a genel shell erişimi).

## Bu proje için "güvenlik açığı" sayılmayan durumlar

- Kullanıcının kendi makinesindeki dosyalara, zaten uygulamayı çalıştırma yetkisi olan bir süreç tarafından erişilmesi (lokal proses izolasyonu tehdit modelimiz dışındadır).
- Kullanıcının kendi Git kimliğiyle (`user.name`/`user.email`) yaptığı commit'lerin içeriği.
- GitHub sunucu tarafında meydana gelen sorunlar (GitHub'ın kendi güvenlik programına bildirin: https://github.com/security).

## Uygulama içi güvenlik sözleşmesi (özet)

- Token'lar **yalnızca** işletim sistemi credential store'unda saklanır; keyring yoksa işlem `CREDENTIAL_STORE_UNAVAILABLE` ile güvenle reddedilir.
- OAuth Device Flow akışında `device_code` yalnızca Rust belleğinde yaşar; ön yüze aktarılan `user_code` ve korelasyon ID'si gizli sır değildir.
- Kirli çalışma ağacında checkout/pull veri kaybını önlemek için sessizce reddedilir; discard işlemi iki aşamalı durum doğrulaması (status hash + onay) gerektirir.
