use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::models::{DiffLineKind, DiffOutput, FileDiffLine};
use std::path::Path;

/// Maximum bytes of raw diff text we parse into structured lines.
/// Diffs larger than this are returned as truncated (binary=false, lines=[]).
pub const MAX_DIFF_BYTES: usize = 512 * 1024; // 512 KB

pub struct GitDiffParser;

impl GitDiffParser {
    /// Returns the diff for a single file.
    ///
    /// - `staged = true`  → `git diff --cached -- <path>`
    /// - `staged = false` → `git diff -- <path>`
    ///
    /// The `file_path` MUST be relative to the repository root (validated by caller).
    pub fn get_file_diff(
        repo_dir: &Path,
        file_path: &str,
        staged: bool,
    ) -> Result<DiffOutput, CommandError> {
        // Build args: staged vs unstaged
        let args: Vec<&str> = if staged {
            vec!["diff", "--cached", "--", file_path]
        } else {
            vec!["diff", "--", file_path]
        };

        let output = GitAdapter::execute(repo_dir, &args)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_DIFF_FAILED",
                format!("Diff alınamadı: {}", stderr.trim()),
                true,
            ));
        }

        let raw_size = output.stdout.len();

        // Detect binary files from git's output
        // git outputs "Binary files a/... and b/... differ\n" for binary diffs
        let raw_preview = String::from_utf8_lossy(&output.stdout[..raw_size.min(256)]);
        if raw_preview.contains("Binary files") {
            return Ok(DiffOutput {
                path: file_path.to_string(),
                truncated: false,
                binary: true,
                lines: vec![],
                raw_size,
            });
        }

        // Size guard: return truncated without parsing
        if raw_size > MAX_DIFF_BYTES {
            return Ok(DiffOutput {
                path: file_path.to_string(),
                truncated: true,
                binary: false,
                lines: vec![],
                raw_size,
            });
        }

        // Parse as UTF-8 (lossy); diff text is usually UTF-8
        let text = String::from_utf8_lossy(&output.stdout);
        let lines = Self::parse_unified_diff(&text);

        Ok(DiffOutput {
            path: file_path.to_string(),
            truncated: false,
            binary: false,
            lines,
            raw_size,
        })
    }

    /// Parses unified diff text into structured `FileDiffLine` values.
    fn parse_unified_diff(text: &str) -> Vec<FileDiffLine> {
        let mut result = Vec::new();
        let mut old_line: u32 = 0;
        let mut new_line: u32 = 0;

        for line in text.lines() {
            if line.starts_with("diff ")
                || line.starts_with("index ")
                || line.starts_with("--- ")
                || line.starts_with("+++ ")
            {
                result.push(FileDiffLine {
                    kind: DiffLineKind::Header,
                    content: line.to_string(),
                    old_line_no: None,
                    new_line_no: None,
                });
            } else if line.starts_with("@@ ") {
                // Parse hunk header: @@ -old_start,old_count +new_start,new_count @@
                if let Some((o, n)) = Self::parse_hunk_header(line) {
                    old_line = o.saturating_sub(1);
                    new_line = n.saturating_sub(1);
                }
                result.push(FileDiffLine {
                    kind: DiffLineKind::Hunk,
                    content: line.to_string(),
                    old_line_no: None,
                    new_line_no: None,
                });
            } else if let Some(content) = line.strip_prefix('+') {
                new_line += 1;
                result.push(FileDiffLine {
                    kind: DiffLineKind::Added,
                    content: content.to_string(),
                    old_line_no: None,
                    new_line_no: Some(new_line),
                });
            } else if let Some(content) = line.strip_prefix('-') {
                old_line += 1;
                result.push(FileDiffLine {
                    kind: DiffLineKind::Removed,
                    content: content.to_string(),
                    old_line_no: Some(old_line),
                    new_line_no: None,
                });
            } else if let Some(stripped) = line.strip_prefix(' ') {
                old_line += 1;
                new_line += 1;
                result.push(FileDiffLine {
                    kind: DiffLineKind::Context,
                    content: stripped.to_string(),
                    old_line_no: Some(old_line),
                    new_line_no: Some(new_line),
                });
            }
            // Empty lines at end of hunk are skipped
        }

        result
    }

    /// Extracts (old_start, new_start) from a hunk header like `@@ -10,6 +10,8 @@`.
    fn parse_hunk_header(line: &str) -> Option<(u32, u32)> {
        // Format: @@ -old_start[,old_count] +new_start[,new_count] @@
        let inner = line.strip_prefix("@@ ")?;
        let mut parts = inner.split_whitespace();
        let old_part = parts.next()?; // e.g. "-10,6"
        let new_part = parts.next()?; // e.g. "+10,8"

        let old_start: u32 = old_part
            .trim_start_matches('-')
            .split(',')
            .next()?
            .parse()
            .ok()?;
        let new_start: u32 = new_part
            .trim_start_matches('+')
            .split(',')
            .next()?
            .parse()
            .ok()?;

        Some((old_start, new_start))
    }

    /// Public wrapper around `parse_unified_diff` for integration test access.
    pub fn parse_diff_text_for_test(text: &str) -> Vec<FileDiffLine> {
        Self::parse_unified_diff(text)
    }

    /// Public wrapper used by commit-diff rendering.
    pub fn parse_diff_text(text: &str) -> Vec<FileDiffLine> {
        Self::parse_unified_diff(text)
    }
}
