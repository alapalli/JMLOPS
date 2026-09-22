// ─────────────────────────────────────────────────────────────
// @jml-ops/connectors — Salesforce Connector
//
// Real Salesforce REST API via plain fetch (no SDK dependency
// needed — Salesforce's REST API is straightforward JSON over
// HTTP once authenticated). Confirmed via current docs:
// - User.IsActive = false is the real "deactivate" mechanism —
//   Salesforce users are never hard-deleted via API, matching the
//   platform's own data-integrity model (a User is referenced by
//   too many other records to ever delete outright).
// - PermissionSetAssignment is a SEPARATE object/API call from
//   the User record itself — granting access is always a
//   two-step operation here, not a field on the user.
//
// Auth: this connector expects an already-obtained OAuth access
// token + instance URL (the standard Salesforce "Connected App"
// flow) — token acquisition itself is out of scope for this
// class, same separation of concerns as how EntraConnector
// expects Azure AD app credentials to already be configured.
// ─────────────────────────────────────────────────────────────

export interface SalesforceConfig {
  instanceUrl: string; // e.g. https://yourcompany.my.salesforce.com
  accessToken: string;
  apiVersion?: string; // defaults to a recent, real API version
}

export interface SalesforceConnectorResult {
  success: boolean;
  action: string;
  salesforceUserId?: string;
  response?: unknown;
  errorMessage?: string;
  durationMs: number;
}

export class SalesforceConnector {
  private instanceUrl: string;
  private accessToken: string;
  private apiVersion: string;

  constructor(config: SalesforceConfig) {
    this.instanceUrl = config.instanceUrl.replace(/\/$/, "");
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion ?? "v61.0";
  }

  private async callSalesforce(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: Record<string, unknown>
  ): Promise<{ ok: boolean; status: number; data: unknown }> {
    const res = await fetch(`${this.instanceUrl}/services/data/${this.apiVersion}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Salesforce returns an empty body on successful PATCH (204) —
    // guard against parsing empty responses as JSON.
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { ok: res.ok, status: res.status, data };
  }

  /** Verifies the token/instance actually work before first use. */
  async testConnection(): Promise<SalesforceConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.callSalesforce("GET", "/limits");
      return {
        success: result.ok,
        action: "test_connection",
        response: result.ok ? { connected: true } : result.data,
        errorMessage: result.ok ? undefined : `HTTP ${result.status}`,
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

  /** Finds a Salesforce User record by email via SOQL query. */
  async findUserByEmail(email: string): Promise<SalesforceConnectorResult> {
    const start = Date.now();
    try {
      const soql = `SELECT Id, Username, IsActive FROM User WHERE Email = '${email.replace(/'/g, "\\'")}' LIMIT 1`;
      const result = await this.callSalesforce("GET", `/query?q=${encodeURIComponent(soql)}`);
      const records = (result.data as { records?: { Id: string; IsActive: boolean }[] })?.records ?? [];
      if (records.length === 0) {
        return {
          success: false,
          action: "find_user",
          errorMessage: "No matching Salesforce user found",
          durationMs: Date.now() - start,
        };
      }
      return {
        success: true,
        action: "find_user",
        salesforceUserId: records[0].Id,
        response: { userId: records[0].Id, isActive: records[0].IsActive },
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

  /**
   * Creates a Salesforce User. Note: Salesforce requires a
   * ProfileId on every user (defines their base license/access
   * tier) — this must be passed in, there's no sensible default,
   * since it varies per customer's Salesforce setup.
   */
  async createUser(params: {
    email: string;
    firstName: string;
    lastName: string;
    username: string; // Salesforce usernames must be globally unique, often email-formatted with a suffix
    profileId: string;
  }): Promise<SalesforceConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.callSalesforce("POST", "/sobjects/User", {
        Email: params.email,
        FirstName: params.firstName,
        LastName: params.lastName,
        Username: params.username,
        Alias: params.lastName.slice(0, 8),
        TimeZoneSidKey: "America/Los_Angeles",
        LocaleSidKey: "en_US",
        EmailEncodingKey: "UTF-8",
        LanguageLocaleKey: "en_US",
        ProfileId: params.profileId,
      });
      if (!result.ok) {
        return {
          success: false,
          action: "create_user",
          errorMessage: JSON.stringify(result.data),
          durationMs: Date.now() - start,
        };
      }
      const created = result.data as { id: string };
      return {
        success: true,
        action: "create_user",
        salesforceUserId: created.id,
        response: { userId: created.id },
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

  /** Assigns a Permission Set to a user — a genuinely separate object/call from the User record. */
  async assignPermissionSet(salesforceUserId: string, permissionSetId: string): Promise<SalesforceConnectorResult> {
    const start = Date.now();
    try {
      const result = await this.callSalesforce("POST", "/sobjects/PermissionSetAssignment", {
        AssigneeId: salesforceUserId,
        PermissionSetId: permissionSetId,
      });
      if (!result.ok) {
        return {
          success: false,
          action: "assign_permission_set",
          salesforceUserId,
          errorMessage: JSON.stringify(result.data),
          durationMs: Date.now() - start,
        };
      }
      return {
        success: true,
        action: "assign_permission_set",
        salesforceUserId,
        response: { permissionSetId },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "assign_permission_set",
        salesforceUserId,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ── MOVER ────────────────────────────────────────────────────

  /**
   * Removes a Permission Set assignment. Requires the assignment's
   * OWN record ID (not the user ID or permission set ID directly)
   * — callers should query PermissionSetAssignment first to find it.
   */
  async removePermissionSetAssignment(assignmentId: string): Promise<SalesforceConnectorResult> {
    const start = Date.now();
    try {
      const res = await fetch(
        `${this.instanceUrl}/services/data/${this.apiVersion}/sobjects/PermissionSetAssignment/${assignmentId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
      return {
        success: res.ok,
        action: "remove_permission_set_assignment",
        errorMessage: res.ok ? undefined : `HTTP ${res.status}`,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "remove_permission_set_assignment",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  // ── LEAVER ───────────────────────────────────────────────────

  /**
   * Deactivates a Salesforce user. This is genuinely the ONLY real
   * offboarding mechanism — Salesforce users cannot be hard-deleted
   * via API (or generally at all), since they're referenced by
   * ownership fields across the whole org's data model. Setting
   * IsActive: false immediately blocks login and frees the license
   * seat, which is the real, complete "offboarding" action here.
   */
  async deactivateUser(salesforceUserId: string): Promise<SalesforceConnectorResult> {
    const start = Date.now();
    try {
      const res = await fetch(
        `${this.instanceUrl}/services/data/${this.apiVersion}/sobjects/User/${salesforceUserId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ IsActive: false }),
        }
      );
      return {
        success: res.ok,
        action: "deactivate_user",
        salesforceUserId,
        response: { note: "Salesforce users are deactivated, never hard-deleted, via API" },
        errorMessage: res.ok ? undefined : `HTTP ${res.status}`,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "deactivate_user",
        salesforceUserId,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }
}
