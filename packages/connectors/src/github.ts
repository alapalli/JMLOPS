// ─────────────────────────────────────────────────────────────
// @jml-ops/connectors — GitHub Connector
//
// Real GitHub REST API via @octokit/rest v22 (confirmed current,
// npm i @octokit/rest). Unlike Slack, GitHub's organization and
// team membership APIs work on every real GitHub plan — no
// Enterprise-only gate was found in the current documentation, so
// this connector supports full JOINER/MOVER/LEAVER operations,
// not a reduced scope.
//
// Real, current endpoints used here (confirmed via GitHub's own
// docs): PUT /orgs/{org}/memberships/{username} (org invite/add),
// PUT /orgs/{org}/teams/{team_slug}/memberships/{username} (team
// add/update), DELETE on the same path (team remove), DELETE
// /orgs/{org}/members/{username} (full org removal — correctly
// cascades to remove all team access per GitHub's own docs).
// ─────────────────────────────────────────────────────────────

import { Octokit } from "@octokit/rest";

export interface GitHubConfig {
  org: string;
  personalAccessToken: string; // or a GitHub App installation token
}

export interface GitHubConnectorResult {
  success: boolean;
  action: string;
  githubUsername?: string;
  response?: unknown;
  errorMessage?: string;
  durationMs: number;
}

/**
 * Thin wrapper around @octokit/rest, scoped to org and team
 * membership — the JOINER/MOVER/LEAVER-relevant operations.
 * Matches EntraConnector's discipline: one method = one
 * auditable action.
 */
export class GitHubConnector {
  private octokit: Octokit;
  private org: string;

  constructor(config: GitHubConfig) {
    this.org = config.org;
    this.octokit = new Octokit({ auth: config.personalAccessToken });
  }

  /** Verifies the token works and can see the target org. */
  async testConnection(): Promise<GitHubConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.octokit.rest.orgs.get({ org: this.org });
      return {
        success: true,
        action: "test_connection",
        response: { orgLogin: result.data.login, orgId: result.data.id },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "test_connection",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ── JOINER ──────────────────────────────────────────────────

  /**
   * Adds a GitHub username to the organization. If the person
   * isn't already a member, this sends a real invitation email —
   * GitHub's own documented behavior, not something this connector
   * can bypass. Membership becomes "active" once accepted.
   */
  async addToOrg(githubUsername: string, role: "member" | "admin" = "member"): Promise<GitHubConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.octokit.rest.orgs.setMembershipForUser({
        org: this.org,
        username: githubUsername,
        role,
      });
      return {
        success: true,
        action: "add_to_org",
        githubUsername,
        response: { state: result.data.state, role: result.data.role },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "add_to_org",
        githubUsername,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /** Adds a user to a specific team within the org. */
  async addToTeam(githubUsername: string, teamSlug: string, role: "member" | "maintainer" = "member"): Promise<GitHubConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.octokit.rest.teams.addOrUpdateMembershipForUserInOrg({
        org: this.org,
        team_slug: teamSlug,
        username: githubUsername,
        role,
      });
      return {
        success: true,
        action: "add_to_team",
        githubUsername,
        response: { state: result.data.state, role: result.data.role, teamSlug },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "add_to_team",
        githubUsername,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ── MOVER ────────────────────────────────────────────────────

  /** Removes a user from one team, without removing them from the org — the real MOVER shape. */
  async removeFromTeam(githubUsername: string, teamSlug: string): Promise<GitHubConnectorResult> {
    const start = Date.now();
    try {
      await this.octokit.rest.teams.removeMembershipForUserInOrg({
        org: this.org,
        team_slug: teamSlug,
        username: githubUsername,
      });
      return {
        success: true,
        action: "remove_from_team",
        githubUsername,
        response: { teamSlug },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "remove_from_team",
        githubUsername,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ── LEAVER ───────────────────────────────────────────────────

  /**
   * Removes the user from the organization entirely. Per GitHub's
   * own documentation, this automatically removes them from every
   * team and repository they had access to via org membership —
   * no need to call removeFromTeam for each team individually
   * first, matching the same "one decisive action" pattern as
   * Entra's removeAllGroups where the platform itself cascades
   * the cleanup.
   */
  async removeFromOrg(githubUsername: string): Promise<GitHubConnectorResult> {
    const start = Date.now();
    try {
      await this.octokit.rest.orgs.removeMember({
        org: this.org,
        username: githubUsername,
      });
      return {
        success: true,
        action: "remove_from_org",
        githubUsername,
        response: { note: "Cascades to remove all team and repo access per GitHub's documented behavior" },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "remove_from_org",
        githubUsername,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /** Looks up whether a username is currently a member of the org. */
  async findUser(githubUsername: string): Promise<GitHubConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.octokit.rest.orgs.getMembershipForUser({
        org: this.org,
        username: githubUsername,
      });
      return {
        success: true,
        action: "find_user",
        githubUsername,
        response: { state: result.data.state, role: result.data.role },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      // 404 is the real, expected GitHub response when the user isn't
      // an org member — treat as a normal "not found," not a failure.
      const isNotFound = err instanceof Error && "status" in err && (err as { status: number }).status === 404;
      return {
        success: false,
        action: "find_user",
        githubUsername,
        errorMessage: isNotFound ? "User is not a member of this organization" : err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }
}
