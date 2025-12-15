import { Octokit } from "@octokit/rest";

export type GitHubToken = {
  access_token: string;
  token_type: string;
  scope: string;
};

export type GitHubUser = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
};

export class GitHubSDK {
  private client: Octokit;
  private accessToken: string;

  constructor(accessToken: string) {
    const trimmed = accessToken.trim();
    if (trimmed.length === 0) {
      throw new Error("GitHub access token is required.");
    }
    this.client = new Octokit({ auth: trimmed });
    this.accessToken = trimmed;
  }

  getAccessToken(): string {
    return this.accessToken;
  }

  static async fromCode(params: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri?: string;
  }): Promise<GitHubSDK> {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        ...(params.redirectUri ? { redirect_uri: params.redirectUri } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error("GitHub token exchange failed");
    }

    const tokenResponse = (await response.json()) as GitHubToken;
    return new GitHubSDK(tokenResponse.access_token);
  }

  async getAuthenticatedUser(): Promise<GitHubUser> {
    const { data: user } = await this.client.rest.users.getAuthenticated();
    let resolvedEmail: string | null = user.email ?? null;
    if (!resolvedEmail) {
      const { data: emails } = await this.client.rest.users.listEmailsForAuthenticatedUser();
      const primaryEmail = emails.find((e) => e.primary);
      resolvedEmail = primaryEmail?.email ?? null;
    }
    return {
      id: user.id,
      login: user.login,
      name: user.name ?? null,
      email: resolvedEmail,
      avatar_url: user.avatar_url,
    };
  }

  async getCollaboratorPermissionLevel(
    owner: string,
    repo: string,
    username: string,
  ): Promise<{
    permission: "admin" | "write" | "read" | "none";
    hasPushAccess: boolean;
  }> {
    try {
      const { data } = await this.client.rest.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username,
      });
      const permission = data.permission as "admin" | "write" | "read" | "none";
      const hasPushAccess = permission === "admin" || permission === "write";
      return { permission, hasPushAccess };
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) {
        const status = (error as { status?: number }).status;
        if (status === 404 || status === 403) {
          return { permission: "none", hasPushAccess: false };
        }
      }
      throw error;
    }
  }
}
