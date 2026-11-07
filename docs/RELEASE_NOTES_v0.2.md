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

## Batch 3 — Hız ✅

### Komut paleti (Ctrl+K / Ctrl+Shift+P)
- Arama çubuğu ve Ctrl+K artık gerçek komut paletini açar (placeholder yok).
- Kaynaklar: **Sekmeler**, **Depolar** (doğrudan depo aç), **Dallar** (aktif
  deponun dallarına geçiş — palet açılınca tazelenir), **İşlemler** (Depo Ekle,
  Klonla, Fetch, Pull, Push; origin yoksa "GitHub'da Yayınla").
- Bağımlılıksız fuzzy eşleştirme (tam alt-dizi > kelime başı > dağınık);
  ↑↓ / Enter / Esc; son 5 komut hatırlanır ve boş sorguda en üstte gelir.

### Klasör sürükle-bırak
- Klasörü pencereye bırak → tam ekran "Klasörü buraya bırakın" çerçevesi →
  bırakınca depo olarak açılır; düz klasörde mevcut başlat/yayınla seçeneği
  çıkar. Birden fazla öğe bırakılırsa ilki alınır ve toast ile belirtilir.

### Testler
- fuzzy skor/filtre + son kullanılanlar (8), palet klavye/akış (7),
  sürükle-bırak kancası (2). a11y testi yeni palet davranışına güncellendi.
- Toplam suite: 90 yeşil.

---

## Batch 4 — Görselleştirme ✅

### Geçmiş grafiği (commit ağacı)
- Commit listesi artık düz liste değil: her satırın solunda **dal/birleşme
  şeridi** — lane hesabı çekirdekte saf fonksiyon (`compute_lanes`), çizim
  satır başına SVG. Renkler SHA'dan türeyen 6 renkli paletten kararlı.
- Merge commit'lerde ikinci şerit açılır, birleşme noktasında çizgiler
  kavuşur; octopus merge çok şeritli çizilir.
- Commit satırlarında ve detayında **dal/tag rozetleri**: yeşil = yerel dal,
  mavi = uzak dal (origin/…), amber = etiket.
- Detay panelinde **ebeveyn SHA'ları tıklanabilir** — sayfada değilse detaydan
  çekilerek gezinme sağlanır.
- Bilinçli sınır: grafik yalnızca yüklenen sayfayı çizer (sayfa sınırında
  çizgiler kesilir); tam depo grafiği kapsam dışı.

### Testler
- Core: lane hesabı birim testleri (lineer / merge / octopus / iç içe /
  sayfa sınırı + renk kararlılığı) + gerçek merge üreten repoyla entegrasyon
  testi (graph + refs).
- Frontend: grafik render'ı, rozetler, tıklanabilir ebeveynler (3 test).
  Toplam suite 93 yeşil.

---

## Batch 5 — İleri kullanım ✅

### Çakışma yardımcı paneli
- Merge/rebase çakışmasında Değişiklikler sekmesinin üstünde sabit bant:
  "N dosyada çakışma var" + **X/Y çözüldü** ilerleme sayacı.
- Dosya başına dört eylem: **Dosyayı Aç** (varsayılan editörde),
  **← Bizim** / **Onların →** (tarafı al + stage), **Çözüldü işaretle**
  (editörde elle çözdüysen stage).
- Tümü çözülünce **Devam Et** (merge/rebase'i bitirir) / **İptal Et**
  (iki adımlı onay — yıkıcı olduğundan "Emin misin?" ile teyit edilir).
- Güvenlik: taraf seçimi yalnızca devam eden işlem varsa ve dosya
  gerçekten çakışmalı listesindeyse çalışır; geçersiz/mutlak/`..` yollar
  reddedilir. Karma içerik çözümü bilinçli olarak editöre devredilir.

### Tümünü eşitle (çoklu depo)
- Durum çubuğunda **Tümünü İçe** / **Tümünü Dışa** butonları: tüm depolar
  sırayla çekilir/gönderilir, tek tek terminal açmaya gerek kalmaz.
- İlerleme modalı: çalışma sırasında **Durdur** (içinde bulunulan depo
  bittikten sonra sonraki depoda durur), bitince depo depo ✓ tamam /
  ⏭ atlandı (nedeniyle: origin yok, upstream yok, klasör yok, başka işlem
  sürüyor) / ✗ hata (mesajıyla) listesi + özet toast.
- Push turu, tekil push ile aynı hesap-duyarlı kimlik/token mantığını
  kullanır; kilitli depo beklemeden atlanır — tur hiçbir depoda takılmaz.

### Testler
- Core: çakışma üreten iki dallık gerçek repoyla tam akış (ours/theirs +
  continue), yanlış durum/yol reddi, girdi doğrulama (3 entegrasyon testi);
  senkron planlaması saf fonksiyon birim testleri (3).
- Frontend: çakışma bandı durum makinesi (6) + senkron modalı (4).
  Toplam suite 104 yeşil.

---

*Sıradaki batch: sabitleme + ilk çalışma (Batch 6).*
