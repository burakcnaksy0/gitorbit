# Gybe v0.2 — Kullanım Paketi: Neler Yaptık, Nasıl Kullanılır

Bu belge v0.2'de eklenen 12 özelliğin kısa kullanıcı rehberidir. Teknik
detaylar için `docs/RELEASE_NOTES_v0.2.md`, plan için
`docs/ROADMAP_v0.2_kullanim.md`.

---

## `.gitignore`'a hızlı ekleme
**Nerede:** Değişiklikler → dosya satırındaki "Yoksay" (göz) butonu.
- Tıklınca kapsam sor: **Bu depo (.gitignore)** — commit'lenir, klonlayan
  herkes için geçerlidir; ya da **Sadece bu makine (.git/info/exclude)** —
  depoya girmez, yalnızca senin bilgisayarında yoksayılır.
- İzlenen dosyalarda buton yoktur; ignore yalnızca izlenmeyen dosyalar
  içindir (Git semantiğine saygı).
- Yanlış eklediysen: Depo klasöründeki ilgili dosyadan satırı sil.

## Stash yönetimi
**Nerede:** Değişiklikler → üstteki **Kenara Al** butonu + **Stash (N)** paneli.
- **Kenara Al**: çalışma ağacındaki değişiklikleri stash'e kaldırır
  (istediğin mesajla).
- Panelde girdi başına: **Apply** (geri yükle, stash kalır) / **Pop** (geri
  yükle + listeden düşür) / **Sil** (onaylı — geri alınamaz).
- Pop çakışma üretirse stash **silinmez** ve uyarıyı görürsün — hiçbir şey
  sessizce kaybolmaz.

## Son commit'i düzenle (amend)
**Nerede:** Geçmiş → en üstteki (henüz push edilmemiş) commit →
"Mesajı düzenle".
- **Yalnızca mesaj** değişir; staged içerik aynen korunur.
- Güvenlik: o commit zaten push edildiyse kalem hiç görünmez ve çağrı
  yinelenirse rededilir (`AMEND_PUSHED`) — geçmiş sessizce bozulmaz.

## Arka plan fetch + rozetler
**Nerede:** Ayarlar → "Uzaktan Değişiklikleri Otomatik Kontrol Et"
(varsayılan açık, 3 dk).
- Uzakta yeni commit varsa kenar çubuğunda/depolarda **↓ gelen** rozeti
  görürsün. **Asla otomatik pull yapılmaz** — kararı sen verirsın.
- Pencere gizliyken tur atlanır, iç içe tur başlamaz.

## Sistem bildirimi
**Ne zaman:** Uygulama **odağın dışındayken** uzun işler bitince
(clone/pull/push) masaüstü bildirimi gelir. Odaklıyken bildirim gürültüsü
yoktur — uygulama zaten ekranındadır.

## Komut paleti (Ctrl+K)
- **Ctrl+K** (macOS: Cmd+K) → repo değiştir, dal değiştir, sekmeye git,
  depo ekle, tümünü içe/dışa aktar…
- Fuzzy arama; **↑↓ / Enter / Esc**; son 5 komut hatırlanır ve boş sorguda
  en üstte listelenir.

## Klasör sürükle-bırak
- Klasörü pencereye sürükle → tam ekran "Klasörü buraya bırakın" çerçevesi.
- Git deposuysa doğrudan eklenir; düz klasörde "başlat / yayınla" seçeneği
  çıkar. Çoklu bırakmada ilki alınır ve toast ile belirtilir.

## Geçmiş grafiği
**Nerede:** Geçmiş sekmesi.
- Her commit satırının solunda **dal şeridi**: dallanma, birleşme (merge)
  ve etiket/HEAD noktaları görsel olarak okunur.
- Commit satırlarında rozetler: yeşil = yerel dal, mavi = uzak dal,
  amber = etiket. Detayda ebeveyn SHA'ları tıklanabilir.
- Bilinçli sınır: grafik yüklenen sayfayı çizer; sayfa sınırında çizgiler
  kesilir.

## Çakışma yardımcı paneli
**Ne zaman:** Merge/rebase çakışmasında Değişiklikler'in üstünde sabit bant.
- Dosya başına: **← Bizim** / **Onların →** (tek tarafı al + stage),
  **Dosyayı Aç** (karma çözüm için editörde aç), **Çözüldü işaretle**
  (editörde düzelttiysen stage'le).
- Tümü çözülünce **Devam Et**; **İptal Et** iki adımlı onay ister
  (yıkıcı işlem).

## Tümünü eşitle
**Nerede:** Durum çubuğu → **Tümünü İçe** / **Tümünü Dışa**.
- Tüm depolar sırayla çekilir/iter; modalda **Durdur** ile bir sonraki
  depoda durdurabilirsin.
- Bitince depo başına sonuç: ✓ tamam / ⏭ atlandı (origin yok, upstream yok,
  klasör yok, başka işlem sürüyor) / ✗ hata (mesajıyla).
- Push, çoklu GitHub hesabı mantığını kullanır: origin'in sahibi hangi
  bağlı hesapsa onun token'ı gider.

## Depo sabitleme + filtre
**Nerede:** Depolar → kart üstünde pin ikonu.
- Sabitlenen amber "Sabit" rozetiyle **en üstte**; Genel Bakış'ın
  "Son Açılan Depolar" listesinde de öncelikli.
- Liste üstündeki arama kutusu isim/yol/dala göre filtreler; filtre +
  sabitleme birlikte çalışır. Sabitler kalıcıdır.

## İlk çalışma yönlendirmesi
**Ne zaman:** Yeni kurulumda (hiç depo yokken) hoş geldin ekranının üstünde.
- 3 adım: **GitHub bağla → depo aç → ilk işlem**. Tamamlanan adımda yeşil
  tik (GitHub adımı gerçek hesap listesine bakar).
- "Şimdilik atla" kalıcı kapatır; geri açmak:
  **Ayarlar → İlk Çalışma Yönlendirmesi → Yeniden Göster**.

---

## Bilinçli sınırlar (v0.2 kapsam dışı)
- Etkileşimli rebase, içerik amend'i, satır içi merge editörü, depo
  grupları/etiket yönetimi arayüzü yok — terminal her zaman serbest.
- Hiçbir yıkıcı işlem onaysız çalışmaz; OAuth token'ları asla
  arayüzde/veritabanında/logda tutulmaz (yalnızca OS anahtarlığı + env).
