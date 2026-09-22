// ─────────────────────────────────────────────────────────────
// @jml-ops/connectors — Slack Connector
//
// SCOPE NOTE, stated honestly up front: Slack's full account
// lifecycle APIs (admin.users.invite, SCIM user create/deactivate)
// are gated to Enterprise Grid — and per one real source found
// during research, SCIM specifically may require that tier too,
// not just "Business+" as another source claimed. Given most real
// customers won't be on Enterprise Grid, this connector
// deliberately does NOT attempt account creation/deactivation.
//
// What it DOES do, using the standard Web API available on every
// paid Slack plan: manage a user's CHANNEL and USER GROUP
// membership. This is genuinely the JML-relevant operation for
// most real customers — "give them access to the right channels
// when they join, remove them when they leave" — without
// requiring a Slack tier most SMB/mid-market customers won't have.
//
// Real, current Slack Web API methods used here (confirmed via
// search): conversations.invite, conversations.kick,
// usergroups.users.update, usergroups.users.list, users.lookupByEmail.
// ─────────────────────────────────────────────────────────────

export interface SlackConfig {
  botToken: string; // xoxb- token, standard Web API auth
}

export interface SlackConnectorResult {
  success: boolean;
  action: string;
  slackUserId?: string;
  response?: unknown;
  errorMessage?: string;
  durationMs: number;
}

const SLACK_API_BASE = "https://slack.com/api";

/**
 * Thin wrapper around Slack's Web API, scoped to channel and user-
 * group membership only — see the file header for why account
 * lifecycle operations are deliberately excluded.
 */
export class SlackConnector {
  private botToken: string;

  constructor(config: SlackConfig) {
    this.botToken = config.botToken;
  }

  private async callSlack(method: string, params: Record<string, unknown>): Promise<{ ok: boolean; [key: string]: unknown }> {
    const res = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  /** Verifies the bot token actually works before first use. */
  async testConnection(): Promise<SlackConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.callSlack("auth.test", {});
      if (!result.ok) {
        return {
          success: false,
          action: "test_connection",
          errorMessage: String(result.error ?? "Unknown Slack API error"),
          durationMs: Date.now() - start,
        };
      }
      return {
        success: true,
        action: "test_connection",
        response: { team: result.team, botId: result.bot_id },
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

  /**
   * Resolves an email address to a Slack user ID — the required
   * first step before any membership operation, since Slack's
   * membership APIs take user IDs, not emails.
   */
  async findUserByEmail(email: string): Promise<SlackConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.callSlack("users.lookupByEmail", { email });
      if (!result.ok) {
        return {
          success: false,
          action: "find_user",
          errorMessage: result.error === "users_not_found" ? "No matching Slack user found" : String(result.error),
          durationMs: Date.now() - start,
        };
      }
      const user = result.user as { id: string; name: string } | undefined;
      return {
        success: true,
        action: "find_user",
        slackUserId: user?.id,
        response: { userId: user?.id, name: user?.name },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "find_user",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ── JOINER ──────────────────────────────────────────────────

  /** Invites a Slack user (by user ID) to a channel. */
  async inviteToChannel(slackUserId: string, channelId: string): Promise<SlackConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.callSlack("conversations.invite", {
        channel: channelId,
        users: slackUserId,
      });
      if (!result.ok) {
        // "already_in_channel" is a real, benign case — treat as success,
        // matching the idempotent-provisioning discipline used elsewhere.
        const isAlreadyMember = result.error === "already_in_channel";
        return {
          success: isAlreadyMember,
          action: "invite_to_channel",
          slackUserId,
          errorMessage: isAlreadyMember ? undefined : String(result.error),
          durationMs: Date.now() - start,
        };
      }
      return {
        success: true,
        action: "invite_to_channel",
        slackUserId,
        response: { channelId },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "invite_to_channel",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Adds a user to a Slack User Group (e.g. "@engineering") — the
   * closest Slack equivalent to an Entra security group for
   * broad, role-based access (many channels can be scoped to a
   * user group rather than inviting individually).
   */
  async addToUserGroup(slackUserId: string, userGroupId: string): Promise<SlackConnectorResult> {
    const start = Date.now();
    try {
      // Slack's usergroups.users.update REPLACES the full member list,
      // so the current list must be fetched first and the new user
      // appended — there's no additive "add one user" endpoint.
      const current = await this.callSlack("usergroups.users.list", { usergroup: userGroupId });
      if (!current.ok) {
        return {
          success: false,
          action: "add_to_user_group",
          slackUserId,
          errorMessage: String(current.error),
          durationMs: Date.now() - start,
        };
      }
      const existingUsers = (current.users as string[]) ?? [];
      const updatedUsers = existingUsers.includes(slackUserId) ? existingUsers : [...existingUsers, slackUserId];

      const result = await this.callSlack("usergroups.users.update", {
        usergroup: userGroupId,
        users: updatedUsers.join(","),
      });
      if (!result.ok) {
        return {
          success: false,
          action: "add_to_user_group",
          slackUserId,
          errorMessage: String(result.error),
          durationMs: Date.now() - start,
        };
      }
      return {
        success: true,
        action: "add_to_user_group",
        slackUserId,
        response: { userGroupId, totalMembers: updatedUsers.length },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "add_to_user_group",
        slackUserId,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ── MOVER ────────────────────────────────────────────────────

  /** Removes a user from a channel — used during MOVER to drop old-team channel access. */
  async removeFromChannel(slackUserId: string, channelId: string): Promise<SlackConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.callSlack("conversations.kick", {
        channel: channelId,
        user: slackUserId,
      });
      if (!result.ok) {
        return {
          success: false,
          action: "remove_from_channel",
          slackUserId,
          errorMessage: String(result.error),
          durationMs: Date.now() - start,
        };
      }
      return {
        success: true,
        action: "remove_from_channel",
        slackUserId,
        response: { channelId },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "remove_from_channel",
        slackUserId,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /** Removes a user from a Slack User Group — same replace-the-list pattern as addToUserGroup. */
  async removeFromUserGroup(slackUserId: string, userGroupId: string): Promise<SlackConnectorResult> {
    const start = Date.now();
    try {
      const current = await this.callSlack("usergroups.users.list", { usergroup: userGroupId });
      if (!current.ok) {
        return {
          success: false,
          action: "remove_from_user_group",
          slackUserId,
          errorMessage: String(current.error),
          durationMs: Date.now() - start,
        };
      }
      const existingUsers = (current.users as string[]) ?? [];
      const updatedUsers = existingUsers.filter((id) => id !== slackUserId);

      const result = await this.callSlack("usergroups.users.update", {
        usergroup: userGroupId,
        users: updatedUsers.join(","),
      });
      if (!result.ok) {
        return {
          success: false,
          action: "remove_from_user_group",
          slackUserId,
          errorMessage: String(result.error),
          durationMs: Date.now() - start,
        };
      }
      return {
        success: true,
        action: "remove_from_user_group",
        slackUserId,
        response: { userGroupId, totalMembers: updatedUsers.length },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "remove_from_user_group",
        slackUserId,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ── LEAVER ───────────────────────────────────────────────────

  /**
   * NOTE: full account deactivation is NOT implemented here — see
   * the file header. On the LEAVER path, this connector's real,
   * honest contribution is removing the user from every channel
   * and user group it can see, which meaningfully reduces their
   * access footprint even without deactivating the Slack account
   * itself. Full deactivation requires the customer's Slack plan
   * to support admin.users.* or SCIM (Enterprise Grid), which is
   * a separate, explicit capability check — not assumed here.
   */
  async removeFromAllKnownChannelsAndGroups(
    slackUserId: string,
    channelIds: string[],
    userGroupIds: string[]
  ): Promise<SlackConnectorResult> {
    const start = Date.now();
    let removedCount = 0;
    const totalTargets = channelIds.length + userGroupIds.length;

    for (const channelId of channelIds) {
      const result = await this.removeFromChannel(slackUserId, channelId);
      if (result.success) removedCount++;
    }
    for (const userGroupId of userGroupIds) {
      const result = await this.removeFromUserGroup(slackUserId, userGroupId);
      if (result.success) removedCount++;
    }

    return {
      success: true,
      action: "remove_from_all_known_channels_and_groups",
      slackUserId,
      response: {
        removedCount,
        totalTargets,
        note: "Does not deactivate the Slack account itself — see connector scope notes",
      },
      durationMs: Date.now() - start,
    };
  }
}
