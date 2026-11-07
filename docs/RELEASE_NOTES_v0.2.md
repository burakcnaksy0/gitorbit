# GitOrbit v0.2 — Kullanım Paketi (geliştirme sürümü)

Hedef: v0.1'de çalışan çekirdeği günlük kullanılan bir araca dönüştürmek.
Kapsamın tamamı `docs/ROADMAP_v0.2_kullanim.md` içinde; bu dosya tamamlanan
her batch'in kullanıcıya dönük notlarını tutar.

## Batch 1 — Yoksay (gitignore) + Stash ✅

### Dosyayı yoksay
- Değişiklik listesindeki **untracked** her satırda artık "Yoksay" (göz) butonu var.
- Tıklayınca iki seçenekli onay:
  - **.gitignore (projeyle paylaşılır)** — desene commit'lenir, repoyu klonlayan
    herkes için geçerli olur.
  - **Sadece bu makine (.git/info/exclude)** — depoya girmez, yalnızca senin
    bilgisayarında yoksayılır.
- Desen kökene sabitlenir (`/build/` gibi), dizinler `/` ile biter; aynı desen
  ikinci kez yazılmaz.
- Zaten izlenen (tracked) dosyalar reddedilir — `git rm --cached` gerektiren bir
  işlem arayüzden sessizce yapılmaz.

### Stash (Kenara Al)
- Değişiklikler panelinde **Kenara Al** butonu: açıklamalı stash, isteğe bağlı
  untracked dahil etme.
- **Stash (n)** rozeti ile açılır panel: her girdi için **Pop** (geri yükle +
  düşür), **Apply** (kopyala, stash kalsın), **Sil** (onaylı).
- Güvenlik: `pop` çakışma üretirse stash **silinmez**; "stash korundu" mesajıyla
  hata gösterilir, mevcut değişiklikler kaybolmaz.
- Stash referansları yalnızca sayı olarak kabul edilir (`stash@{N}`); rastgele
  metin/enjeksiyon girişimleri reddedilir.

### Testler
- Core birim: desen üretimi/tekir kontrolü, stash ref ayrıştırma ve liste
  parse (20 test).
- Entegrasyon (`faz7_ignore_stash_tests.rs`): repo+local kapsam, tracked
  reddi, push/list/pop/apply/drop gidiş-dönüşü, **çakışmada stash korunması**
  (5 test).
- Frontend (`ChangesViewStashIgnore.test.tsx`): kapsam modalı, yerel kapsam,
  tracked satırda buton yokluğu, stash push/pop/drop akışları (5 test).

---

## Batch 2 — Otomasyon ve geri bildirim ✅

### Uzaktan değişiklikleri otomatik kontrol (auto-fetch)
- Ayarlar → yeni **"Otomatik Kontrol"** kartı: aç/kapa + aralık seçimi
  (1–60 dk; varsayılan açık, 3 dk).
- Uygulama açıkken seçili aralıkla tüm depolar fetch edilir; sonuçlar anında
  rozetlere düşer. **Pull asla otomatik yapılmaz** — yalnız bilgi verilir.
- Rozetler: Sidebar "Depolar" yanında toplam **↓N** (bekleyen uzak commit);
  depo listesindeki ↑/↓ sayaçları canlılanır.
- Sakin davranış: pencere gizliyken tur atlanır, tur üst üste binmez, tek
  depoda hata diğerlerini durdurmaz.

### Sistem (OS) bildirimleri
- Uzun işlemler pencere arkadayken masaüstü bildirimi verir: **clone
  tamamlandı/hata**, **yayınlama tamamlandı/yarım kaldı**, **push reddi
  (REMOTE_REJECTED)**.
- Rahatsız etmeme ilkesi: pencere odaklıyken bildirim YOK (toast yeter); izin
  sorulur, reddedilirse sessizce düşer.

### Son commit mesajını düzenle (kontrollü amend)
- Geçmiş sekmesinde son commit seçiliyken ve **henüz push edilmemişse**
  ("Mesajı düzenle" butonu belirir) mesaj düzeltilebilir.
- Güvenlik: push edilmiş commit reddedilir (`AMEND_PUSHED`) — geçmiş sessizce
  değiştirilmez; unborn/detached HEAD reddedilir.
- Yalnızca **mesaj** değişir: staged dosyalar commit'e katılmaz, yerinde kalır.
- Onay penceresi işlemi açıkça anlatır; başarı toast'ı yeni SHA'yı gösterir.

### Testler
- Core: amend güvenliği birim testi + amend entegrasyon testleri (unborn/push
  edilmiş reddi, staged içerik korunumu).
- Frontend 13 yeni test: bildirim odak/izin kuralları (5), auto-fetch döngü/
  hata yutma/eşzamanlılık (4), amend butonu görünürlük + akış (4). Toplam 71.

---

*Sıradaki batch'ler: komut paleti + sürükle-bırak (Batch 3), geçmiş grafiği
(Batch 4), çakışma paneli + tümünü senkronize (Batch 5), sabitleme + ilk
çalışma (Batch 6).*
