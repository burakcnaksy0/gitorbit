# GitOrbit v0.2 Yol Haritası — Kullanım Paketi (12 Madde)

> Bu doküman, "kullanım açısından eklenebilecekler" listesindeki 12 maddenin
> uygulama planıdır. Her madde: amaç → backend → arayüz → test → bitti kriteri
> şeklinde tanımlıdır. Sıra, batch'ler hâlinde ve bağımlılıklara göre belirlendi.
>
> **Genel kurallar (mevcut mimari sözleşme):**
> - İş mantığı yalnızca `crates/gitorbit-core` içinde; `src-tauri` sadece IPC köprüsü.
> - Yeni komut üç yerde tamamlanır: core fonksiyonu → `src-tauri/src/lib.rs`
>   içinde `#[tauri::command]` + invoke_handler kaydı → `src/lib/tauriCommands.ts` sarmalayıcısı.
> - Token asla frontend'e / DB'ye / log'a inmez (mevcut ilke).
> - Her batch sonunda: `cargo test` (core), `cargo check` (src-tauri),
>   `npx tsc --noEmit`, `npx vitest run`, `npm run build` yeşil; mantıksal birim
>   başına commit. Push'ları kullanıcı kendisi atar.
> - Tüm yeni arayüz metinleri Türkçe, toast bildirimleriyle (`useNotify`) beslenir.

---

## Batch 1 — Konfor çekirdeği

### Madde 1 — `.gitignore`'a hızlı ekleme

**Amaç:** Untracked dosyaya tek tıkla "yoksay" — terminal alışkanlığını bitirir.

**Backend (`git/ignore.rs` — yeni modül):**
- `GitIgnoreManager::add_pattern(repo_dir, pattern, scope)` → `scope`:
  - `Local` → `.git/info/exclude` (depoya girmez, yalnız bu makine)
  - `Repo` → `.gitignore` (versiyonlanır)
- Güvenlik: desen doğrulaması (mevcut `validate_name` kalıbıyla boşluk / `-`
  başlangıç guard'ı); mevcut desen varsa duplicate eklenmez; hedef kök
  `.gitignore` ise desen, dosyanın dizinine göreli yazılır (alt dizinlerdeki
  `!` desenlerini bozmamak için).
- Komut: `repository_ignore_file(repo_id, path, scope) -> IgnoredFileResult`
  (`path`, status'tan gelen depo-yoludur).

**Arayüz (ChangesView):**
- Untracked dosya satırına açılır menü: "Yoksay (bu makine)" / "Yoksay (.gitignore)".
- Ekleme sonrası dosya listeden düşer (status yenilenir) + toast:
  `Yoksaylandı — node_modules (.gitignore)`.

**Test:** core birim (desen doğrulama, duplicate, iç içe yol) + entegrasyon
(geçici repoda dosyanın fiilen ignore edildiğini `git status` ile doğrula);
vitest: menü render + tıklama sonucu command çağrısı.

**Bitti:** Untracked dosya iki kapsamdan biriyle tek tıkla listeden düşüyor.

---

### Madde 2 — Stash yönetimi

**Amaç:** Kirli ağacı dal değiştirmek için terminale kaçmadan kenara alma.

**Backend (`git/stash.rs` — yeni modül):**
- `GitStashManager::push(repo_dir, message, include_untracked)` → `git stash push -u -m ...`
- `list(repo_dir)` → `git stash list --format=%gd|%gs|%ci` parse →
  `Vec<StashEntry>` (id, message, date)
- `apply(repo_dir, id)` / `pop(repo_dir, id)` / `drop(repo_dir, id)`
- Güvenlik: staged/unstaged ayrımı git'in kendi davranışına bırakılır;
  apply/pop çakışma üretirse `CONFLICTS_PRESENT` tipik hatasıyla döner (mevcut
  kalıp) ve stash KAYBOLMAZ (pop başarısızsa otomatik tekrar denenmez,
  kullanıcı apply'a yönlendirilir).
- Komutlar: `repository_stash_push` / `_list` / `_pop` / `_drop`.

**Arayüz (ChangesView üst bar):**
- "Kenara Al" butonu → modal (mesaj + "untracked dosyalar da dahil" kutusu).
- "Stash'ler (N)" paneli: satır başına Pop / Apply / Drop (Drop onaylı).
- Toast: `Değişiklikler kenara alındı — "wip" (3 dosya)`, `Stash geri yüklendi`.

**Test:** entegrasyon (push→list→pop döngüsü, kirli ağaç çakışma yolu,
untracked dahil); vitest: panel + buton akışları.

**Bitti:** Dal değiştirme senaryosu terminal gerektirmeden tamamlanıyor.

---

## Batch 2 — Otomasyon ve geri bildirim

### Madde 4 — Arka plan fetch + rozetler

**Amaç:** "Uzaktan yeni commit var mı?" sorusu uygulamayı açmadan yanıtlanmış olsun.

**Backend:** Yeni komut gerekmez (mevcut `repository_fetch` kullanılır).
`AppSettings`'e iki anahtar: `auto_fetch: bool` (varsayılan true),
`auto_fetch_minutes: u32` (varsayılan 3, min 1). Settings key-value tablolu
olduğundan migration gerekmez (`SettingsService` genişlemesi yeter).

**Arayüz (Shell):**
- `useEffect` interval: her N dakikada bir; `origin`i olan + `missing` olmayan
  tüm depolar için `repositoryFetch` (Promise.allSettled, paralel), sonuçlarla
  `statuses` güncellenir.
- Koşullar: sekme görünürken çalış (`document.visibilityState`); eşzamanlı tur
  koruması (ref bayrağı); açılışta yığılmayı önlemek için ilk tur 3 sn gecikmeli.
- Rozet: Sidebar "Depolar" sayacı yanına toplam `behind`; repo listesinde "↓N"
  etiketi (özetler zaten bu alanları taşıyor).
- Ayarlar → Görünüm: auto-fetch aç/kapa + dakika seçimi.

**Test:** vitest — sahte zamanlayıcıyla interval tetikleme, hata yutma (bir
repo patlasa tur devam eder), ayar okuma/yazma.

**Bitti:** Uygulama açıkken yeni uzak commit ≤ N dk içinde rozetlere düşüyor.

---

### Madde 11 — Sistem bildirimi

**Amaç:** Clone/publish gibi uzun işlemler pencere arkadayken OS bildirimi versin.

**Backend:** `tauri-plugin-notification` (Cargo + tauri capability:
`notification:default`), frontend `@tauri-apps/plugin-notification`.

**Kural (rahatsız etmeme ilkesi):** Bildirim yalnızca **pencere odaksızken**;
odaklıysa sadece toast yeter. Tetikleyiciler: clone tamamlandı/hata, publish
tamamlandı/yarım, push hatası (REMOTE_REJECTED). Başarılı commit/push OS
bildirimi yapmaz (toast yeterli).

**Arayüz:** `src/lib/notifications.ts` — `notifySystem(title, body)` (izin
sorma + odak kontrolü tek yerde). Shell'deki ilgili success/catch dalları çağırır.

**Test:** vitest — mock modülle "odaqsızken çağrıldı / odaklıyken çağrılmadı";
izin reddedilirse sessiz düşme.

**Bitti:** Clone'u başlatıp pencereyi küçültünce masaüstü bildirimi geliyor.

---

### Madde 3 — Son commit'i düzenle (amend, kontrollü)

**Amaç:** Yazdığın commit mesajını düzeltme; Faz 4 ilkesini bozmadan:
**geçmiş sessizce değiştirilmez.**

**Güvenlik tasarımı:** Amend yalnızca son commit **upstream'e henüz gitmemişse**
(`ahead > 0` ve HEAD, `rev-list HEAD ^upstream` kümesindeyse) izinli. Aksi
halde `AMEND_PUSHED` hatası + öneri ("yeni commit at"). Yalnızca **mesaj**
amend edilir — içerik amend'i (dosya ekleme) kapsam dışı; staged dosya varsa
kullanıcı uyarılır (commit'e eklenmez).

**Backend:** `GitCommitManager::amend_message(repo_dir, new_message)` →
`git commit --amend -m ...`; ön kontroller: HEAD var, ahead > 0, HEAD
upstream'de değil. Komut: `repository_amend_message`.

**Arayüz:** HistoryView'daki son commit kartında "Mesajı düzenle" (yalnızca
ahead > 0 iken görünür) → inline form; onay diyaloğu: "Bu işlem son commit'i
değiştirir. Commit henüz push edilmediği için güvenlidir."
Toast: `Commit mesajı güncellendi — abc1234`.

**Test:** entegrasyon (ahead > 0'da amend başarılı; itilmiş commit reddedilir;
unborn HEAD reddedilir); vitest: butonun görünürlük kuralı.

**Bitti:** Pişman olunan commit mesajı tek tıkla, güvenli koşulda düzeliyor.

---

## Batch 3 — Hız

### Madde 5 — Komut paleti (Ctrl+K)

**Amaç:** "Planlanan özellik" iskeleti gerçek özelliğe dönüşür.

**Backend:** Yeni komut gerekmez.

**Arayüz (`components/common/CommandPalette.tsx` — yeni):**
- Ctrl+K (mevcut placeholder'ın yerini alır) / Ctrl+Shift+P; `Esc` kapatır;
  ok tuşları + Enter gezinme, fare destekli.
- Kaynaklar (statik + state'ten):
  1. **Sekmeler:** Genel Bakış, Depolar, Değişiklikler, Geçmiş, Dallar, GitHub, Ayarlar
  2. **Depolar:** ekli her repo → "Depoya git: X"
  3. **Dallar (aktif depo):** "Dala geç: feature-x" (checkout + toast)
  4. **İşlemler:** Push, Pull, Senkronize Et, Depo Ekle, GitHub'dan Klonla,
     Yayınla (origin yoksa)
- Eşleştirme: bağımlılıksız basit alt-dizi/karakter-skoru fuzzy (util'de ~10
  satır, test edilir). Son 5 komut `localStorage`'ta "son kullanılanlar".

**Test:** vitest — fuzzy sıralama birim testi; klavye navigasyonu; depo/dal
kaynaklarının render'ı; çalıştırma callback'i.

**Bitti:** Uygulamada fare kullanmadan repo/dal işlemi yapılabiliyor.

---

### Madde 9 — Sürükle-bırak ile depo ekleme

**Amaç:** Klasörü pencereye bırak → kaydet/aç akışı.

**Backend:** Yeni komut gerekmez (`repository_add` + NOT_A_GIT akışı mevcut).

**Arayüz:**
- `Shell`'de `getCurrentWindow().onDragDropEvent` (Tauri v2 API):
  `enter` → tam ekran "Klasörü bırakın" overlay'i; `drop` → ilk klasör yoluyla
  `openRepository(path)` (düz klasörse mevcut init/publish modalı açılır);
  `leave` → overlay kapanır.
  Çoklu bırakmada ilk klasör alınır + toast notu.

**Test:** vitest — overlay görünürlük durumu (sahte event emit ile);
entegrasyon gerekmez (mevcut openRepository akışı testli).

**Bitti:** Masaüstünden klasör bırakılarak depo eklenebiliyor.

---

## Batch 4 — Görselleştirme

### Madde 6 — Geçmiş grafiği (commit ağacı)

**Amaç:** HistoryView'daki düz liste yerine dal/birleşme grafiği — GUI'yi
terminalden ayıran ana ekran.

**Backend (`git/history.rs` genişletmesi):**
- `GitLogEntry`'ye `parents: Vec<String>` + `refs: Vec<String>` alanları;
  `git log --parents --format=%H%x00%P%x00%d%x00%an...` parse (mevcut %x00
  kalıbı korunur). Sayfalama korunur: grafik yalnızca **yüklenen sayfa**
  içinde çizilir (tam depo grafiği kapsam dışı — bilinçli sınır).
- Lane hesabı core'da: `compute_lanes(entries)` → her commit için lane + kenar
  listesi (saf fonksiyon, birim testli).

**Arayüz (HistoryView):**
- Her satırın solunda SVG şerit: lane renkleri (hash'ten türeyen 6 renk),
  merge commit'lerde birden fazla girdi kenarı; mevcut kart tasarımı korunur,
  grafik `aria-hidden` olur, satır erişilebilir kalır.
- Detay panelinde ebeveyn SHA'ları tıklanabilir (detayda gezinme).

**Test:** core birim: lineer / merge / octopus / iç içe senaryolarda lane
hesabı (fixture'larla); vitest: render'ın patlamadığı + etiket sayıları.

**Bitti:** 50 commit'lik bir repoda dallanma/birleşme görsel olarak okunuyor.

---

## Batch 5 — İleri kullanım

### Madde 7 — Çakışma yardımcı paneli

**Amaç:** Merge/rebase çakışmasında kullanıcı terminale gitmeden çözüme yönlensin.

**Backend:**
- `GitMergeManager::resolve_with_side(repo_dir, path, side)` →
  `git checkout --ours/--theirs -- <path>` + `git add -- <path>`
  (yalnızca `operation_state != normal` iken; path doğrulaması).
- Komut: `repository_resolve_conflict(repo_id, path, side)`.

**Arayüz (ChangesView — `operation_state` normal değilse üstte sabit bant):**
- "N dosyada çakışma var" + ilerleme (çözülen/toplam — status'taki
  conflicted_files'tan).
- Dosya satırında: **"Dosyayı Aç"** (opener plugin ile editörde aç),
  **"← Bizim"**, **"→ Onların"**, **"Çözüldü işaretle"** (stage).
  Her eylem sonrası status yenilenir.
- Tümü çözülünce: "Devam Et" (mevcut `repositoryContinueOperation`) /
  "İptal Et" butonlu bitiş durumu.

**Test:** entegrasyon (çakışma üreten iki dal: ours/theirs çözüm + continue
tam akışı, yanlış durumda reddetme); vitest: bant + buton durumları.

**Bitti:** Basit çakışmalar %100 arayüzden çözülebiliyor (karma içerik
çakışması editöre devredilir — dürüst sınır).

---

### Madde 8 — Tümünü eşitle (multi-repo pull/push)

**Amaç:** 6+ depolu masaüstünde tek komutla toplu senkron.

**Backend:** `src-tauri` katmanında orkestrasyon (core'a dokunmadan):
- `sync_pull_all()` / `sync_push_all()`: kayıtlı depolar üzerinde **sırayla**
  (kilit çakışması + ağ nazikliği), mevcut güvenlikli
  `RepositoryService::pull/push` çağrılır; depo başına sonuç toplanır:
  `Vec<RepoSyncOutcome { repo_id, name, ok, skipped_reason?, error? }>`.
  Atlananlar: missing, origin yok, upstream yok, kilitli (kullanıcı işlemde).
- Planlama saf fonksiyona çıkarılır (`plan_sync_list(repos, statuses) -> plan`)
  ve core'da birim testi olur.

**Arayüz:** StatusBar'a "Tümünü İçe/Dışa Aktar" (onay + ilerleme modalı: depo
depo sonuç listesi ✓/⏭/✗; tur iptal edilebilir). Özet toast:
"İçe aktarma: 4 başarılı, 1 atlandı, 1 hatalı".

**Test:** core: planlama birim testi (missing/origin'siz/kilitli elemeleri);
vitest: modal + özet.

**Bitti:** Sabah "Tümünü İçe Aktar" ile tüm depolar tek tıkla güncel.

---

## Batch 6 — Cila

### Madde 10 — Sabitleme + filtreleme

**Backend:** Migration: `repositories.pinned INTEGER NOT NULL DEFAULT 0`;
`repository_set_pinned(repo_id, pinned)`. Liste sırası frontend'de belirlenir.

**Arayüz:** Depolar listesi kartına pin ikonu (toggle); "Sabitlenenler" üstte;
liste üstüne isim filtresi input'u. Genel Bakış "Son Açılanlar"da pinliler
öncelikli.

**Test:** core migration + DAO birim testi; vitest: sıralama + filtre.

**Bitti:** Sık kullanılan repolar listede aranmadan bulunuyor.

---

### Madde 12 — İlk çalıştırma onboarding'i

**Amaç:** İlk açılışta 3 adımlık yönlendirme: GitHub bağla → depo aç/ekle → ilk işlem.

**Backend:** Ayarlara `onboarding_completed: bool` (varsayılan false) —
key-value olduğu için migration gerektirmez.

**Arayüz (WelcomeView üstüne `OnboardingCards` bileşeni):**
- Yalnızca `onboarding_completed == false && repositories.length == 0` ise:
  1. **GitHub'ını bağla** → GitHub sekmesine götürür (hesap eklenince adım ✓)
  2. **Bir depo aç** → yerel depo ekle (veya klonla) → adım ✓
  3. **İlk commit'ini gör** → Değişiklikler sekmesine yönlendirir
- Kart tamamlanınca yeşil tik; "Şimdilik atla" → ayara `true` yazar, bir daha
  çıkmaz. Ayarlar'dan "Onboarding'i yeniden göster" sıfırlama butonu.

**Test:** vitest: görünürlük koşulları, adım tamamlanma state'i, atla yazımı.

**Bitti:** Yeni makinede ilk açılış, kullanıcıyı tek derinlikte işe başlatıyor.

---

## Sıra, riskler ve kapsam dışları

| Sıra | Batch | Madde | Tahmini iş |
|---|---|---|---|
| 1 | Konfor | 1 ignore, 2 stash | orta |
| 2 | Otomasyon | 4 auto-fetch, 11 OS bildirimi, 3 amend | küçük-orta |
| 3 | Hız | 5 komut paleti, 9 sürükle-bırak | orta |
| 4 | Görsel | 6 geçmiş grafiği | büyük |
| 5 | İleri | 7 çakışma paneli, 8 tümünü eşitle | büyük-orta |
| 6 | Cila | 10 pinleme, 12 onboarding | küçük |

**Bilinçli kapsam dışları (v0.2):** etkileşimli rebase, içerik amend'i (dosya
ekleme), satır bazlı (inline) çakışma editörü, depo grup/etiket sistemi.
Bunlar v0.3 adayları.

**Riskler:**
- Geçmiş grafiği (madde 6) en büyük iş — lane hesabı core'da saf fonksiyon
  olarak önce test edilir, UI sonra bağlanır; gerekirse batch ikiye bölünür.
- `tauri-plugin-notification` yeni capability gerektirir — izin akışı ilk
  denemede elle doğrulanacak.
- Tümünü-eşitlemede turlar uzun sürebilir → iptal bayrağı UI'da zorunlu.

**Bitti tanımı (DoD) — tüm maddeler için:** plandaki testler yeşil +
kullanıcıyla elle deneme + docs/RELEASE_NOTES güncellemesi + commit.
Son batch bitince "neler yaptık ve nasıl kullanılıyor" rehberi
(`docs/KULLANIM_v0.2.md`) yazılacak.
