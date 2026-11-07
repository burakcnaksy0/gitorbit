use serde::{Deserialize, Serialize};

/// Bir commit satırındaki kenar türü.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GraphEdgeKind {
    /// Üstten gelip bu commit'in noktasında birleşen ikinci ebeveyn çizgisi.
    MergeIn,
    /// Bu commit'ten aşağıya doğru yeni/ayrı bir seride inen ebeveyn çizgisi.
    BranchOut,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphEdge {
    pub from_lane: usize,
    pub to_lane: usize,
    pub kind: GraphEdgeKind,
}

/// Tek bir commit satırının grafik planı. Dikey geçen çizgiler `active_lanes`
/// ile verilir; commit noktası `lane` sütunundadır.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphRow {
    pub lane: usize,
    /// Bu satırda çizgisi görünen tüm seritler (commit seridi dahil).
    pub active_lanes: Vec<usize>,
    pub edges: Vec<GraphEdge>,
}

/// Saf lane hesabı (klasik `git log --graph` sadeleştirmesi).
///
/// Girdi: commit'ler **yeni → eski** sırayla, `(sha, ebeveyn shaları)`.
/// Yalnızca verilen sayfa çizilir; sayfa dışına taşan çizgiler satır
/// sınırında kesilir (bilinçli sınır — tam depo grafiği kapsam dışı).
pub fn compute_lanes(entries: &[(String, Vec<String>)]) -> Vec<GraphRow> {
    // lane → bu seritte bir dahaki satırda beklenen sha (None = bosluk).
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut rows = Vec::with_capacity(entries.len());

    for (sha, parents) in entries {
        // 1) Commit'in seridi: sha'yı bekleyen serit; yoksa ilk bos/yeni serit.
        let lane = lanes
            .iter()
            .position(|l| l.as_deref() == Some(sha.as_str()))
            .or_else(|| lanes.iter().position(|l| l.is_none()))
            .unwrap_or_else(|| {
                lanes.push(None);
                lanes.len() - 1
            });
        lanes[lane] = None;

        let mut edges: Vec<GraphEdge> = Vec::new();

        // 2) Ayni commit'i bekleyen diğer seritler bu noktada birleşir.
        for i in 0..lanes.len() {
            if i != lane && lanes[i].as_deref() == Some(sha.as_str()) {
                lanes[i] = None;
                edges.push(GraphEdge {
                    from_lane: i,
                    to_lane: lane,
                    kind: GraphEdgeKind::MergeIn,
                });
            }
        }

        // 3) Ebeveynler: ilk ebeveyn ayni seride iner; ancak ebeveyn zaten
        //    baska bir seritte izleniyorsa cizgi oraya kavusur (duplicate satir
        //    yerine kavusma — git log --graph davranisi).
        if let Some((first, rest)) = parents.split_first() {
            let existing_first = lanes
                .iter()
                .position(|l| l.as_deref() == Some(first.as_str()));
            match existing_first {
                Some(k) if k != lane => {
                    // Serit burada biter, cizgi k'taki karisina kavusur.
                    edges.push(GraphEdge {
                        from_lane: lane,
                        to_lane: k,
                        kind: GraphEdgeKind::BranchOut,
                    });
                }
                _ => {
                    lanes[lane] = Some(first.clone());
                }
            }
            for parent in rest {
                let existing = lanes
                    .iter()
                    .position(|l| l.as_deref() == Some(parent.as_str()));
                let target = match existing {
                    Some(k) if k != lane => k,
                    _ => {
                        let k = lanes
                            .iter()
                            .position(|l| l.is_none())
                            .unwrap_or_else(|| {
                                lanes.push(None);
                                lanes.len() - 1
                            });
                        lanes[k] = Some(parent.clone());
                        k
                    }
                };
                edges.push(GraphEdge {
                    from_lane: lane,
                    to_lane: target,
                    kind: GraphEdgeKind::BranchOut,
                });
            }
        }

        let mut active_lanes: Vec<usize> = (0..lanes.len())
            .filter(|&i| i == lane || lanes[i].is_some())
            .collect();
        active_lanes.sort_unstable();
        active_lanes.dedup();

        // Sondaki bos seritleri kirp (sutun sayisini daraltmak icin).
        while lanes.last().map(|l| l.is_none()).unwrap_or(false) {
            lanes.pop();
        }

        rows.push(GraphRow {
            lane,
            active_lanes,
            edges,
        });
    }

    rows
}

/// Commit SHA'sından kararlı bir çizim rengi indeksi üretir (6 renk).
/// UI tarafı da aynı mantığı kullanabilir; buradaki tek doğru kaynaktır.
pub fn color_index_for(sha: &str) -> usize {
    let mut acc: usize = 0;
    for b in sha.bytes().take(8) {
        acc = acc.wrapping_mul(31).wrapping_add(b as usize);
    }
    acc % 6
}

#[cfg(test)]
mod graph_tests {
    use super::{compute_lanes, color_index_for, GraphEdgeKind};

    fn e(sha: &str, parents: &[&str]) -> (String, Vec<String>) {
        (
            sha.to_string(),
            parents.iter().map(|p| p.to_string()).collect(),
        )
    }

    #[test]
    fn linear_history_stays_in_lane_zero() {
        let rows = compute_lanes(&[e("C", &["B"]), e("B", &["A"]), e("A", &[])]);
        assert_eq!(rows.len(), 3);
        for row in &rows {
            assert_eq!(row.lane, 0);
            assert_eq!(row.active_lanes, vec![0]);
            assert!(row.edges.is_empty());
        }
    }

    #[test]
    fn merge_commit_opens_second_lane_and_converges() {
        // A — X  (main)
        //  \ /
        //   B    (feature)
        //   |
        //   M    (merge commit, en yeni)
        let rows = compute_lanes(&[e("M", &["A", "B"]), e("A", &["X"]), e("B", &["X"]), e("X", &[])]);

        // M: lane 0; ikinci ebeven B icin lane 1 acilir → BranchOut 0→1.
        assert_eq!(rows[0].lane, 0);
        assert_eq!(rows[0].active_lanes, vec![0, 1]);
        let branch_out = rows[0]
            .edges
            .iter()
            .find(|x| x.kind == GraphEdgeKind::BranchOut)
            .expect("BranchOut bekleniyordu");
        assert_eq!((branch_out.from_lane, branch_out.to_lane), (0, 1));

        // A (lane 0) duz gecer.
        assert_eq!(rows[1].lane, 0);
        assert_eq!(rows[1].active_lanes, vec![0, 1]);

        // B kendi seridinden iner; ebeveyni X zaten lane 0'da izleniyor →
        // B'nin ebeveyn çizgisi lane 1'den lane 0'a kavusur (duplicate satir yok).
        assert_eq!(rows[2].lane, 1);
        assert!(rows[2].edges.iter().any(|x| x.kind == GraphEdgeKind::BranchOut
            && x.from_lane == 1
            && x.to_lane == 0));

        // X artik tek seritte yasar.
        assert_eq!(rows[3].lane, 0);
        assert_eq!(rows[3].active_lanes, vec![0]);
    }

    #[test]
    fn octopus_merge_gets_multiple_lanes() {
        // M'nin uc ebeveyni: P1 (ayni dal), P2, P3 ayri seritler.
        let rows = compute_lanes(&[
            e("M", &["P1", "P2", "P3"]),
            e("P1", &["G"]),
            e("P2", &["G"]),
            e("P3", &["G"]),
            e("G", &[]),
        ]);
        assert_eq!(rows[0].lane, 0);
        assert_eq!(rows[0].active_lanes, vec![0, 1, 2]);
        let outs: Vec<usize> = rows[0]
            .edges
            .iter()
            .filter(|x| x.kind == GraphEdgeKind::BranchOut)
            .map(|x| x.to_lane)
            .collect();
        assert_eq!(outs.len(), 2);
        // G'de butun seritler tek commit'te toplanmali.
        assert_eq!(rows[4].active_lanes.len(), 1);
    }

    #[test]
    fn nested_fork_join_keeps_lanes_stable() {
        // Iki ic ice dal:
        // D—┐
        // C—|—M2 (merge D,C)
        //   B—M1 (merge B,A)? — asagidaki grafikte:
        //
        // M2(P: M1, D); M1(P: A, B); D(P: B); A(P: X); B(P: X); X
        let rows = compute_lanes(&[
            e("M2", &["M1", "D"]),
            e("M1", &["A", "B"]),
            e("D", &["B"]),
            e("A", &["X"]),
            e("B", &["X"]),
            e("X", &[]),
        ]);
        // Her satirda commit bir seritte yasali kalmali.
        for row in &rows {
            assert!(row.active_lanes.contains(&row.lane));
        }
        // M2'de D icin ayri serit acilir.
        assert!(rows[0].active_lanes.len() >= 2);
        // X nihai bulusma tek seride iner.
        assert_eq!(rows[5].active_lanes.len(), 1);
    }

    #[test]
    fn page_boundary_truncation_does_not_panic() {
        // Sayfanin son commit'inin ebeveynleri sayfada yok (truncation).
        let rows = compute_lanes(&[e("B", &["A"]), e("A", &["YOK1", "YOK2"])]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].lane, 0);
    }

    #[test]
    fn color_index_is_stable_and_in_range() {
        let a = color_index_for("abc123");
        assert_eq!(a, color_index_for("abc123"));
        assert!(a < 6);
    }
}
