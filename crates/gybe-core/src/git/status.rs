use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::models::{ChangedFile, ChangedFileStatus, GitStatus};
use std::path::Path;

pub struct GitStatusParser;

impl GitStatusParser {
    /// Reads and parses current Git repository status.
    ///
    /// R-06: tek `git status --porcelain=v2 --branch -z` çağrısı dal, upstream
    /// ve ahead/behind bilgisini de taşır — eski yol her status turunda 4 ayrı
    /// subprocess (rev-parse ×2, symbolic-ref, rev-list) daha doğuruyordu.
    /// v2 başlıkları okunamazsa (esneklik/başka git sürümü) eski alt-dal yoluna
    /// düşülür; dosya girdileri her iki yolda da aynı sözlüğü üretir.
    pub fn get_status(repo_dir: &Path) -> Result<GitStatus, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        // 1. Tek çağrı: dosyalar + dal/upstream/ahead/behind
        let status_output = GitAdapter::execute(
            &canonical_repo,
            &[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
            ],
        )?;

        if !status_output.status.success() {
            let stderr = String::from_utf8_lossy(&status_output.stderr);
            return Err(CommandError::new(
                "GIT_STATUS_FAILED",
                format!("Git status alınamadı: {}", stderr.trim()),
                true,
            ));
        }

        let chunks: Vec<&[u8]> = status_output
            .stdout
            .split(|&b| b == 0)
            .filter(|c| !c.is_empty())
            .collect();

        let (staged_files, unstaged_files, untracked_files, conflicted_files) =
            Self::parse_porcelain_v2_z(&chunks);

        // 2. v2 dallama başlıkları (# branch.*) — varsa ek subprocess gerekmez
        let mut branch: Option<String> = None;
        let mut is_detached_head = false;
        let mut unborn_name: Option<String> = None;
        let mut detached_oid: Option<String> = None;
        let mut upstream: Option<String> = None;
        let mut ahead = 0u32;
        let mut behind = 0u32;
        let mut saw_branch_header = false;

        for chunk in &chunks {
            let s = String::from_utf8_lossy(chunk);
            if let Some(head) = s.strip_prefix("# branch.head ") {
                saw_branch_header = true;
                let head = head.trim();
                if head == "(detached)" {
                    is_detached_head = true;
                } else if head.starts_with("(unborn") {
                    // "ref: refs/heads/main" biçiminde gerçek dal adını taşır
                    unborn_name = head
                        .strip_prefix("(unborn ")
                        .and_then(|r| r.strip_suffix(')'))
                        .map(|r| r.strip_prefix("ref: refs/heads/").unwrap_or(r).to_string());
                } else if !head.is_empty() {
                    branch = Some(head.to_string());
                }
            } else if let Some(oid) = s.strip_prefix("# branch.oid ") {
                saw_branch_header = true;
                let oid = oid.trim();
                if oid != "(initial)" {
                    detached_oid = Some(oid.to_string());
                }
            } else if let Some(u) = s.strip_prefix("# branch.upstream ") {
                saw_branch_header = true;
                let u = u.trim();
                if !u.is_empty() {
                    upstream = Some(u.to_string());
                }
            } else if let Some(ab) = s.strip_prefix("# branch.ab ") {
                saw_branch_header = true;
                // Biçim: "+<ahead> -<behind>"
                for tok in ab.split_whitespace() {
                    if let Some(a) = tok.strip_prefix('+') {
                        ahead = a.parse().unwrap_or(0);
                    } else if let Some(b) = tok.strip_prefix('-') {
                        behind = b.parse().unwrap_or(0);
                    }
                }
            }
        }

        // branch.oid başlığı branch.head'den ÖNCE gelir; detached etiketi
        // döngüden sonra kurulur: görünen ad eski biçimle aynı, "HEAD (abc1234)".
        if is_detached_head {
            branch = detached_oid
                .filter(|o| o.len() >= 7)
                .map(|o| format!("HEAD ({})", &o[..7]));
        }

        // 3. Geriye dönük güvenlik ağı: başlık hiç yoksa (beklenmedik git
        // sürümü) eski alt-dal yoluna düş. Unborn dal adını v2 başlığından
        // alamadıysak da eski yola sor (sembolik-ref doğrusu).
        if !saw_branch_header || (branch.is_none() && unborn_name.is_none() && !is_detached_head) {
            let (b, d) = Self::get_branch_info(&canonical_repo)?;
            branch = b;
            is_detached_head = d;
            let (u, a, bh) = Self::get_upstream_info(&canonical_repo);
            upstream = u;
            ahead = a;
            behind = bh;
        } else if branch.is_none() {
            branch = unborn_name;
        }

        // 4. Detect operation state (e.g. merge in progress, rebase in progress)
        let operation_state =
            crate::git::operation_state::GitOperationStateManager::detect_state(&canonical_repo);

        Ok(GitStatus {
            repository_path: canonical_repo.to_string_lossy().to_string(),
            branch,
            is_detached_head,
            upstream,
            ahead,
            behind,
            staged_files,
            unstaged_files,
            untracked_files,
            conflicted_files,
            operation_state,
        })
    }

    /// Parses NUL-delimited chunks of `git status --porcelain=v2 --branch -z`.
    /// `-z` modunda alanlar BOŞLUKLA ayrılır (yollar alıntılanmaz, boşluk
    /// içerebilir) — bu yüzden tür başına SABİT alan sayılır önek ayrıştırılır,
    /// kalan tamamı yoldur. `#` başlıkları atlanır (get_status ayrıca okur);
    /// rename/copy (2) girdisinde eski yol bir sonraki NUL parçasıdır.
    pub fn parse_porcelain_v2_z(
        chunks: &[&[u8]],
    ) -> (
        Vec<ChangedFile>,
        Vec<ChangedFile>,
        Vec<ChangedFile>,
        Vec<String>,
    ) {
        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut untracked = Vec::new();
        let mut conflicted = Vec::new();

        let mut i = 0;
        while i < chunks.len() {
            let s = String::from_utf8_lossy(chunks[i]);

            // Başlık satırları (# ...) — burada ilgilenmiyoruz
            if s.starts_with('#') {
                i += 1;
                continue;
            }

            // Tür kodu ilk boşluğa kadardır. v2(-z) biçiminde ara alanlar
            // SABİT genişliklidir (XY iki karakterdir ve boşluk içerebilir —
            // bu yüzden boşluğa göre split YANILTICIDIR); yol son alandır ve
            // boşluk içerebilir. Alan uzunlukları git 2.11'den beri stabildir.
            let mut kind_split = s.splitn(2, ' ');
            let kind = kind_split.next().unwrap_or("");
            let rest = kind_split.next().unwrap_or("");
            let bytes = rest.as_bytes();

            // Sabit önek uzunlukları (rest üzerinden):
            //   1/2: XY(2) sp sub(4) sp mode(6)x3 sp sha(40)x2 [sp score(4)] sp path
            //   u:   XY(2) sp sub(4) sp mode(6)x4 sp sha(40)x3 sp path
            let (xy, path) = match kind {
                "1" if bytes.len() > 111 && bytes[2] == b' ' && bytes[110] == b' ' => {
                    let path = String::from_utf8_lossy(&bytes[111..]).to_string();
                    (&rest[0..2], Some(path))
                }
                "2" if bytes.len() > 116 && bytes[2] == b' ' && bytes[115] == b' ' => {
                    let path = String::from_utf8_lossy(&bytes[116..]).to_string();
                    (&rest[0..2], Some(path))
                }
                "u" if bytes.len() > 159 && bytes[2] == b' ' && bytes[158] == b' ' => {
                    let path = String::from_utf8_lossy(&bytes[159..]).to_string();
                    (&rest[0..2], Some(path))
                }
                "?" => ("??", Some(rest.to_string())),
                _ => ("  ", None),
            };

            match kind {
                "1" => {
                    let path = path.unwrap_or_default();
                    Self::push_xy_entry(
                        &mut staged,
                        &mut unstaged,
                        path,
                        None,
                        xy.chars().next().unwrap_or(' '),
                        xy.chars().nth(1).unwrap_or(' '),
                    );
                    i += 1;
                }
                // 2 = rename/copy: eski yol bir sonraki NUL parçasıdır
                "2" => {
                    let path = path.unwrap_or_default();
                    let old_path = if i + 1 < chunks.len() {
                        i += 1;
                        Some(String::from_utf8_lossy(chunks[i]).to_string())
                    } else {
                        None
                    };
                    Self::push_xy_entry(
                        &mut staged,
                        &mut unstaged,
                        path,
                        old_path,
                        xy.chars().next().unwrap_or(' '),
                        xy.chars().nth(1).unwrap_or(' '),
                    );
                    i += 1;
                }
                "u" => {
                    if let Some(path) = path.filter(|p| !p.is_empty()) {
                        conflicted.push(path.clone());
                        unstaged.push(ChangedFile {
                            path,
                            old_path: None,
                            status: ChangedFileStatus::Conflicted,
                            staged: false,
                        });
                    }
                    i += 1;
                }
                // ? untracked; ! ignorable — listemiyoruz, atlanır
                "?" => {
                    if let Some(path) = path.filter(|p| !p.is_empty()) {
                        untracked.push(ChangedFile {
                            path,
                            old_path: None,
                            status: ChangedFileStatus::Untracked,
                            staged: false,
                        });
                    }
                    i += 1;
                }
                _ => {
                    i += 1;
                }
            }
        }

        (staged, unstaged, untracked, conflicted)
    }

    /// v1 ayrıştırıcısıyla birebir aynı eşleme: X → staged, Y → unstaged.
    fn push_xy_entry(
        staged: &mut Vec<ChangedFile>,
        unstaged: &mut Vec<ChangedFile>,
        path: String,
        old_path: Option<String>,
        x: char,
        y: char,
    ) {
        if x != ' ' && x != '?' {
            let status = match x {
                'A' => ChangedFileStatus::Added,
                'M' => ChangedFileStatus::Modified,
                'D' => ChangedFileStatus::Deleted,
                'R' => ChangedFileStatus::Renamed,
                _ => ChangedFileStatus::Modified,
            };
            staged.push(ChangedFile {
                path: path.clone(),
                old_path: old_path.clone(),
                status,
                staged: true,
            });
        }
        if y != ' ' && y != '?' {
            let status = match y {
                'M' => ChangedFileStatus::Modified,
                'D' => ChangedFileStatus::Deleted,
                'A' => ChangedFileStatus::Added,
                'R' => ChangedFileStatus::Renamed,
                'C' => ChangedFileStatus::Renamed,
                _ => ChangedFileStatus::Modified,
            };
            unstaged.push(ChangedFile {
                path,
                old_path,
                status,
                staged: false,
            });
        }
    }

    /// Parses raw NUL-delimited output from `git status --porcelain=v1 -z`.
    /// LEGACY: üretim yolu artık v2 (`parse_porcelain_v2_z`) — bu fonksiyon
    /// biçim kıyaslaması/tanılama için tutuluyor ve kendi testiyle kilitli.
    pub fn parse_porcelain_z(
        raw_bytes: &[u8],
    ) -> (
        Vec<ChangedFile>,
        Vec<ChangedFile>,
        Vec<ChangedFile>,
        Vec<String>,
    ) {
        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut untracked = Vec::new();
        let mut conflicted = Vec::new();

        let entries: Vec<&[u8]> = raw_bytes
            .split(|&b| b == 0)
            .filter(|chunk| !chunk.is_empty())
            .collect();

        let mut i = 0;
        while i < entries.len() {
            let chunk = entries[i];
            if chunk.len() < 3 {
                i += 1;
                continue;
            }

            let x = chunk[0] as char;
            let y = chunk[1] as char;
            // Byte 2 is space, rest is path
            let path_bytes = &chunk[3..];
            let path = String::from_utf8_lossy(path_bytes).to_string();

            // Check if renamed or copied (requires reading the next NUL-delimited chunk for old_path)
            let mut old_path = None;
            if (x == 'R' || x == 'C' || y == 'R' || y == 'C') && (i + 1 < entries.len()) {
                i += 1;
                old_path = Some(String::from_utf8_lossy(entries[i]).to_string());
            }

            // Untracked files
            if x == '?' && y == '?' {
                untracked.push(ChangedFile {
                    path,
                    old_path: None,
                    status: ChangedFileStatus::Untracked,
                    staged: false,
                });
                i += 1;
                continue;
            }

            // Conflicted files (unmerged)
            let is_conflict = matches!(
                (x, y),
                ('D', 'D')
                    | ('A', 'U')
                    | ('U', 'D')
                    | ('U', 'A')
                    | ('D', 'U')
                    | ('A', 'A')
                    | ('U', 'U')
            );

            if is_conflict {
                conflicted.push(path.clone());
                unstaged.push(ChangedFile {
                    path,
                    old_path,
                    status: ChangedFileStatus::Conflicted,
                    staged: false,
                });
                i += 1;
                continue;
            }

            // Staged part (X)
            if x != ' ' && x != '?' {
                let status = match x {
                    'A' => ChangedFileStatus::Added,
                    'M' => ChangedFileStatus::Modified,
                    'D' => ChangedFileStatus::Deleted,
                    'R' => ChangedFileStatus::Renamed,
                    _ => ChangedFileStatus::Modified,
                };

                staged.push(ChangedFile {
                    path: path.clone(),
                    old_path: old_path.clone(),
                    status,
                    staged: true,
                });
            }

            // Unstaged part (Y)
            if y != ' ' && y != '?' {
                let status = match y {
                    'M' => ChangedFileStatus::Modified,
                    'D' => ChangedFileStatus::Deleted,
                    'A' => ChangedFileStatus::Added,
                    'R' => ChangedFileStatus::Renamed,
                    _ => ChangedFileStatus::Modified,
                };

                unstaged.push(ChangedFile {
                    path,
                    old_path,
                    status,
                    staged: false,
                });
            }

            i += 1;
        }

        (staged, unstaged, untracked, conflicted)
    }

    fn get_branch_info(repo_dir: &Path) -> Result<(Option<String>, bool), CommandError> {
        let output = GitAdapter::execute(repo_dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;

        if output.status.success() {
            let ref_name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if ref_name == "HEAD" {
                // Detached HEAD state — read the short SHA
                let sha_output = GitAdapter::execute(repo_dir, &["rev-parse", "--short", "HEAD"])?;
                let short_sha = String::from_utf8_lossy(&sha_output.stdout)
                    .trim()
                    .to_string();
                return Ok((Some(format!("HEAD ({})", short_sha)), true));
            } else if !ref_name.is_empty() {
                return Ok((Some(ref_name), false));
            }
        }

        // Fallback: empty repo (no commits yet) — read branch from symbolic-ref.
        // `git symbolic-ref --short HEAD` works even before the first commit.
        let sym_output = GitAdapter::execute(repo_dir, &["symbolic-ref", "--short", "HEAD"]);

        match sym_output {
            Ok(out) if out.status.success() => {
                let branch = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if branch.is_empty() {
                    Ok((None, false))
                } else {
                    Ok((Some(branch), false))
                }
            }
            _ => Ok((None, false)),
        }
    }

    fn get_upstream_info(repo_dir: &Path) -> (Option<String>, u32, u32) {
        let upstream_output = GitAdapter::execute(repo_dir, &["rev-parse", "--abbrev-ref", "@{u}"]);

        let upstream = match upstream_output {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if s.is_empty() { None } else { Some(s) }
            }
            _ => None,
        };

        let mut ahead = 0;
        let mut behind = 0;

        if upstream.is_some()
            && let Ok(count_output) = GitAdapter::execute(
                repo_dir,
                &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
            )
            && count_output.status.success()
        {
            let text = String::from_utf8_lossy(&count_output.stdout);
            let parts: Vec<&str> = text.split_whitespace().collect();
            if parts.len() >= 2 {
                ahead = parts[0].parse::<u32>().unwrap_or(0);
                behind = parts[1].parse::<u32>().unwrap_or(0);
            }
        }

        (upstream, ahead, behind)
    }
}
