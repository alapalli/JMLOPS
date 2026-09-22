// ─────────────────────────────────────────────────────────────
// @jml-ops/connectors — AWS IAM Connector
//
// Real AWS SDK v3 (@aws-sdk/client-iam) integration. Matches the
// exact pattern established by EntraConnector — same
// AwsIamConnectorResult shape, same try/catch-with-duration style
// per method, same "one method = one auditable action" discipline.
//
// Real, current AWS SDK v3 commands used here (confirmed against
// AWS's own documentation, not assumed): CreateUserCommand,
// GetUserCommand, AddUserToGroupCommand, RemoveUserFromGroupCommand,
// ListGroupsForUserCommand — all from "@aws-sdk/client-iam".
//
// SCOPE NOTE: this connector manages IAM USERS and GROUP
// membership only (the JOINER/MOVER/LEAVER-relevant operations).
// It deliberately does NOT create/attach IAM policies, roles, or
// access keys — those are higher-privilege, higher-blast-radius
// operations outside what a JML lifecycle tool should automate
// without a separate, explicit design decision.
// ─────────────────────────────────────────────────────────────

import {
  IAMClient,
  CreateUserCommand,
  GetUserCommand,
  AddUserToGroupCommand,
  RemoveUserFromGroupCommand,
  ListGroupsForUserCommand,
  DeleteUserCommand,
} from "@aws-sdk/client-iam";

export interface AwsIamConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface AwsIamConnectorResult {
  success: boolean;
  action: string;
  awsUserName?: string;
  response?: unknown;
  errorMessage?: string;
  durationMs: number;
}

/**
 * Thin wrapper around the AWS SDK v3 IAM client, scoped to exactly
 * the operations JML Ops needs. Deliberately does NOT expose the
 * raw IAMClient — every method here is one auditable action,
 * matching EntraConnector's discipline exactly.
 */
export class AwsIamConnector {
  private client: IAMClient;

  constructor(config: AwsIamConfig) {
    this.client = new IAMClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /** Verifies the connector's credentials actually work before first use. */
  async testConnection(): Promise<AwsIamConnectorResult> {
    const start = Date.now();
    try {
      // ListGroupsForUser on a throwaway lookup would fail without a
      // real username — GetUser with no UserName returns the calling
      // identity's own IAM user, which is the standard "does this
      // credential work at all" check for IAM.
      const result = await this.client.send(new GetUserCommand({}));
      return {
        success: true,
        action: "test_connection",
        response: { verifiedUser: result.User?.UserName ?? null },
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
   * Creates a new IAM user. Note: this creates the IAM identity
   * itself — most real deployments will instead call findUser()
   * against an already-provisioned user (e.g. via IAM Identity
   * Center / SSO federation) rather than creating raw IAM users
   * directly. Both paths are supported; createUser exists for the
   * direct-IAM-user case.
   */
  async createUser(params: { userName: string }): Promise<AwsIamConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.client.send(
        new CreateUserCommand({ UserName: params.userName })
      );
      return {
        success: true,
        action: "create_user",
        awsUserName: result.User?.UserName,
        response: { userName: result.User?.UserName, arn: result.User?.Arn },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "create_user",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Adds a user to an IAM group by name — e.g. the "AWS landing
   * zone" example: addToGroup({ userName: "jane.doe", groupName:
   * "DevOps-ReadWrite" }).
   */
  async addToGroup(userName: string, groupName: string): Promise<AwsIamConnectorResult> {
    const start = Date.now();
    try {
      await this.client.send(
        new AddUserToGroupCommand({ UserName: userName, GroupName: groupName })
      );
      return {
        success: true,
        action: "add_to_group",
        awsUserName: userName,
        response: { userName, groupName },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "add_to_group",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ── MOVER ────────────────────────────────────────────────────

  /** Removes a user from a group — used during MOVER to drop old-team access. */
  async removeFromGroup(userName: string, groupName: string): Promise<AwsIamConnectorResult> {
    const start = Date.now();
    try {
      await this.client.send(
        new RemoveUserFromGroupCommand({ UserName: userName, GroupName: groupName })
      );
      return {
        success: true,
        action: "remove_from_group",
        awsUserName: userName,
        response: { userName, groupName },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "remove_from_group",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ── LEAVER ───────────────────────────────────────────────────

  /**
   * Removes a user from every IAM group they currently belong to —
   * the AWS equivalent of EntraConnector.removeAllGroups(). Lists
   * real, current group membership first (never assumes), then
   * removes from each one individually, continuing past any single
   * failure rather than aborting the whole step — matches
   * EntraConnector's removeAllGroups behavior exactly.
   */
  async removeAllGroups(userName: string): Promise<AwsIamConnectorResult> {
    const start = Date.now();
    try {
      const membership = await this.client.send(
        new ListGroupsForUserCommand({ UserName: userName })
      );
      const groups = membership.Groups ?? [];

      let removedCount = 0;
      for (const group of groups) {
        if (!group.GroupName) continue;
        try {
          await this.client.send(
            new RemoveUserFromGroupCommand({ UserName: userName, GroupName: group.GroupName })
          );
          removedCount++;
        } catch {
          // Continue past a single group's failure rather than aborting
          // the whole offboarding step — same discipline as Entra's
          // removeAllGroups for dynamic/role-assignable groups.
        }
      }

      return {
        success: true,
        action: "remove_all_groups",
        awsUserName: userName,
        response: { groupsRemoved: removedCount, totalGroups: groups.length },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "remove_all_groups",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Deletes the IAM user entirely. NOTE: unlike Entra's soft-delete
   * (30-day retention), IAM's DeleteUser is immediate and permanent
   * — AWS itself has no equivalent recycle-bin behavior for IAM
   * users. Callers should treat this as irreversible.
   */
  async deleteUser(userName: string): Promise<AwsIamConnectorResult> {
    const start = Date.now();
    try {
      await this.client.send(new DeleteUserCommand({ UserName: userName }));
      return {
        success: true,
        action: "delete_user",
        awsUserName: userName,
        response: { softDeleted: false, note: "IAM DeleteUser is immediate and permanent, unlike Entra" },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "delete_user",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /** Looks up whether an IAM user exists by username. */
  async findUser(userName: string): Promise<AwsIamConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.client.send(new GetUserCommand({ UserName: userName }));
      return {
        success: true,
        action: "find_user",
        awsUserName: result.User?.UserName,
        response: { userName: result.User?.UserName, arn: result.User?.Arn },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      // NoSuchEntityException is the real, expected AWS error when the
      // user doesn't exist — treat this as a normal "not found" result,
      // not a connector failure, same as Entra's findUserByEmail.
      const isNotFound = err instanceof Error && err.name === "NoSuchEntityException";
      return {
        success: false,
        action: "find_user",
        errorMessage: isNotFound ? "No matching IAM user found" : err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }
}
