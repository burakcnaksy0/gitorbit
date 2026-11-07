import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";
import * as tauriCommands from "./lib/tauriCommands";
import {
  mockAppInfo,
  mockEnvironment,
  mockRepository,
  mockSettings,
  mockStatus,
} from "./test/fixtures";

vi.mock("./lib/tauriCommands", () => import("./test/mockTauriCommands"));

const history = {
  commits: [
    {
      sha: "a4f891b2c3d4e5f67890123456789abcdef01234",
      short_sha: "a4f891b",
      message: "chore: initialize workspace",
      author_name: "Dev",
      author_email: "dev@example.com",
      authored_at: "2026-11-01T12:00:00Z",
      parents: [],
    refs: [],
    },
  ],
  graph: [],
  has_more: false,
  next_offset: 1,
};

describe("GitOrbit desktop shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriCommands.appGetEnvironment).mockResolvedValue(mockEnvironment);
    vi.mocked(tauriCommands.appGetInfo).mockResolvedValue(mockAppInfo);
    vi.mocked(tauriCommands.settingsGet).mockResolvedValue(mockSettings);
    vi.mocked(tauriCommands.settingsUpdate).mockImplementation(async (update) => ({
      ...mockSettings,
      ...update,
    }));
    vi.mocked(tauriCommands.repositoryList).mockResolvedValue([mockRepository]);
    vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue(mockStatus);
    vi.mocked(tauriCommands.repositoryGetHistory).mockResolvedValue(history);
    vi.mocked(tauriCommands.repositoryFetch).mockResolvedValue(mockStatus);
    vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue([]);
  });

  it("renders the shell and reflects the real Git environment", async () => {
    render(<App />);

    const header = screen.getByRole("banner");
    expect(within(header).getAllByText("GitOrbit").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("navigation")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Git 2.43.0")).toBeInTheDocument();
    });
    // Version comes from the backend, never a hardcoded phase label.
    // The badge is intentionally rendered in both the TopBar and the StatusBar.
    expect(screen.getAllByText("v0.1.0").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Faz 1 UI/i)).not.toBeInTheDocument();
  });

  it("navigates across all views using backend data", async () => {
    render(<App />);
    const nav = screen.getByRole("navigation");

    expect(screen.getByText("GitOrbit'e Hoş Geldiniz")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("project").length).toBeGreaterThan(0);
    });

    fireEvent.click(within(nav).getByRole("button", { name: /Depolar/i }));
    expect(screen.getByRole("heading", { name: "Depolar" })).toBeInTheDocument();
    expect(screen.getByText("/home/dev/project")).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("button", { name: /Değişiklikler/i }));
    await waitFor(() => {
      expect(screen.getByText(/Tümünü Stage Et/i)).toBeInTheDocument();
    });

    fireEvent.click(within(nav).getByRole("button", { name: /Geçmiş/i }));
    await waitFor(() => {
      expect(screen.getByText("Commit Geçmişi")).toBeInTheDocument();
      expect(screen.getAllByText("chore: initialize workspace").length).toBeGreaterThan(
        0
      );
    });

    fireEvent.click(within(nav).getByRole("button", { name: /Dallar/i }));
    expect(
      screen.getByRole("heading", { name: /Dallar \(Branches\)/i })
    ).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("button", { name: /Ayarlar/i }));
    expect(screen.getByRole("heading", { name: "Ayarlar" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Sistem Git Yapılandırması")).toBeInTheDocument();
      expect(screen.getByText("2.43.0")).toBeInTheDocument();
      expect(screen.getByText("/usr/bin/git")).toBeInTheDocument();
    });
  });

  it("toggles sidebar collapse state without breaking layout", () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText("Menüyü Daralt"));
    expect(screen.getByLabelText("Menüyü Genişlet")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Menüyü Genişlet"));
    expect(screen.getByLabelText("Menüyü Daralt")).toBeInTheDocument();
  });

  it("never reports a fake success when the backend fails", async () => {
    vi.mocked(tauriCommands.repositoryFetch).mockRejectedValue({
      code: "NETWORK_ERROR",
      message: "Uzak depoya ulaşılamadı.",
      recoverable: true,
      recovery_hint: "Ağ bağlantınızı kontrol edin.",
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Git 2.43.0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle(/Remote durumunu yenile/i));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "İşlem Başarısız" })
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/NETWORK_ERROR/)).toBeInTheDocument();
    expect(screen.getByText(/Uzak depoya ulaşılamadı/)).toBeInTheDocument();
    expect(screen.queryByText(/başarıyla/i)).not.toBeInTheDocument();
  });

  it("shows an honest error state when the repository list fails", async () => {
    vi.mocked(tauriCommands.repositoryList).mockRejectedValue({
      code: "DATABASE_ERROR",
      message: "Veritabanı okunamadı.",
      recoverable: false,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Veritabanı okunamadı.")).toBeInTheDocument();
    });
  });

  it("toggles the theme and persists the choice", async () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText("Tema Değiştir"));

    await waitFor(() => {
      expect(tauriCommands.settingsUpdate).toHaveBeenCalledWith({ theme: "light" });
    });
  });
});
