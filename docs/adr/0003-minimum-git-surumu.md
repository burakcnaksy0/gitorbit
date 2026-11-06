# ADR-0003 — Minimum Git Sürümü Politikası

- **Durum:** Kabul edildi
- **Tarih:** 2026-11-06
- **İlgili gereksinimler:** Spec v1.1 §4.1, §16.4

## Bağlam

GitOrbit, Git motorunu sıfırdan yazmaz; sistemdeki Git CLI'ı kullanır (PRD ADR-003). Hangi makine tarafından ayrıştırılabilir (machine-readable) çıktı sözleşmelerine güvenileceği, desteklenecek minimum Git sürümünü belirler.

## Karar

**Minimum sürüm: `2.23.0`** (`crates/gitorbit-core/src/git/adapter.rs` içinde `MINIMUM_GIT_VERSION`).

Gerekçe — kullanılan ve bu sürümde stabil olan sözleşmeler:

- `git status --porcelain=v1 -z` (NUL-ayraçlı; boşluk/Unicode/newline içeren dosya adları için zorunlu) — 2.x başından beri stabil.
- `git rev-parse --show-toplevel`, `--git-dir`, bare/worktree tespiti — eski ama 2.23 ile doğrulandı.
- `git for-each-ref` format alanları (`%(upstream:track)` vs.) — 2.23 ile güvenilir.
- `git diff --no-index` ve `--numstat` ayrıştırması.

Uygulama açılışında `git --version` okunur ve sürüm `2.23.0`'ın altındaysa:

- Yerel repository mutasyonları (stage/commit/checkout/remote) devre dışı bırakılır.
- Kullanıcıya mevcut sürüm, minimum sürüm ve yükseltme yönergesi gösterilir; uygulama çökmez veya sonsuz loading'e girmez (GT-004).

## Sonuçlar

- Artı: Yaygın LTS dağıtımlar (Ubuntu 20.04+ / Debian 11+ / Fedora 32+) kapsamda; `-z` çıktı güvenle tek ayrıştırma yolu olur.
- Eksi: Aşırı eski sistemlerde uygulama çalışmaz — bu, veri kaybı riskine tercih edilen güvenli davranıştır.
- Takip: İleride `porcelain=v2` (`status --porcelain=v2 -z`) geçişi ayrı bir ADR ile değerlendirilmelidir; v2, rename/copy ve çakışma bilgisini daha yapılandırılmış verir.
