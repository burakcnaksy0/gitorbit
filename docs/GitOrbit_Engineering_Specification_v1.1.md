# GitOrbit — Engineering Specification v1.1
**Belge türü:** Uygulanabilir mühendislik spesifikasyonu ve AI coding çalışma kılavuzu  
**Sürüm:** 1.1  
**Tarih:** 28 Ekim 2026  
**Durum:** Başlangıç uygulaması için normatif teknik kararlar  
**Öncelikli platform:** Linux  
**Hedef platformlar:** Linux, Windows, macOS  
**Lisans yaklaşımı:** Açık kaynak ve ücretsiz  
**Ürün:** GitOrbit

> Bu belge, `GitOrbit_System_Design_PRD.md` belgesini tamamlar; onun yerine geçmez. PRD ürünün ne olduğunu ve ana mimariyi açıklar. Bu belge ise kritik davranışları, güvenlik sınırlarını, hata durumlarını, test edilebilir kabul kriterlerini ve geliştirme sırasını kesinleştirir. İki belge birlikte kullanılmalıdır.

---

## 0. Bu belge nasıl kullanılmalı?

Bu belgeyi bir AI coding aracına tek mesajla verip uygulamanın tek seferde hatasız üretileceğini varsayma. Araca iki dosyayı da bağla ve geliştirmeyi bu belgede tanımlanan küçük, doğrulanabilir fazlara böl.

**Normatif kelimeler**
- **MUST / ZORUNLU:** Kabul kriteri; uygulanmadan ilgili iş tamamlanmış sayılmaz.
- **MUST NOT / YASAK:** Güvenlik veya veri bütünlüğü nedeniyle yapılmaması gereken davranış.
- **SHOULD / ÖNERİLEN:** Güçlü varsayılan; istisna gerekçelendirilmelidir.
- **MAY / İSTEĞE BAĞLI:** Ürün kararına göre uygulanabilir.

**Kaynak belgeler**
1. `GitOrbit_System_Design_PRD.md` — ürün vizyonu, kapsam, mimari, modüller ve yüksek seviyeli gereksinimler.
2. `GitOrbit_Engineering_Specification_v1.1.md` — burada tanımlanan kesin davranışlar ve test kriterleri.

**Uygulama kuralı:** Bir gereksinim test edilebilir değilse veya beklenen sonuç belirsizse, kod yazmadan önce gereksinimi netleştir. Varsayımla veri kaybı riski yaratma.

---

## 1. Ürün sınırları ve değişmez ilkeler

### 1.1 Ürün tanımı

GitOrbit, geliştiricilerin birden fazla GitHub hesabını ve yerel Git deposunu tek, yerel çalışan, modern masaüstü arayüzünden yönetmesini sağlayan açık kaynaklı bir geliştirici çalışma alanıdır.

### 1.2 MVP kapsamı

MVP aşağıdakileri kapsar:

- Uygulama kabuğu, gezinme, tema ve ayarlar.
- Yerel Git deposu ekleme, listeleme, kaldırma (dosyaları silmeden) ve açma.
- Git durumunu gösterme: aktif branch, upstream, staged/unstaged/untracked/deleted/renamed dosyalar.
- Dosya diff önizleme ve temel commit geçmişi.
- Stage, unstage, belirli dosyaları discard etme (yüksek riskli; açık onay ve diff özeti zorunlu).
- Commit oluşturma; boş mesajı ve yanlış/eksik Git kimliğini engelleme.
- Branch listeleme, oluşturma, checkout ve güvenli silme.
- Fetch, pull, push; upstream ve kimlik bilgisi hatalarını anlaşılır gösterme.
- Merge/rebase/conflict durumlarını algılama ve veri kaybetmeden açıklama.
- GitHub hesabı bağlama/ayırma, birden çok hesabı saklama ve hesaplar arasında geçiş.
- GitHub repository listesi ve repository ayrıntılarını gösterme.
- SQLite ile yerel ayarlar ve repository metadata’sı.
- Token’ları işletim sisteminin credential store’unda saklama.
- Linux geliştirme ve paketleme; Windows/macOS için platforma özgü altyapı ve CI doğrulaması.

### 1.3 MVP dışında

Aşağıdakiler ilk MVP için **zorunlu değildir**:
- Pull request oluşturma/review, Issues ve Projects.
- GitHub Actions kontrol paneli.
- GitLab/Bitbucket sağlayıcıları.
- AI ile kod özeti/commit mesajı üretimi.
- Yerleşik editör veya tam IDE.
- Gelişmiş görsel merge-conflict editörü.
- Otomatik arka plan senkronizasyonu.
- Uzak sunucu veya kullanıcı hesabı gerektiren SaaS backend.

Bu özellikler MVP’yi geciktirmemelidir. Mimari, sonraki aşamada eklenmelerini engellememeli ancak şimdiden gereksiz soyutlamayla karmaşıklaştırılmamalıdır.

### 1.4 Değişmez ilkeler

1. Kullanıcının çalışma ağacı ve commit’leri kullanıcının verisidir; sessizce değiştirilemez.
2. Uygulama, kullanıcı onayı olmadan `reset --hard`, `clean -fd`, force push veya eşdeğer yıkıcı komut çalıştıramaz.
3. GitHub hesabı, yerel Git commit kimliği ve remote kimlik doğrulaması birbirinden farklı kavramlardır; UI bunları tek bir “hesap” gibi sunmamalıdır.
4. Token ve parola loglara, analytics’e, hata raporuna, SQLite’a veya düz metin yapılandırma dosyasına yazılamaz.
5. Git işlemleri shell string birleştirmesiyle yürütülemez.
6. Her uzun süren işlemde loading, başarı/hata durumu ve mümkün olduğunda iptal davranışı tanımlanır.
7. Başarısız işlemin ardından uygulama gerçek Git durumunu yeniden okuyarak UI’ı günceller; varsayılan olarak eski durumu taklit etmez.
8. İşlem sonucu belirsizse başarı bildirilmez; kullanıcıya durumu yeniden kontrol etme seçeneği sunulur.
9. Erişilebilirlik ve klavye navigasyonu temel akışlarda baştan desteklenir.
10. MVP internet olmadan yerel repository görüntüleme ve yerel commit oluşturma işlevlerini sürdürür; GitHub özellikleri bağlantı yoksa uygun biçimde devre dışı kalır.

---

## 2. Teknoloji ve mimari kararları

### 2.1 Onaylı yığın

| Katman | Tercih | Sorumluluk |
|---|---|---|
| Masaüstü kabuğu | Tauri 2 | Pencere, IPC, paketleme, güvenlik izinleri |
| UI | React + TypeScript | Ekranlar ve kullanıcı etkileşimleri |
| Stil | Tailwind CSS | Tasarım sistemi ve responsive masaüstü düzeni |
| İstemci durumu | TanStack Query + hafif yerel state (örn. Zustand) | Async server/IPC verisi ile geçici UI state ayrımı |
| Yerel komutlar | Rust | Güvenli komut yönlendirme, Git süreçleri, dosya erişimi |
| Git işlemleri | Sistem Git CLI | Git’in gerçek davranışından yararlanma |
| Yerel DB | SQLite | Ayarlar, repository kayıtları, hesap metadata’sı |
| Credential store | İşletim sistemi kasası | GitHub access token ve hassas kimlik bilgileri |
| GitHub API | REST API, gerektiğinde GraphQL sonraki faz | Hesap ve repository verileri |
| Test | Vitest/React Testing Library, Rust testleri, Playwright/Tauri E2E | Birim, entegrasyon ve uçtan uca testler |
| CI | GitHub Actions | Lint, test, build ve platform paketleri |

Sürümler projede lockfile ile sabitlenmelidir. Güncel kararlı sürümler araştırılmadan belirli bir patch sürümü bu belgeye gömülmemiştir. Büyük sürüm yükseltmeleri ayrı değişiklik olarak yapılır.

### 2.2 Katman sınırları

**React UI**
- İş kurallarının tek kaynağı olamaz.
- Git komutunu doğrudan çalıştıramaz; yalnızca tanımlı Tauri command sözleşmelerini çağırır.
- Token, credential veya hassas OS yolu gereksiz yere UI state’ine taşınmaz.
- Gelen sonuçları tipli `Result` benzeri başarı/hata sözleşmeleriyle işler.

**Rust uygulama katmanı**
- Girdi doğrulama, izin kontrolü, süreç yürütme, zaman aşımı, hata eşleme ve güvenlik sınırlarının sahibidir.
- Her command yalnızca gereken parametreleri kabul eder.
- UI’dan gelen repository ID’sini veritabanından çözerek canonical path kullanır; UI’ın keyfî path ile başka alanlara erişmesini engeller.
- `std::process::Command` ile argüman dizisi kullanır; shell üzerinden komut birleştirmez.
- Komut çıktısını sınırlı boyutta işler; hassas verileri loglamaz.

**Git adapter**
- Git CLI sürümünü ve kullanılabilirliğini kontrol eder.
- Çıktıyı mümkün oldukça `-z` gibi NUL-delimited formatlarla parse eder; dosya isimlerinin boşluk, newline, Unicode ve özel karakter içerebileceğini varsayar.
- Git’in insan tarafından okunabilir hata mesajlarını kullanıcıya doğrudan tek başına sözleşme olarak sunmaz. Hata sınıfı + güvenli ayrıntı + önerilen eylem döndürür.
- Git’in exit code’unu mutlaka kontrol eder.

**GitHub adapter**
- HTTP, pagination, rate limit, timeout ve token yetkilendirmesini yönetir.
- API response modelleri UI modellerinden ayrıdır.
- Token yalnızca gerekli request header’ına eklenir; URL query parametresine yazılmaz.
- 401, 403/rate-limit, 404, 422, 5xx ve ağ hataları ayrı sınıflandırılır.

**Repository service**
- Git adapter ve metadata DB arasında orkestrasyon yapar.
- Branch checkout, pull ve benzeri işlemler öncesinde gerekli durum kontrollerini uygular.
- İşlem sonrası repository status/history’yi yeniden okur.

### 2.3 Önerilen dizin yapısı

```text
gitorbit/
├── src/                         # React UI
│   ├── app/
│   ├── components/
│   │   ├── layout/
│   │   ├── repository/
│   │   ├── git/
│   │   └── github/
│   ├── features/
│   │   ├── repositories/
│   │   ├── branches/
│   │   ├── commits/
│   │   ├── accounts/
│   │   └── settings/
│   ├── hooks/
│   ├── lib/
│   ├── types/
│   └── test/
├── src-tauri/
│   ├── src/
│   │   ├── commands/
│   │   ├── git/
│   │   ├── github/
│   │   ├── credentials/
│   │   ├── db/
│   │   ├── services/
│   │   ├── errors/
│   │   └── main.rs
│   ├── capabilities/
│   └── migrations/
├── tests/
│   ├── integration/
│   └── e2e/
├── docs/
├── .github/workflows/
├── package.json
├── pnpm-lock.yaml
└── README.md
```

Bu yapının birebir uygulanması şart değil; modül sınırları korunmalı. Bir modülün sorumlulukları başka bir modülde kopyalanmamalıdır.

---

## 3. Tauri IPC ve veri sözleşmeleri

### 3.1 Genel kural

Her command için:
- İsim, giriş parametreleri, çıkış modeli ve hata sınıfları tanımlanır.
- UI’dan gelen tüm parametreler doğrulanır.
- Büyük veri (uzun diff/history) için limit/pagination uygulanır.
- Hassas değerler command response’unda yalnızca işlev için gerçekten gerekliyse bulunur.
- Rust tarafındaki hata, UI’ın gösterebileceği kararlı bir hata koduna dönüştürülür.

### 3.2 Standart hata modeli

UI tarafında aşağıdaki kavramlara eşdeğer bir model kullan:

```ts
type AppErrorCode =
  | "VALIDATION_ERROR"
  | "GIT_NOT_INSTALLED"
  | "NOT_A_REPOSITORY"
  | "REPOSITORY_NOT_FOUND"
  | "REPOSITORY_BUSY"
  | "DIRTY_WORKTREE"
  | "MERGE_IN_PROGRESS"
  | "REBASE_IN_PROGRESS"
  | "CONFLICTS_PRESENT"
  | "BRANCH_NOT_FOUND"
  | "BRANCH_ALREADY_EXISTS"
  | "NO_UPSTREAM"
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "PERMISSION_DENIED"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "REMOTE_REJECTED"
  | "GIT_COMMAND_FAILED"
  | "CREDENTIAL_STORE_UNAVAILABLE"
  | "DATABASE_ERROR"
  | "CANCELLED"
  | "TIMEOUT"
  | "INTERNAL_ERROR";

type AppError = {
  code: AppErrorCode;
  message: string;           // Kullanıcıya uygun, sır içermeyen mesaj
  safeDetails?: string;      // Redakte edilmiş ayrıntı
  recoveryHint?: string;     // Kullanıcının yapabileceği sonraki adım
  retryable: boolean;
  correlationId: string;
};
```

- `message` doğrudan ham process stderr içeriği olmak zorunda değildir.
- Token, parola, Authorization header, özel anahtar veya hassas dosya içeriği hata nesnesine konamaz.
- Geliştirici logları da redaksiyon kurallarına tabidir.
- `correlationId`, bir işlem boyunca UI ve Rust loglarını eşleştirmek için kullanılır; gizli veri içermez.

### 3.3 İlk command kataloğu

İsimler örnek/önerilen sözleşmedir; uygulama sırasında isim değişirse UI, test ve dokümantasyon birlikte güncellenmelidir.

| Command | Girdi | Beklenen çıktı |
|---|---|---|
| `app_get_environment` | yok | uygulama sürümü, Git var/yok, Git sürümü, OS |
| `repository_pick_directory` | yok | kullanıcı seçtiği path veya iptal |
| `repository_add` | path | repo metadata’sı ve ID |
| `repository_list` | filtre/sıralama | kayıtlı repo listesi |
| `repository_remove` | repoId | kayıt DB’den çıkarılır; dosyalar silinmez |
| `repository_get_status` | repoId | branch, upstream, dosya durumları, operation state |
| `repository_get_branches` | repoId | local/remote branch listesi |
| `repository_create_branch` | repoId, name, baseRef | oluşturulan branch |
| `repository_checkout_branch` | repoId, branch, dirtyPolicy | checkout sonucu |
| `repository_delete_branch` | repoId, branch, force=false | silme sonucu |
| `repository_get_history` | repoId, ref, limit, cursor | commit listesi ve pagination bilgisi |
| `repository_get_diff` | repoId, target, staged, path? | diff metni/metadata’sı |
| `repository_stage_files` | repoId, paths | güncel status |
| `repository_unstage_files` | repoId, paths | güncel status |
| `repository_discard_changes` | repoId, paths, expectedStatusHash, confirmToken | işlem sonucu + güncel status |
| `repository_commit` | repoId, message, amend=false | yeni commit SHA ve status |
| `repository_fetch` | repoId, remote? | fetch sonucu |
| `repository_pull` | repoId, strategy | pull sonucu/status |
| `repository_push` | repoId, remote?, branch?, force=false | push sonucu |
| `repository_get_operation_state` | repoId | merge/rebase/cherry-pick/bisect durumu |
| `github_begin_login` | yok | auth session state/başlangıç bilgisi |
| `github_complete_login` | callback payload/state | bağlı hesap public metadata’sı |
| `github_list_accounts` | yok | hesap metadata’sı; token yok |
| `github_disconnect_account` | accountId | hesap bağlantısı kaldırılır |
| `github_list_repositories` | accountId, pagination/filter | repository listesi |
| `settings_get` | yok | hassas olmayan ayarlar |
| `settings_update` | kısmi ayarlar | kaydedilmiş ayarlar |

**Önemli:** `repository_discard_changes` gibi yıkıcı işlemlerde yalnızca `confirm=true` gibi tahmin edilebilir bir boolean yeterli değildir. UI önce güncel dosya durumunu almalı, etkilenecek yolları ve işlemi göstermeli; onaydan sonra kısa ömürlü `confirmToken` veya eşdeğer işlem bağlamı ile komut çağrılmalıdır. Token kriptografik bir güvenlik sınırı değildir; eski durumla yanlışlıkla işlem yapılmasını önleyen bir tutarlılık mekanizmasıdır.

### 3.4 Frontend veri tazeliği

- Repository mutation sonrası `status`, `branches` ve gerekiyorsa `history` query’leri invalidation ile yenilenir.
- Uzun süren fetch/pull/push sırasında aynı repository için çakışan mutasyon engellenir.
- Farklı repository’ler paralel çalışabilir; global tek bir kilit kullanılmaz.
- Repository bazlı operation lock Rust tarafında tutulur; yalnızca UI disable durumuna güvenilmez.
- Uygulama kapanırken devam eden dış süreçler için tanımlı cancellation/cleanup uygulanır.

---

## 4. Git davranışlarının kesin tanımı

### 4.1 Git kurulum kontrolü

Uygulama açılırken veya ilk repo eklenirken `git --version` kontrolü yapılır.

Git bulunamazsa:
- Yerel repository yönetim özellikleri devre dışı kalır.
- Kullanıcıya işletim sistemine uygun kurulum bağlantısı ve yeniden kontrol seçeneği gösterilir.
- Uygulama çökmemeli veya sonsuz loading’de kalmamalıdır.
- MVP’de Git’i uygulamayla sessizce paketlemek zorunlu değildir.

Git sürümü çok eskiyse uygulama güvenli bir minimum sürüm politikası uygular. Minimum sürüm, uygulama geliştirme başlangıcında güncel Tauri/Git davranışları doğrulanarak belirlenir ve README’de belgelenir.

### 4.2 Repository ekleme

Bir path eklendiğinde:
1. Path canonicalize edilir.
2. Path erişilebilir bir dizin olmalıdır.
3. `git rev-parse --show-toplevel` ile repository kökü tespit edilir.
4. Kullanıcı bir alt dizin seçmişse kök repository eklenir; UI bunu açıkça belirtir.
5. Aynı canonical root zaten kayıtlıysa ikinci kayıt oluşturulmaz.
6. Bare repository algılanırsa MVP’de normal çalışma ağacı özellikleri desteklenmediğinden kullanıcıya açıkça söylenir; uygulama çökmemelidir.
7. Git worktree, submodule ve symlink durumları algılanmaya çalışılır. Tam desteklenmeyen durumlar sessizce yanlış yönetilmez; uyarı gösterilir.
8. Klasörün içeriği değiştirilmez.
9. Klasör DB’ye yalnızca başarılı doğrulamadan sonra eklenir.

### 4.3 Dosya durumları

Git status verisi en az şu durumları ayırt eder:
- Untracked
- Modified, staged
- Modified, unstaged
- Added
- Deleted
- Renamed
- Copied (Git status raporluyorsa)
- Unmerged/conflicted
- Ignored (isteğe bağlı görünüm; varsayılan listede gizlenebilir)

Rename ve merge gibi durumlarda Git’in `X/Y` status kodları doğru parse edilmelidir. Dosya adı özel karakter veya newline içerebilir; satır bazlı parse varsayılanı kullanılmamalıdır. `git status --porcelain=v1 -z` veya doğrulanmış eşdeğer format kullanılabilir.

### 4.4 Stage ve unstage

- Kullanıcı yalnızca seçtiği dosyaları stage/unstage eder.
- “Stage all” ayrı ve açık bir eylemdir; dosya sayısı ve kapsam görünür.
- Untracked dosyalar stage edilebilir.
- Conflict durumundaki dosyalar sıradan stage akışından ayrı ele alınır; çözümün tamamlanmadığı UI’da açıkça gösterilir.
- İşlem başarısızsa UI başarılıymış gibi dosya durumunu değiştirmez.
- İşlemden sonra status yeniden okunur.
- Stage/unstage dosya içeriklerini silmez; yine de işlem hataları açıkça gösterilir.

### 4.5 Discard changes / dosya değişikliklerini geri alma

Bu işlem veri kaybına yol açabilir ve varsayılan olarak güvenli olmalıdır.

Zorunlu kurallar:
- Dosya bazında çalışır; MVP’de tüm çalışma ağacını tek tıklamayla temizleyen bir “discard all” eylemi sunulmaz.
- UI etkilenecek dosya adlarını ve staged/unstaged/untracked kapsamını gösterir.
- Untracked dosyanın silinmesi için ayrı açık uyarı gösterilir.
- İşlemden hemen önce status yeniden okunur; beklenen durumla değişiklik varsa işlem iptal edilir ve kullanıcıdan tekrar onay istenir.
- `git clean -fd` genel olarak kullanılmaz. Untracked dosya silme, canonical path doğrulaması ve izin verilen repository kökü kontrolüyle dosya bazında yapılır.
- Staged değişikliği geri alma ile unstaged değişikliği geri alma birbirinden ayrılır.
- Uygulama, staged ve unstaged değişiklikleri yanlışlıkla tek işlemle yok etmemelidir.
- Symlink, path traversal (`../`) ve repository dışına çıkan path’ler reddedilir.
- Başarılı işlem sonrası status yenilenir ve kullanıcıya sonuç bildirilir.

### 4.6 Branch listeleme ve oluşturma

Branch listesi local ve remote branch’leri ayırt eder. Aktif branch, detached HEAD ve upstream bilgisi ayrı alanlardır.

Branch oluşturma:
- Branch adı Git tarafından kabul edilmeyen biçimdeyse kullanıcı dostu doğrulama hatası gösterilir.
- Varsayılan base aktif branch’tir; base açıkça görünür.
- İsim zaten mevcutsa overwrite yapılmaz.
- Branch oluşturma, checkout ile aynı işlem olmak zorunda değildir; UI hangi davranışın yapılacağını açıkça belirtir.
- Oluşturma sonrası branch listesi ve aktif branch bilgisi yenilenir.

### 4.7 Checkout ve dirty worktree politikası

Checkout öncesi status kontrol edilir.

- Çalışma ağacında değişiklik yoksa checkout normal yapılabilir.
- Checkout hedefiyle çakışabilecek staged/unstaged değişiklikler varsa işlem otomatik olarak stash etmez ve değişiklikleri discard etmez.
- Kullanıcıya üç net seçenek sunulabilir: iptal; değişiklikleri olduğu gibi koruyarak Git’in güvenli checkout’una izin ver (yalnızca Git engellemiyorsa); değişiklikleri önceden kullanıcı tarafından stash et.
- Otomatik stash MVP’de varsayılan değildir.
- Git checkout işlemi başarısızsa orijinal branch ve status yeniden okunur.
- Detached HEAD algılanırsa branch seçici bu durumu açıkça gösterir. Kullanıcı yeni branch oluşturabilir; uygulama detached HEAD’i yanlışlıkla branch gibi göstermemelidir.

### 4.8 Branch silme

- Aktif branch silinemez.
- Silme öncesi kullanıcıya branch adı ve local/remote kapsamı gösterilir.
- Local branch için varsayılan yalnızca Git’in güvenli silme davranışıdır (`-d` eşdeğeri).
- Force delete (`-D`) MVP’de gizli veya varsayılan bir davranış olamaz; eklenirse ayrı uyarı ve açık onay gerektirir.
- Remote branch silme MVP’de P1’e bırakılabilir; sunulursa remote adı ve branch adı birlikte gösterilir ve açık onay istenir.

### 4.9 Commit

Commit öncesi:
1. Mesaj trim edilir; boş mesaj reddedilir.
2. Staged değişiklik yoksa commit engellenir.
3. `user.name` ve `user.email` etkili Git config değerleri kontrol edilir.
4. İsim/e-posta yoksa commit engellenir ve kullanıcıya repository-local identity ayarlama seçeneği verilir.
5. GitHub hesabı bağlı diye otomatik olarak o hesabın ad/e-postası kullanılmaz.
6. Commit hook’ları çalışabilir; uzun süren hook’lar için timeout ve anlaşılır durum gösterilir.
7. Git’in commit işlemi başarısızsa yeni commit varmış gibi UI gösterilmez.
8. Başarılı commit sonrası commit SHA, güncel status ve history yenilenir.

Amend işlemi MVP’de zorunlu değildir. Sunulursa mevcut commit geçmişini değiştirebildiği için ayrı eylem, açıklama ve onay gerektirir.

### 4.10 Fetch

- Fetch çalışma ağacındaki dosya içeriklerini değiştirmez, fakat remote-tracking ref’leri güncelleyebilir.
- Varsayılan remote, repository’de tanımlı upstream/remote kurallarına göre seçilir; belirsizlik varsa kullanıcı seçer.
- Credential hatası, ağ hatası ve remote bulunamaması farklı hata kodlarıyla gösterilir.
- Başarılı fetch sonrası branch/upstream bilgisi yenilenir.
- Fetch, tüm hesaplar arasında otomatik kimlik değiştirmez; Git remote authentication, GitHub API hesabından ayrı ele alınır.

### 4.11 Pull

MVP pull davranışı:
- Önce upstream varlığı kontrol edilir; yoksa `NO_UPSTREAM` döner ve upstream ayarlama yönergesi gösterilir.
- Dirty worktree varken pull işlemi Git’in güvenliğini riske atacak şekilde zorlanmaz.
- Uygulama varsayılan stratejiyi sessizce rebase veya merge olarak değiştirmez.
- Tercih, repository config’teki `pull.rebase`/Git ayarlarıyla çelişiyorsa UI mevcut davranışı açıklar. İlk MVP’de en güvenli yol mevcut Git config’ini izlemek ve işlemi öncesinde özetlemektir.
- Merge conflict oluşursa işlem “başarılı” sayılmaz; `CONFLICTS_PRESENT` veya `MERGE_IN_PROGRESS` gibi durumla sonuçlanır ve conflict ekranına yönlendirilir.
- İşlem sonrası status ve operation state yenilenir.

### 4.12 Push

- Upstream yoksa kullanıcıya branch publish/set-upstream akışı gösterilir.
- Push normalde force kullanmaz.
- Force push MVP’de varsayılan UI akışında bulunmamalıdır. Sonraki sürümde eklenirse `--force-with-lease` tercih edilmeli, branch adı ve remote gösterilmeli, kullanıcı açık onay vermelidir.
- Remote rejection, non-fast-forward, permission/auth ve network hataları ayrıştırılır.
- Başarılı push sonrası upstream durumu ve commit history yenilenir.
- Push sırasında credential’lar loglara veya UI mesajlarına düşmez.

### 4.13 Merge/rebase/conflict ve devam eden işlemler

Uygulama en azından şu repository operation state’lerini algılamalıdır:
- Normal
- Merge in progress
- Rebase in progress
- Cherry-pick in progress
- Revert in progress
- Bisect in progress (bilgilendirme düzeyinde)

Algılama yalnızca stderr mesajına dayanmaz; Git metadata’sı ve doğrulanmış Git durum kontrolleri kullanılır.

Conflict durumunda:
- Conflict dosyaları ayrı listelenir.
- Kullanıcı conflict çözümleyicisi MVP’de yoksa dosya harici editörde açılabilir ve kullanıcı çözümden sonra stage edebilir.
- “Continue”, “abort” gibi eylemler yalnızca doğru operation state’inde gösterilir.
- `merge --abort` / `rebase --abort` veri kaybı yaratabilecek bağlamda olabilir; işlem öncesi etkisi açıklanır ve açık onay alınır.
- Uygulama otomatik `reset --hard` ile conflict çözmeye çalışmaz.
- Çözüm tamamlandı sanılmadan önce Git status yeniden okunur.

### 4.14 Stash

MVP’de stash yönetimi zorunlu değildir. Ancak Git status/checkout/pull akışları stash varlığını engel gibi yanlış yorumlamamalıdır. P1’de eklenirse list, save, apply, pop, drop eylemleri ayrı tasarlanmalı; `pop` conflict oluşturursa stash’in kaybolduğu varsayılmamalıdır.

### 4.15 Submodule ve worktree

MVP’de kapsam sınırlıdır:
- Submodule/worktree algılanıyorsa repository detayında uyarı göster.
- Bu yapılar yanlışlıkla normal dosya veya ayrı repository gibi sunulmamalı.
- Recursive submodule update veya worktree silme otomatik yapılmamalı.
- Desteklenmeyen özel durumda temel repo durumunu yanlış raporlamak yerine “bu repository türü için destek sınırlı” mesajı göster.

---

## 5. Git süreç yürütme ve güvenlik

### 5.1 Komut oluşturma

- `Command::new("git").args([...])` benzeri argüman dizisi yaklaşımı kullan.
- `sh -c`, `cmd /C`, PowerShell üzerinden kullanıcı girdisini birleştirme **yasaktır**.
- Kullanıcıdan gelen branch adı, dosya yolu, remote adı veya commit mesajı doğrudan shell’e eklenmez.
- Mümkün olan yerlerde `--` ile option terminator kullanılır.
- Dosya yolu için repository kökü dışında işlem yapılmasına izin verilmez.
- Komut için çalışma dizini yalnızca DB’de kayıtlı ve doğrulanmış canonical repository root olabilir.

### 5.2 Timeout ve iptal

- Salt-okuma komutlarında kısa, yapılandırılabilir timeout kullan.
- Network işlemleri için daha uzun ama sınırlı timeout uygula.
- Timeout, process’in gerçekten sonlandırıldığını garanti edecek şekilde ele alınır; sadece UI loading’i kapatmak yeterli değildir.
- İptal edilen komutun sonucu `CANCELLED` olarak raporlanır ve repository state yeniden okunur.
- Git hook’ları ve credential helper’ları etkileşim bekleyebilir; UI’da takılma yaratmamalıdır. Gerekli terminal etkileşimi MVP’de desteklenmiyorsa timeout/uyarı ve README açıklaması olmalıdır.

### 5.3 Çıktı ve loglar

- stdout/stderr için makul boyut limitleri belirlenir; büyük diff’ler için pagination/streaming veya limitli gösterim kullanılır.
- Loglarda token, parola, HTTP Authorization header, private key, kullanıcıya ait hassas dosya içeriği bulunamaz.
- Hata mesajı içindeki olası credential alanları redakte edilir.
- Debug logging varsayılan olarak hassas veri toplamaz.
- Kullanıcı “diagnostics export” isterse paylaşılacak içerik önizlenmeli ve hassas değerler çıkarılmalıdır.

### 5.4 Repository path güvenliği

- Repository path canonicalize edilir.
- Symlink çözümlemesi ve platform path kuralları dikkate alınır.
- `..`, mutlak path, drive prefix, UNC path ve symlink ile repository dışına kaçma denemeleri test edilir.
- Discard/delete gibi işlemlerde hedefin canonical path’i repository kökünün altında olduğundan emin olunur.
- Repository kayıt path’i artık mevcut değilse kayıt silinmez; “missing repository” durumu gösterilir ve kullanıcıya kaydı kaldırma seçeneği sunulur.

### 5.5 Tauri izinleri

- Tauri 2 capability/permission tanımları en az yetki ilkesine göre hazırlanır.
- UI’ya keyfî shell çalıştırma yetkisi verilmez.
- Yalnızca gerekli command’ler invoke edilebilir.
- CSP dar tutulur; gerekçesiz `unsafe-eval` veya geniş kaynak wildcard’ları eklenmez.
- External URL açma yalnızca izin verilen HTTPS adresleri için yapılır.
- OAuth callback handler ve deep link mekanizması, güvenilir olmayan callback payload’larını doğrular.

---

## 6. GitHub OAuth ve çoklu hesap

### 6.1 Hesap kavramlarını ayır

Üç ayrı kimlik kavramı UI ve veri modelinde ayrılmalıdır:

1. **GitOrbit GitHub hesabı:** GitHub REST API çağrıları için seçilen OAuth bağlantısı.
2. **Git commit identity:** `git config user.name` ve `git config user.email`; commit metadata’sını belirler.
3. **Git remote authentication:** Git’in HTTPS credential helper’ı veya SSH anahtarı üzerinden remote’a erişimi.

Bunlardan birini değiştirmek diğerlerini otomatik değiştirmemelidir.

### 6.2 OAuth akışına ilişkin zorunlu güvenlik ilkeleri

OAuth entegrasyonu kodlanmadan önce GitHub’ın güncel resmi dokümantasyonu kontrol edilmelidir. Desteklenen uygulama tipine göre **GitHub App / OAuth App** ve masaüstü public-client kısıtları değerlendirilmelidir.

- Uygulama binary’sine client secret gömülmez.
- OAuth `state` değeri güçlü rastgelelik ile oluşturulur, callback’te birebir doğrulanır ve tek kullanımlıktır.
- Desteklenen akış PKCE gerektiriyorsa PKCE uygulanır. GitHub’ın seçilen uygulama tipinde desteklemediği bir parametre varmış gibi varsayım yapılmaz.
- Redirect/deep-link callback yalnızca beklenen scheme/host/path ile kabul edilir.
- Callback başka bir uygulama veya kötü niyetli URL tarafından tetiklenmiş olabilir; tüm parametreler doğrulanır.
- Token exchange, uygulama türünün desteklediği resmi akışa göre yapılır. Secret gerektiren bir akış, secret’ı istemciye gömerek “çalışır hale” getirilmez.
- Token scope’ları minimum gerekli yetkiyle sınırlandırılır.
- Token’lar loglanmaz, UI’a gönderilmez, SQLite’a yazılmaz ve URL’ye eklenmez.
- Token storage için OS credential store kullanılır; credential store kullanılamıyorsa token düz metin fallback’ine geçilmez.
- Logout/disconnect, uygulamadaki token’ı ve bağlantı metadata’sını tanımlı biçimde temizler. Git’in kendi credential helper kayıtları ayrıca açıklanır; sessizce silinmez.
- Hesap bağlantısı koparsa GitHub API istekleri `AUTH_REQUIRED`/`AUTH_EXPIRED` olarak sınıflandırılır.

### 6.3 Çoklu hesap veri modeli

`github_accounts` tablosunda yalnızca hassas olmayan metadata tutulur:
- `id` (UUID)
- `provider` (`github`)
- `provider_user_id`
- `login`
- `display_name` (varsa)
- `avatar_url` (varsa)
- `created_at`
- `last_used_at`
- `credential_ref` (OS credential store içindeki anahtar referansı; token değil)
- `connection_status`

Token yalnızca OS credential store’da, hesap ID’siyle ilişkilendirilmiş bir anahtar altında saklanır.

Aynı GitHub hesabı tekrar bağlanırsa mükerrer kayıt oluşturmak yerine mevcut hesap yenilenir veya kullanıcıya açık seçim sunulur. Hesap listesi token içermeyen DTO döndürür.

### 6.4 Repository listeleme

- GitHub API pagination zorunludur; yalnızca ilk sayfa gösterilip “tüm repolar” denmemelidir.
- Kullanıcıya ait repository’ler ile organization repository’leri, yetki varsa, ayırt edilir.
- Private repository görünürlüğü OAuth scope ve hesap yetkisine bağlıdır.
- API rate limit bilgisi kullanıcıya açıklanır; otomatik retry rate-limit reset zamanına saygı duyar.
- API’dan alınan repository URL’si ve açıklaması güvenilmeyen dış veri olarak ele alınır; HTML olarak doğrudan render edilmez.
- GitHub repository listesi, yerel klonlanmış repository listesiyle aynı şey değildir. UI “GitHub’da” ve “Bu cihazda” durumlarını ayırır.
- Clone eylemi sunulursa hedef dizin kullanıcı tarafından seçilir; var olan klasörün üzerine yazılmaz.

### 6.5 API hata politikası

| HTTP / durum | UI davranışı |
|---|---|
| 401 | Hesap bağlantısı geçersiz/sona ermiş olabilir; yeniden bağlanma öner |
| 403 rate limit | Reset zamanı varsa göster; aşırı retry yapma |
| 403 permission | İzin/scope yetersizliğini açıkla |
| 404 | Repo erişilemiyor veya bulunamadı; özel repo gizleme davranışını hesaba kat |
| 422 | İstek doğrulama hatası; kullanıcıya eyleme dönük mesaj |
| 5xx | Geçici servis hatası; sınırlı retry ve tekrar dene |
| Timeout/offline | Yerel Git özellikleri çalışmaya devam eder; API özelliği offline durumu gösterir |

Retry yalnızca idempotent veya tekrar edilmesi güvenli isteklerde otomatik yapılır. Repository yaratma gibi mutasyonlarda kör retry yapılmaz.

---

## 7. SQLite şeması ve veri yaşam döngüsü

### 7.1 Genel kurallar

- SQLite foreign key enforcement etkinleştirilir.
- Migration’lar sürümlenir ve transaction içinde uygulanır.
- Her migration test edilir.
- DB’ye token, parola veya private key yazılmaz.
- DB bozulması/erişilememe durumu UI’da ele alınır; uygulama sessizce yeni boş DB oluşturup eski veriyi kaybetmiş gibi davranmamalıdır.
- Repository kaldırma, varsayılan olarak yalnızca GitOrbit kayıtlarını kaldırır; dosya sistemindeki repository silinmez.

### 7.2 Önerilen tablolar

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  canonical_path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  remote_summary_json TEXT,
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE github_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider = 'github'),
  provider_user_id TEXT NOT NULL,
  login TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  credential_ref TEXT NOT NULL,
  connection_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

Şema değişiklikleri gerektiğinde migration eklenir; var olan kullanıcı DB’si silinerek güncellenmez.

### 7.3 Verinin silinmesi

- “Repository’yi kaldır” = GitOrbit listesi/metadata’sından çıkar; klasör silinmez.
- “GitHub hesabını ayır” = GitOrbit’in credential store referansını ve hesap metadata’sını temizle; Git remote credential’ını otomatik silme.
- “Uygulama verilerini sıfırla” gibi bir özellik varsa etkilenecek veri kategorileri açıkça listelenir ve onay alınır.
- Uygulama kaldırıldığında yerel repository dosyaları korunur. Uygulama DB’sinin kaldırılması işletim sistemi/uninstaller davranışına göre belgelenir.

---

## 8. UI/UX davranış sözleşmesi

### 8.1 Ana yerleşim

Modern IDE benzeri masaüstü arayüzü:

- Sol sidebar: repository/workspace ve gezinme.
- Üst bar: aktif repository, branch seçici, global komut/arama alanı.
- Ana içerik: seçili görünüm (Changes, History, Branches, GitHub).
- Sağ/alt panel: diff/detail alanı; pencere boyutuna göre uyarlanabilir.
- Alt durum çubuğu: aktif branch, repository durumu, arka plan işlemi ve hata bildirimi.

Küçük pencere boyutlarında içerik üst üste binmemeli; yatay scroll zorunlu hale gelmeden önce paneller daraltılabilir veya ayrılabilir olmalıdır.

### 8.2 Temel ekranlar

1. **Welcome / Setup:** Git kontrolü, ilk repository ekleme, GitHub hesabı bağlama.
2. **Repository listesi:** Son açılanlar, path, branch, durum ve bulunamayan repository işareti.
3. **Changes:** Staged, unstaged, untracked ve conflict grupları.
4. **Diff viewer:** Dosya adı, diff türü, satır numaraları, syntax-aware görünüm mümkünse; binary/çok büyük dosyada uygun uyarı.
5. **History:** Commit SHA kısa gösterimi, mesaj, yazar, tarih; pagination.
6. **Branches:** Local/remote ayrımı, aktif branch, upstream, checkout/create/delete eylemleri.
7. **GitHub Accounts:** Bağlı hesaplar, aktif API hesabı, bağla/ayır.
8. **GitHub Repositories:** Search, pagination, private/public etiketi, local clone durumu.
9. **Settings:** Tema, varsayılan clone klasörü, diff tercihleri, gizlilik/log düzeyi, hesap yönetimi, Git ortam bilgisi.

### 8.3 UI durumları

Her ana ekran aşağıdaki durumların hepsini tasarlamalıdır:
- İlk yükleme
- Başarılı veri
- Boş durum
- Hata
- Offline
- Yetki eksikliği
- Loading/işlem sürüyor
- İşlem iptal edildi
- Kısmi veri veya pagination devamı
- Repository artık mevcut değil
- Repository başka bir Git işlemi nedeniyle meşgul

Sonsuz spinner yasaktır. Her loading durumu hata/iptal/başarıya ulaşmalıdır.

### 8.4 Klavye ve erişilebilirlik

- Tüm ana eylemler klavyeyle erişilebilir olmalı.
- Focus indicator görünür olmalı.
- Modal açılınca focus modal içine alınmalı ve kapanınca önceki elemana dönmeli.
- Klavye kısayolları Settings/Help içinde listelenmeli.
- İşletim sistemi ve uygulama kısayollarıyla çakışma kontrol edilmeli.
- Renk tek başına durum anlatmamalı; ikon/metin/erişilebilir etiket eklenmeli.
- Diff satırlarında seçilebilir metin ve yeterli kontrast sağlanmalı.

### 8.5 Onay modalı standardı

Yıkıcı veya remote etkili eylem modalı şu bilgileri içerir:
- Eylemin açık adı.
- Etkilenecek repository, branch, remote veya dosyalar.
- Veri kaybı/remote etkisi açıklaması.
- İptal ve açıkça adlandırılmış onay düğmesi.
- Gerekirse branch adını yazma gibi ek onay.
- Onay verilene kadar hiçbir mutasyon başlamaz.

---

## 9. Performans ve eşzamanlılık

- UI ana thread’i Git process veya ağ çağrısıyla bloklanmaz.
- History/diff listeleri sınırlı yüklenir; büyük repository’lerde tüm geçmiş tek seferde belleğe alınmaz.
- Repository başına mutasyon kilidi bulunur.
- Salt-okuma sorguları gerektiğinde paralel çalışabilir; aynı anda branch değiştirme ve commit gibi çakışan işlemler kilitlenir.
- Dosya status yenilemesi gereksiz şekilde çok sık polling yapmaz.
- Büyük diff’lerde maksimum görüntülenen boyut ve “tam diff’i harici aç” davranışı tanımlanır.
- SQLite işlemleri kısa transaction’larla yapılır.
- Uzun ağ istekleri timeout ve cancellation destekler.
- UI bir işlemi iptal ettiğinde Rust tarafındaki işlem de mümkün olduğunca durdurulmalıdır.

Önerilen başlangıç performans hedefleri, test makinesi ve repository büyüklüğü belgelenerek ölçülmelidir:
- Soğuk uygulama açılışı: hedef < 3 saniye (referans donanımda).
- Küçük repository status: hedef < 500 ms (yerel disk ve Git durumuna bağlı).
- UI etkileşimleri: normal durumda 100 ms içinde görsel geri bildirim.
Bunlar mutlak garanti değil, ölçülecek hedeflerdir; benchmark yöntemi README/developer docs içinde yer almalıdır.

---

## 10. Test stratejisi

### 10.1 Test katmanları

**Rust unit tests**
- Path canonicalization ve path traversal koruması.
- Git status parser; boşluk, Unicode, newline içeren dosya adları.
- Hata sınıflandırma.
- DB model ve migration.
- Credential store adapter’ının mock davranışı.

**Git integration tests**
Her test geçici bir Git repository oluşturmalı; test ortamında kullanıcının gerçek repository’sine dokunulmamalıdır.

- Temiz repository status.
- Untracked/modified/staged/deleted/renamed dosyalar.
- Dosya isimlerinde Unicode ve boşluk.
- Branch oluşturma/checkout/silme.
- Dirty worktree’de checkout.
- Boş staged set ile commit.
- Eksik `user.name`/`user.email`.
- Fetch/pull/push için local bare remote ile senaryolar.
- Non-fast-forward push rejection.
- Merge conflict ve conflict sonrası state.
- Merge/rebase in progress algılama.
- Repository path silinmiş veya erişilemez.
- Git bulunamıyor durumu (PATH override/mock).
- Komut timeout/cancel.
- Aynı repo üzerinde iki mutasyonun çakışması.

**Frontend tests**
- Loading/empty/error/offline state.
- Stage/unstage sonrası status invalidation.
- Destructive confirmation.
- OAuth callback hataları ve state mismatch.
- Birden çok hesap seçimi.
- Klavye navigasyonu ve modal focus.

**E2E**
- Temiz açılış → repository ekleme → değişiklik yapma → stage → commit → history’de doğrulama.
- İkinci branch oluşturma → checkout → status doğrulama.
- GitHub bağlantısı başarısız/iptal edildiğinde güvenli UI.
- Repository kaldırıldığında disk klasörünün durması.
- Uygulama kapanıp açıldığında repository kayıtlarının korunması.

### 10.2 Kritik kabul testleri

Aşağıdaki testler geçmeden MVP “tamamlandı” sayılmaz:

| ID | Senaryo | Beklenen sonuç |
|---|---|---|
| GT-001 | Geçerli repo eklenir | Tek DB kaydı; klasör değişmez |
| GT-002 | Aynı repo tekrar eklenir | Duplicate kayıt oluşmaz |
| GT-003 | Geçersiz path eklenir | Hata gösterilir; DB değişmez |
| GT-004 | Git kurulu değildir | Uygulama çökmek yerine kurulum yönlendirmesi gösterir |
| GT-005 | Staged dosya commit edilir | Yeni commit SHA görünür; history/status yenilenir |
| GT-006 | Staged dosya yokken commit | Commit oluşmaz; kullanıcıya açıklama gösterilir |
| GT-007 | Git identity eksik | Commit engellenir; identity ayarlama önerilir |
| GT-008 | Branch checkout dirty değişiklikle çakışır | Otomatik discard/stash yapılmaz |
| GT-009 | Discard işlemi öncesi dosya durumu değişmiştir | İşlem iptal edilir; tekrar onay istenir |
| GT-010 | Repository kaldırılır | DB kaydı kaldırılır; disk içeriği durur |
| GT-011 | GitHub token’ı okunamaz | Token düz metin fallback’i yapılmaz |
| GT-012 | OAuth state uyuşmaz | Callback reddedilir |
| GT-013 | API rate limit | Retry fırtınası olmaz; kullanıcıya durum gösterilir |
| GT-014 | Push non-fast-forward ile reddedilir | Hata anlaşılır gösterilir; force push otomatik yapılmaz |
| GT-015 | Merge conflict | Conflict state gösterilir; `reset --hard` çalışmaz |
| GT-016 | Repository path dışına çıkan dosya yolu | İşlem reddedilir |
| GT-017 | Aynı repo için çakışan iki mutation | Biri kilitlenir veya açıkça reddedilir |
| GT-018 | Token içeren hata/trace | Loglarda token bulunmaz |
| GT-019 | Uygulama yeniden başlatılır | Kayıtlı repo ve hassas olmayan ayarlar korunur |
| GT-020 | DB migration başarısız | Kullanıcı verisi sessizce silinmez; hata gösterilir |

### 10.3 Test kalite kapısı

Her pull request için en az:
1. Formatter/lint.
2. TypeScript typecheck.
3. Frontend unit tests.
4. Rust tests.
5. Build.
6. Dependency/security audit’in uygun ve uygulanabilir kısmı.

Kritik Git güvenlik testleri atlanarak release oluşturulamaz. Testi geçmeyen davranış “çalışıyor gibi” gösterilmemelidir.

---

## 11. Platform, kurulum ve dağıtım

### 11.1 Linux-first

İlk geliştirme ve doğrulama Linux’ta yapılır. En az bir yaygın dağıtım ailesi için paketleme belgelenir; örneğin `.deb`/AppImage gibi formatlardan hangilerinin resmi MVP hedefi olduğu proje README’sinde kesinleştirilir.

Linux’ta:
- Git yoksa açık yönlendirme.
- Secret service/keyring erişimi yoksa güvenli hata; düz metin fallback yok.
- Dosya izinleri ve XDG data/config konumları doğru kullanılır.
- Wayland/X11 farkları ve external browser/deep-link akışı test edilir.

### 11.2 Windows ve macOS

Platformlar için:
- Credential store adapter’ı OS’ye uygun backend kullanır (Windows Credential Manager, macOS Keychain, Linux secret service/keyring).
- OS’ye özgü dosya yolları hardcode edilmez.
- Windows drive letter/UNC path ve macOS/Linux case sensitivity farkları test edilir.
- Paketleme ve imzalama gereksinimleri README’de açıklanır.
- Release pipeline platform build’lerini ayrı işlerde üretir.
- İmzalama sertifikası veya Apple developer hesabı yoksa release durumu dürüstçe açıklanır; imzalı paket varmış gibi sunulmaz.

### 11.3 Güncelleme ve kaldırma

- Uygulama güncellemesi sırasında kullanıcı repository dosyalarına dokunulmaz.
- DB migration başarısızsa eski veriyi koruma/geri dönüş stratejisi olmalıdır.
- Uygulama kaldırma yerel repository’leri silmez.
- Uygulama verisi/credential temizliği için açık dokümantasyon bulunur.
- Otomatik updater MVP’de zorunlu değildir; varsa imza ve güncelleme kaynağı doğrulaması gerekir.

---

## 12. Geliştirme fazları ve iş listesi

Her faz, kendi kabul kriterleri geçmeden sonraki faza geçilmemesi gereken bir teslimattır. AI coding aracına bir defada tüm fazları kodlatmak yerine faz başına görev ver.

### Faz 0 — Repo iskeleti ve kalite kapısı
**İşler**
- Tauri 2 + React + TypeScript proje iskeleti.
- Tailwind ve temel tasarım token’ları.
- Lint, formatter, typecheck, test komutları.
- CI workflow.
- README: geliştirme ortamı, run/test/build.

**Kabul**
- Linux’ta temiz checkout’tan dokümante edilen komutlarla uygulama açılır.
- Lint/typecheck/test/build komutları çalışır.
- Secret veya gerçek kullanıcı token’ı repoya eklenmez.

### Faz 1 — Desktop shell ve UI iskeleti
**İşler**
- Sidebar, top bar, status bar.
- Welcome, repository list, Changes, History, Branches, Settings placeholder ekranları.
- Loading/empty/error component’leri.
- Klavye focus ve tema temeli.

**Kabul**
- Mock verilerle tüm ekranlar arasında gezinilebilir.
- UI dar pencere boyutlarında bozulmaz.
- Ana aksiyonların hiçbiri sahte başarı mesajı vermez.

### Faz 2 — Rust Git adapter ve repository kayıtları
**İşler**
- Git availability/version.
- Repository picker/add/list/remove.
- Canonical path doğrulaması.
- SQLite migration ve repository kayıtları.
- Git status parser.

**Kabul**
- Gerçek geçici repository eklenir ve status gösterilir.
- Invalid path ve duplicate path testleri geçer.
- Remove repository klasörü silmez.
- Özel karakterli dosya isimleri doğru parse edilir.

### Faz 3 — Changes ve diff
**İşler**
- Staged/unstaged/untracked grupları.
- Stage/unstage.
- Diff viewer.
- Discard için güvenli confirmation flow.

**Kabul**
- UI durumu gerçek `git status` ile uyuşur.
- Discard için ikinci durum kontrolü vardır.
- Path traversal testi geçer.
- Büyük/binary dosyalar UI’ı kilitlemez.

### Faz 4 — Branch ve commit
**İşler**
- Branch list/create/checkout/delete.
- Detached HEAD görünümü.
- Git identity guard.
- Commit formu ve history listesi.

**Kabul**
- Commit sonrası SHA ve history doğru görünür.
- Dirty worktree checkout sırasında otomatik veri kaybı olmaz.
- Aktif branch silinemez.
- Boş commit mesajı ve staged değişiklik yokken commit engellenir.

### Faz 5 — Remote işlemleri
**İşler**
- Fetch, pull, push.
- Upstream bilgisi.
- Operation state ve conflict detection.
- Network timeout/cancel ve hata eşleme.

**Kabul**
- Local bare remote ile integration testleri geçer.
- Non-fast-forward push otomatik force’a dönüştürülmez.
- Conflict sırasında destructive reset yapılmaz.
- İşlem sonrası repository state yenilenir.

### Faz 6 — GitHub hesapları ve repository API
**İşler**
- OAuth uygulama türü ve akışını güncel resmi dokümana göre doğrula.
- Secure desktop login, callback/state validation.
- Credential store abstraction.
- Çoklu hesap listesi, bağla/ayır.
- Repository listesi, pagination ve rate limit.

**Kabul**
- Token düz metin DB/log içine düşmez.
- OAuth state mismatch reddedilir.
- İkinci hesap eklemek ilk hesabı ezmez.
- API offline/rate-limit/permission hataları ayrı gösterilir.
- OAuth akışı yalnızca gerçek credential ile güvenli test edilebiliyorsa release öncesi manuel test de belgelenir.

### Faz 7 — Sertleştirme ve release adayı
**İşler**
- E2E testler.
- Platform CI/build.
- Erişilebilirlik ve hata durumları denetimi.
- Dependency audit ve lisans envanteri.
- Release checklist ve kullanıcı dokümantasyonu.

**Kabul**
- Kritik test matrisi geçer.
- Yeni kullanıcı için kurulum/run dokümantasyonu yeterlidir.
- Bilinen sınırlamalar ve desteklenen platformlar açıkça listelenir.
- Release paketi, desteklenen her platformda temiz ortamda smoke-test edilir.

---

## 13. AI coding aracı için çalışma protokolü

Bu bölüm, geliştirme boyunca araca verilecek operasyonel talimattır.

### 13.1 Ana talimat

> Sen GitOrbit projesinde kıdemli masaüstü uygulama ve sistem mühendisi olarak çalışıyorsun. `GitOrbit_System_Design_PRD.md` ve `GitOrbit_Engineering_Specification_v1.1.md` dosyalarını birlikte oku. Bu belgeler normatif gereksinimlerdir.
>
> Kod yazmaya başlamadan önce mevcut repository yapısını incele ve kısa bir uygulama planı çıkar. Sonra yalnızca istenen fazı uygula. Tüm fazları tek seferde geliştirmeye çalışma.
>
> Her görevde:
> 1. İlgili gereksinim ve kabul kriterlerini belirt.
> 2. En küçük tutarlı değişikliği yap.
> 3. Test ekle veya güncelle.
> 4. Formatter, lint, typecheck, ilgili testler ve build çalıştır.
> 5. Başarısız test varsa nedenini bul; testi devre dışı bırakarak başarı elde etme.
> 6. Değişen dosyaları ve alınan mimari kararları özetle.
> 7. Tamamlanmayan işleri ve bilinen sınırlamaları açıkça yaz.
> 8. Gerçekten çalıştırılmamış komutları çalıştırılmış gibi bildirme.
>
> Güvenlik kuralları:
> - Kullanıcı girdisini shell komut string’ine birleştirme.
> - Token/parola/private key’i loglama veya SQLite’a yazma.
> - Force push, `reset --hard`, `clean -fd` veya eşdeğer yıkıcı davranışı otomatik çalıştırma.
> - Repository dışına path erişimi oluşturma.
> - Test amacıyla kullanıcının gerçek repository’sini değiştirme; geçici test repository’leri oluştur.
> - OAuth client secret’ını istemci binary’sine gömme.
> - Gereksinim belirsizse veri kaybına yol açacak varsayım yapma; önce sor veya güvenli davranışı seç.
> - UI’da sahte/placeholder eylemleri gerçekmiş gibi gösterme.
>
> Her faz sonunda:
> - Değişen dosyalar
> - Uygulanan gereksinimler
> - Çalıştırılan komutlar ve gerçek sonuçları
> - Test kapsamı
> - Bilinen eksikler
> - Sonraki faz için önerilen görev
> başlıklarını içeren kısa bir rapor üret.

### 13.2 Faz başlatma prompt’u

Her faz için aşağıdaki şablonu kullan:

```text
GitOrbit için Engineering Specification v1.1 içindeki Faz N'yi uygula.

Önce mevcut kodu ve ilgili doküman bölümünü incele. Uygulamaya başlamadan önce:
1. Bu fazın kapsamını ve kabul kriterlerini özetle.
2. Etkilenecek dosyaları ve testleri listele.
3. Güvenlik veya mimari belirsizlikleri belirt.

Ardından yalnızca bu fazı uygula. Testleri yaz/ güncelle; formatter, lint, typecheck, ilgili testler ve build çalıştır. Testler başarısızsa kök nedeni düzelt. Çalıştırmadığın testi geçmiş gibi gösterme. Kabul kriterlerinin her birini PASS/FAIL/NOT RUN olarak raporla. Sonraki faza geçme.
```

### 13.3 Hata düzeltme prompt’u

```text
Aşağıdaki hata GitOrbit Engineering Specification v1.1 gereksinimleri bağlamında incelenecek.

Önce hatayı yeniden üret ve ilgili logları hassas bilgi açısından kontrol et. Ardından kök nedeni açıkla. En küçük doğru düzeltmeyi yap ve regresyon testi ekle. Güvenlik kontrolünü kaldırarak, testi atlayarak veya hata mesajını gizleyerek düzeltme yapma. Sonunda ilgili testleri ve build'i çalıştır; gerçek sonuçları raporla.

Hata:
[buraya gerçek hata çıktısı]
```

### 13.4 Kod inceleme prompt’u

```text
GitOrbit değişikliklerini PR review gibi incele. Öncelik sırası:
1. Veri kaybı ve Git davranışı hataları
2. Credential/OAuth/path traversal/shell injection güvenliği
3. Race condition ve işlem kilitleri
4. Hata durumları ve yanlış başarı mesajları
5. Test eksikleri
6. Performans ve erişilebilirlik
7. Kod kalitesi

Bulduğun her sorun için dosya/işlev, senaryo, etki seviyesi ve düzeltme önerisi yaz. Yalnızca stil tercihi olan noktaları kritik hata gibi sunma. Kanıt olmadan güvenli olduğunu iddia etme.
```

---

## 14. Definition of Done (DoD)

Bir özellik ancak aşağıdakilerin tümü geçerliyse tamamlanmıştır:

- [ ] Gereksinim açık ve kabul kriterleri test edilebilir.
- [ ] UI, loading/empty/error/offline durumlarını ele alıyor.
- [ ] Rust katmanı girişleri doğruluyor.
- [ ] Güvenlik ve veri kaybı riski değerlendirildi.
- [ ] Uygun unit/integration/E2E testleri eklendi veya gerekçeli olarak kapsam dışı bırakıldı.
- [ ] Formatter/lint/typecheck ilgili testler ve build çalıştırıldı.
- [ ] Test sonuçları gerçek; atlanan testler açıkça işaretlendi.
- [ ] Hassas veri loglarda/DB’de görünmüyor.
- [ ] Dokümantasyon ve README güncellendi.
- [ ] Bilinen sınırlamalar ve platform farkları kaydedildi.
- [ ] UI’da çalışmayan özellik gerçek özellik gibi gösterilmiyor.

---

## 15. Release öncesi kontrol listesi

### Güvenlik
- [ ] Shell string interpolation yok.
- [ ] Token’lar OS credential store’da.
- [ ] OAuth state/callback doğrulaması test edildi.
- [ ] Client secret binary’ye gömülmüyor.
- [ ] Path traversal ve symlink sınırları test edildi.
- [ ] Yıkıcı Git işlemleri açık onay istiyor.
- [ ] Loglar credential redaction testinden geçiyor.
- [ ] Tauri capability/CSP izinleri minimum seviyede.

### Git doğruluğu
- [ ] Dirty worktree checkout/pull testleri geçiyor.
- [ ] Commit identity guard çalışıyor.
- [ ] Non-fast-forward push güvenli hata veriyor.
- [ ] Conflict state algılanıyor; otomatik hard reset yok.
- [ ] Repository remove yerel klasörü silmiyor.
- [ ] Git yok/çok eski/path bulunamıyor durumları ele alınıyor.

### Ürün kalitesi
- [ ] Boş ve hata durumları tasarlandı.
- [ ] Klavye navigasyonu test edildi.
- [ ] Offline yerel işlevleri bozmaz.
- [ ] Temiz ortamda kurulum ve başlatma test edildi.
- [ ] Bilinen sınırlamalar README’de açık.
- [ ] Release artefact’ları gerçek platformlarda smoke-test edildi.

---

## 16. Açık kararlar ve nasıl kapatılacakları

Aşağıdaki konular kod başlamadan önce değil, ilgili fazdan hemen önce resmi dokümantasyon ve küçük prototiple doğrulanmalıdır:

1. **GitHub uygulama türü ve OAuth akışı:** GitHub’ın güncel resmi dokümantasyonuna göre seç; istemciye secret gömme gerektiren tasarımı kabul etme.
2. **Linux credential store kütüphanesi:** Tauri/Rust ekosistemindeki güncel, bakımlı seçenekleri ve dağıtım uyumluluğunu incele.
3. **Resmi paket formatları:** MVP için desteklenecek Linux paketlerini ürün sahibinin dağıtım hedefi ve CI imkânına göre seç.
4. **Minimum Git sürümü:** Kullanılan porcelain formatları ve komut seçeneklerine göre belirle.
5. **UI ikon seti ve tasarım token’ları:** Erişilebilirlik ve lisans şartlarını doğrula.
6. **Otomatik güncelleme:** MVP dışı tut; eklenecekse imza ve güven zinciri tasarla.
7. **GitHub organization/private repo kapsamı:** Seçilen OAuth scope ve App izinlerine göre netleştir.

Karar alındığında `docs/adr/` altında kısa Architecture Decision Record (ADR) oluştur: bağlam, seçenekler, karar, sonuçlar ve tarih.

---

## 17. Bilinen sınırlar ve dürüst beklenti

Bu belge, geliştirmenin çok daha kesin ve test edilebilir yürütülmesini sağlar; ancak kendi başına çalışan bir yazılım değildir. Gerçek uygulamanın kalitesi şu unsurlara bağlıdır:
- AI coding aracının proje dosyalarına erişimi ve komut çalıştırma yeteneği,
- fazların gerçekten uygulanması,
- Git ve OAuth gibi dış sistemlerle test yapılması,
- hata çıktılarının analiz edilip düzeltilmesi,
- hedef işletim sistemlerinde paketlerin çalıştırılarak doğrulanması.

Özellikle OAuth, işletim sistemi credential store, Git conflict davranışları ve Windows/macOS paketleme gerçek ortamda doğrulanmalıdır. “Build geçti” tek başına “ürün güvenli ve tamam” anlamına gelmez.

**MVP tamamlandı denebilmesi için:** Faz 0–7 uygulanmalı, kritik kabul testleri geçmeli, bilinen sınırlamalar belgelenmeli ve desteklenen platformlarda release adayı gerçek ortamda test edilmelidir.

---

## 18. AI coding aracı için ilk görev

Bu dosyaları araca ekledikten sonra ilk olarak şu görevi ver:

```text
GitOrbit projesini başlatıyoruz. GitOrbit_System_Design_PRD.md ve
GitOrbit_Engineering_Specification_v1.1.md dosyalarını oku.

Henüz uygulamanın tüm özelliklerini kodlama. Önce:
1. Çalışma dizinini ve mevcut dosyaları incele.
2. Faz 0 kapsamını ve kabul kriterlerini çıkar.
3. Makinede Node.js/package manager, Rust/Cargo, Tauri gereksinimleri ve Git durumunu kontrol etmek için çalıştırılması gereken komutları listele. Yetkin varsa bunları çalıştır ve gerçek sonuçları raporla.
4. Eksik ortam bağımlılıklarını tespit et.
5. Faz 0 için minimal dosya ve test planı oluştur.
6. Plan onaylandıktan sonra yalnızca Faz 0'ı uygula.

Herhangi bir gerçek GitHub token'ı isteme ve kullanma. Secret ekleme. Henüz OAuth veya Git mutasyonları kodlama.
```

---

## 19. Sonuç

`GitOrbit_System_Design_PRD.md` ile bu mühendislik spesifikasyonu birlikte kullanıldığında, AI coding aracına ürünün amacı, mimarisi, kritik Git davranışları, güvenlik kuralları, API sınırları, test yaklaşımı ve geliştirme sırası konusunda çok daha sağlam bir temel verilir.

En doğru uygulama yöntemi: **Faz 0 → doğrula → Faz 1 → doğrula → … → Faz 7 → release checklist.** Bir fazın kabul kriterleri geçmeden sonraki faza atlama. Bu yaklaşım, tek seferde büyük miktarda kod üretmekten daha yavaş görünebilir; fakat hatalı mimariyi, sessiz veri kaybını ve test edilmemiş özelliklerin tamamlanmış sanılmasını azaltır.
