# GitOrbit v0.1.0 — Sürüm Notları (Release Candidate)

GitOrbit'in ilk kararlı sürüm adayı olan **v0.1.0**, yerel Git iş akışlarını modern masaüstü arayüzü ve güvenli GitHub entegrasyonuyla buluşturan uçtan uca tamamlanmış bir Developer Workspace sunar.

---

## 🌟 Öne Çıkan Özellikler

### 1. Yerel Git Durum ve Yaşam Döngüsü (Faz 2)
- Sistem Git CLI tespiti, sürüm ve yol doğrulaması.
- Makine tarafından ayrıştırılabilir nul-delimited (`\0`) durum motoru ile hızlı ve doğru indeksleme.
- Yeniden adlandırma (`renamed`), silinme ve çakışma durumlarının tespiti.

### 2. Dosya Değişiklikleri, Staging ve Diff Görüntüleyici (Faz 3)
- Dosya bazında ve toplu Staging / Unstaging operasyonları.
- Unified Diff ayrıştırma, renklendirilmiş hunks (ekleme/çıkarma satırları).
- Büyük dosya diff budama koruması (5000 satır veya 1 MB tavan sınırı).
- İkili (binary) dosya algılama ve önizleme güvenliği.
- Veri kaybını engelleyen SHA-1 durum doğrulamalı Değişiklik İptali (`discard`).

### 3. Commit, Branch Yönetimi ve Geçmiş (Faz 4)
- Atomik Commit oluşturma, geçerli SHA-1 üretimi ve geçmişe yazma.
- **Git Identity Guard**: Boş veya geçersiz `user.name` / `user.email` durumunda commit'i engelleyen ve kullanıcıyı yapılandırmaya yönlendiren koruma.
- Yerel ve uzak branch'lerin hiyerarşik listelenmesi.
- Yeni branch oluşturma, güvenli checkout ve silme kontrolleri.
- Sayfalı commit geçmişi ve SHA/yazar/tarih arama.

### 4. Uzak Depo (Remote) ve Senkronizasyon (Faz 5)
- Bare remote desteği ile tam senkronizasyon (Push, Fetch, Pull).
- Non-fast-forward push durumunda otomatik `force` yapılmasını engelleyen güvenlik kilidi.
- Çakışma durumunda yıkıcı `git reset --hard` çalıştırmayan, durumu `merge_in_progress` veya `rebase_in_progress` rozetiyle arayüzde bildiren operasyonel durum izleme.

### 5. Güvenli GitHub Entegrasyonu (Faz 6)
- **Zero-Token Storage**: OAuth tokenleri SQLite veritabanına veya loglara asla yazılmaz; işletim sistemi güvenli deposunda (`Keyring`) saklanır.
- **GitHub Device Flow**: Tarayıcıda tek kullanımlık `user_code` doğrulamasıyla tarayıcı tabanlı oturum açma.
- Çoklu hesap listeleme, hesap tekilleştirme ve onaylı bağlantı kesme (`disconnect`).
- Sayfalama destekli GitHub depo listesi (Public/Private/Fork rozetleri).

### 6. Sertleştirme ve Erişilebilirlik (Faz 7)
- Uçtan uca (E2E) günlük iş akışı testleri.
- WCAG uyumlu klavye navigasyonu (Tab gezinmesi, Escape ile modal kapatma, ARIA rolleri).
- Linux, macOS ve Windows hedefleyen multi-platform CI iş akışı.
- Eksiksiz bağımlılık ve lisans envanteri.

---

## 💻 Desteklenen İşletim Sistemleri

| Platform | Minimum Sürüm | Notlar |
|---|---|---|
| **Linux** | Ubuntu 22.04 LTS / Debian 12 / Fedora 38+ (x86_64 / aarch64) | `webkit2gtk-4.1` ve `libdbus` gereklidir. |
| **macOS** | macOS 12 Monterey veya üzeri (Apple Silicon & Intel) | Keychain entegrasyonu yerel olarak desteklenir. |
| **Windows** | Windows 10 (Build 19041+) / Windows 11 (64-bit) | Windows Credential Manager yerel olarak desteklenir. |

---

## ⚠️ Bilinen Sınırlamalar

1. **GitHub Pull Request & Issue Yönetimi**:
   - v0.1.0 sürümü GitHub hesap bağlantısı ve repo listelemeyi içerir. Pull Request inceleme, satır içi yorum ve GitHub Issue oluşturma Faz 8+ yol haritasındadır.
2. **Keyring Olmayan Headless Ortamlar**:
   - Headless Docker container'larında D-Bus Secret Service çalışmıyorsa GitHub oturumu `CREDENTIAL_STORE_UNAVAILABLE` hatası verir. Token'ların düz metin dosyaya düşürülmesine güvenlik sebebiyle izin verilmez.
3. **Commit Amend & Rebase Conflict Resolver**:
   - Amend komutu ve arayüz üzerinden interaktif 3-yollu rebase çözümü ilk sürümde kısıtlanmıştır; terminal üzerinden müdahale önerilir.
