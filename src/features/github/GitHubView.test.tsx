import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubView } from "./GitHubView";
import * as tauriCommands from "../../lib/tauriCommands";
import type {
  DeviceFlowSession,
  GitHubAccount,
  GitHubProfile,
  GitHubRepoPage,
} from "../../types/ipc";

vi.mock("../../lib/tauriCommands", () => ({
  githubBeginLogin: vi.fn(),
  githubPollLogin: vi.fn(),
  githubListAccounts: vi.fn(),
  githubDisconnectAccount: vi.fn(),
  githubListRepos: vi.fn(),
  githubGetAccountProfile: vi.fn(),
}));

const mockAccounts: GitHubAccount[] = [
  {
    id: "acc-uuid-1",
    provider: "github",
    provider_user_id: "123456",
    login: "octocat",
    display_name: "The Octocat",
    avatar_url: "https://github.com/images/error/octocat_happy.gif",
    credential_ref: "cred-uuid-1",
    connection_status: "connected",
    created_at: "2026-01-01T00:00:00Z",
    last_used_at: null,
  },
];

const mockSession: DeviceFlowSession = {
  session_token: "test-session-uuid",
  user_code: "WDJB-MJHT",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};

const mockRepoPage: GitHubRepoPage = {
  repos: [
    {
      id: 1,
      name: "Spoon-Knife",
      full_name: "octocat/Spoon-Knife",
      description: "This repo is for forking",
      clone_url: "https://github.com/octocat/Spoon-Knife.git",
      ssh_url: "git@github.com:octocat/Spoon-Knife.git",
      html_url: "https://github.com/octocat/Spoon-Knife",
      private: false,
      fork: false,
      default_branch: "main",
      language: "HTML",
      stargazers_count: 120,
      visibility: "public",
      owner_login: "octocat",
    },
    {
      id: 2,
      name: "private-project",
      full_name: "octocat/private-project",
      description: "Confidential repo",
      clone_url: "https://github.com/octocat/private-project.git",
      ssh_url: "git@github.com:octocat/private-project.git",
      html_url: "https://github.com/octocat/private-project",
      private: true,
      fork: false,
      default_branch: "main",
      language: "Rust",
      stargazers_count: 5,
      visibility: "private",
      owner_login: "octocat",
    },
  ],
  page: 1,
  per_page: 30,
  has_more: false,
};

describe("GitHubView (Faz 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue(mockAccounts);
  });

  it("renders connected accounts list and does NOT expose any token in the DOM (AC-1)", async () => {
    render(<GitHubView />);

    await waitFor(() => {
      expect(screen.getByText("The Octocat")).toBeInTheDocument();
      expect(screen.getByText("@octocat")).toBeInTheDocument();
      expect(screen.getByText("Bağlı")).toBeInTheDocument();
    });

    // Security check: no token string or password field in DOM
    const html = document.body.innerHTML;
    expect(html).not.toContain("gho_");
    expect(html).not.toContain("access_token");
  });

  it("initiates device flow login and displays user code and verification link (AC-2)", async () => {
    vi.mocked(tauriCommands.githubBeginLogin).mockResolvedValue(mockSession);

    render(<GitHubView />);

    await waitFor(() => {
      expect(screen.getByText("The Octocat")).toBeInTheDocument();
    });

    const addAccountBtn = screen.getByRole("button", { name: /Hesap Ekle/i });
    fireEvent.click(addAccountBtn);

    await waitFor(() => {
      expect(tauriCommands.githubBeginLogin).toHaveBeenCalled();
      expect(screen.getByText("WDJB-MJHT")).toBeInTheDocument();
      expect(screen.getByText("https://github.com/login/device")).toBeInTheDocument();
    });

    // Verification link points to GitHub device login
    const link = screen.getByRole("link", {
      name: /https:\/\/github\.com\/login\/device/i,
    });
    expect(link).toHaveAttribute("href", "https://github.com/login/device");
  });

  it("copies user code to clipboard on copy button click", async () => {
    vi.mocked(tauriCommands.githubBeginLogin).mockResolvedValue(mockSession);
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });

    render(<GitHubView />);

    await waitFor(() => {
      expect(screen.getByText("The Octocat")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Hesap Ekle/i }));

    await waitFor(() => {
      expect(screen.getByText("WDJB-MJHT")).toBeInTheDocument();
    });

    const copyBtn = screen.getByTitle("Kodu kopyala");
    fireEvent.click(copyBtn);

    expect(writeTextSpy).toHaveBeenCalledWith("WDJB-MJHT");
  });

  it("polls device flow until success and returns to accounts list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(tauriCommands.githubBeginLogin).mockResolvedValue(mockSession);
    vi.mocked(tauriCommands.githubPollLogin).mockResolvedValue({
      status: "success",
      account: mockAccounts[0],
    });

    render(<GitHubView />);

    await waitFor(() => {
      expect(screen.getByText("The Octocat")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Hesap Ekle/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Doğrulamayı Başlat/i })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Doğrulamayı Başlat/i }));

    await waitFor(() => {
      expect(tauriCommands.githubPollLogin).toHaveBeenCalledWith("test-session-uuid");
      expect(screen.getByText("The Octocat")).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it("opens repositories panel and lists public and private repos (AC-6)", async () => {
    vi.mocked(tauriCommands.githubListRepos).mockResolvedValue(mockRepoPage);

    render(<GitHubView />);

    await waitFor(() => {
      expect(screen.getByText("The Octocat")).toBeInTheDocument();
    });

    const reposBtn = screen.getByRole("button", { name: /Repolar/i });
    fireEvent.click(reposBtn);

    await waitFor(() => {
      expect(tauriCommands.githubListRepos).toHaveBeenCalledWith("acc-uuid-1", 1, 30);
      expect(screen.getByText("Spoon-Knife")).toBeInTheDocument();
      expect(screen.getByText("private-project")).toBeInTheDocument();
      expect(screen.getByText("Özel")).toBeInTheDocument();
    });
  });

  it("disconnects account with confirmation (AC-5)", async () => {
    vi.mocked(tauriCommands.githubDisconnectAccount).mockResolvedValue();

    render(<GitHubView />);

    await waitFor(() => {
      expect(screen.getByText("The Octocat")).toBeInTheDocument();
    });

    const disconnectBtn = screen.getByRole("button", { name: /Bağlantıyı Kes/i });
    fireEvent.click(disconnectBtn);

    // Shows confirmation buttons
    expect(screen.getByRole("button", { name: /Evet, Ayır/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vazgeç/i })).toBeInTheDocument();

    // Confirm
    fireEvent.click(screen.getByRole("button", { name: /Evet, Ayır/i }));

    await waitFor(() => {
      expect(tauriCommands.githubDisconnectAccount).toHaveBeenCalledWith("acc-uuid-1");
    });
  });

  it("displays empty state when no accounts are connected", async () => {
    vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue([]);

    render(<GitHubView />);

    await waitFor(() => {
      expect(screen.getByText("GitHub hesabı bağlı değil")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /İlk Hesabı Ekle/i })
      ).toBeInTheDocument();
    });
  });

  it("opens the account profile overview with bio and stats", async () => {
    const mockProfile: GitHubProfile = {
      login: "octocat",
      name: "The Octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/583231",
      bio: "GitHub mascot. Available for hire on Mars.",
      html_url: "https://github.com/octocat",
      company: "@github",
      location: "San Francisco",
      public_repos: 8,
      followers: 12000,
      following: 9,
      created_at: "2011-01-25T18:44:36Z",
    };
    vi.mocked(tauriCommands.githubGetAccountProfile).mockResolvedValue(mockProfile);

    render(<GitHubView />);
    await waitFor(() => {
      expect(screen.getByText("The Octocat")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Profil/i }));

    await waitFor(() => {
      expect(
        screen.getByText("GitHub mascot. Available for hire on Mars.")
      ).toBeInTheDocument();
    });
    expect(screen.getByText("@github")).toBeInTheDocument();
    expect(screen.getByText("San Francisco")).toBeInTheDocument();
    // Stats: locale-formatted follower count
    expect(screen.getByText("12.000")).toBeInTheDocument();
    expect(tauriCommands.githubGetAccountProfile).toHaveBeenCalledWith("acc-uuid-1");

    // Token safety still holds on the profile screen
    expect(document.body.innerHTML).not.toContain("gho_");
  });

  it("shows a retryable error when profile loading fails", async () => {
    vi.mocked(tauriCommands.githubGetAccountProfile).mockRejectedValue({
      code: "AUTH_EXPIRED",
      message: "GitHub token bulunamadı.",
      recoverable: true,
      retryable: true,
      correlation_id: "c1",
    });

    render(<GitHubView />);
    await waitFor(() => {
      expect(screen.getByText("The Octocat")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Profil/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Kimlik doğrulama gerekiyor. Lütfen tekrar bağlanın.")
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Tekrar dene/i })).toBeInTheDocument();
  });
});
