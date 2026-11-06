import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotGitChoiceModal, PublishRepoModal } from "./PublishDialogs";
import * as tauriCommands from "../../lib/tauriCommands";
import type { GitHubAccount, GitHubPublishResult } from "../../types/ipc";

vi.mock("../../lib/tauriCommands", () => import("../../test/mockTauriCommands"));

const connectedAccount: GitHubAccount = {
  id: "acc-1",
  provider: "github",
  provider_user_id: "1",
  login: "octocat",
  display_name: "The Octocat",
  avatar_url: null,
  credential_ref: "github:1",
  connection_status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  last_used_at: null,
};

describe("NotGitChoiceModal", () => {
  it("shows the path and both choices, firing the right handler", () => {
    const onInitLocal = vi.fn();
    const onInitAndPublish = vi.fn();
    const onClose = vi.fn();

    render(
      <NotGitChoiceModal
        path="/home/user/yeni-klasor"
        busy={false}
        onInitLocal={onInitLocal}
        onInitAndPublish={onInitAndPublish}
        onClose={onClose}
      />
    );

    expect(screen.getByText("/home/user/yeni-klasor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Git deposu olarak başlat/i }));
    expect(onInitLocal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Başlat ve GitHub'da yayınla/i }));
    expect(onInitAndPublish).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Vazgeç/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables every action while busy", () => {
    render(
      <NotGitChoiceModal
        path="/tmp/x"
        busy={true}
        onInitLocal={vi.fn()}
        onInitAndPublish={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /Git deposu olarak başlat/i })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Başlat ve GitHub'da yayınla/i })
    ).toBeDisabled();
  });
});

describe("PublishRepoModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no GitHub account is connected", async () => {
    vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue([]);

    render(
      <PublishRepoModal
        repoId="repo-1"
        defaultName="yeniproje"
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Bağlı bir GitHub hesabı yok/i)).toBeInTheDocument();
    });
  });

  it("renders the form prefilled with the folder name and publishes", async () => {
    vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue([connectedAccount]);
    const result: GitHubPublishResult = {
      html_url: "https://github.com/octocat/yeniproje",
      clone_url: "https://github.com/octocat/yeniproje.git",
      pushed: false,
      warning: "İlk commit henüz yok.",
    };
    const onPublished = vi.fn();
    vi.mocked(tauriCommands.githubPublishRepository).mockResolvedValue(result);

    render(
      <PublishRepoModal
        repoId="repo-1"
        defaultName="yeniproje"
        onClose={vi.fn()}
        onPublished={onPublished}
      />
    );

    const nameInput = (await screen.findByPlaceholderText(
      "proje-adi"
    )) as HTMLInputElement;
    expect(nameInput.value).toBe("yeniproje");

    const privateBox = screen.getByLabelText(/Özel depo/i) as HTMLInputElement;
    fireEvent.click(privateBox);

    fireEvent.click(screen.getByRole("button", { name: /Yayınla/i }));

    await waitFor(() => {
      expect(tauriCommands.githubPublishRepository).toHaveBeenCalledWith(
        "acc-1",
        "repo-1",
        "yeniproje",
        null,
        true
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Depo GitHub'da oluşturuldu/i)).toBeInTheDocument();
    });
    // pushed=false → warning is surfaced (not a false "pushed" success)
    expect(screen.getByText("İlk commit henüz yok.")).toBeInTheDocument();
    expect(onPublished).toHaveBeenCalledWith(result);
  });

  it("surfaces REMOTE_EXISTS as an explanatory error", async () => {
    vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue([connectedAccount]);
    vi.mocked(tauriCommands.githubPublishRepository).mockRejectedValue({
      code: "REMOTE_EXISTS",
      message: "'origin' zaten var",
    });

    render(
      <PublishRepoModal
        repoId="repo-1"
        defaultName="zatenvar"
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />
    );

    await screen.findByPlaceholderText("proje-adi");
    fireEvent.click(screen.getByRole("button", { name: /Yayınla/i }));

    await waitFor(() => {
      expect(screen.getByText(/Dışa Aktar butonunu kullanın/i)).toBeInTheDocument();
    });
  });
});
