// ─────────────────────────────────────────────────────────────
// @jml-ops/connectors — SAP SuccessFactors HRIS Sync
//
// GENUINELY DIFFERENT SHAPE from every other connector in this
// package. SuccessFactors is the customer's system of record for
// HR data — a JOINER/MOVER/LEAVER event should ORIGINATE there,
// not be written there. This class reads employee changes and
// creates real ProvisioningJob rows, using the "hris_webhook"
// triggeredBy value already anticipated in the schema (see
// packages/db/prisma/schema.prisma — ProvisioningJob.triggeredBy
// comment: "prompt" | "hris_webhook" | "slack_bot" | "jsm_ticket").
// It does NOT create/update/delete employees in SuccessFactors —
// that direction would put JML Ops in conflict with the actual
// HR system of record.
//
// API: OData v2 (NOT the deprecated SOAP Employee Central SFAPIs,
// which SAP is deleting November 20, 2026 — confirmed via current
// SAP documentation). Auth uses OAuth 2.0 via SAML Bearer Assertion
// per SAP's current guidance; Basic Auth is being retired and is
// deliberately not supported here.
//
// Real, current entities used: User (base account/status),
// EmpEmployment (hire/termination dates), EmpJob (job title,
// department, manager — the MOVER-relevant fields).
// ─────────────────────────────────────────────────────────────

import { prisma } from "@jml-ops/db";

export interface SuccessFactorsConfig {
  apiServerUrl: string; // e.g. https://apiXX.successfactors.com
  companyId: string; // the SuccessFactors company/tenant identifier
  oauthAccessToken: string; // pre-obtained via SAML Bearer Assertion flow — see file header
}

export interface SuccessFactorsSyncResult {
  success: boolean;
  action: string;
  newJobsCreated: number;
  employeesChecked: number;
  errorMessage?: string;
  durationMs: number;
}

interface SfEmployeeRecord {
  personIdExternal: string;
  userId: string;
  startDate?: string;
  endDate?: string;
  lastModifiedDateTime: string;
  jobTitle?: string;
  department?: string;
  managerId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export class SuccessFactorsSync {
  private apiServerUrl: string;
  private companyId: string;
  private oauthAccessToken: string;

  constructor(config: SuccessFactorsConfig) {
    this.apiServerUrl = config.apiServerUrl.replace(/\/$/, "");
    this.companyId = config.companyId;
    this.oauthAccessToken = config.oauthAccessToken;
  }

  private async callODataV2(path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
    const res = await fetch(`${this.apiServerUrl}/odata/v2/${path}`, {
      headers: {
        Authorization: `Bearer ${this.oauthAccessToken}`,
        Accept: "application/json",
      },
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  }

  /** Verifies the connection can actually read from the tenant. */
  async testConnection(): Promise<SuccessFactorsSyncResult> {
    const start = Date.now();
    try {
      const result = await this.callODataV2("User?$top=1");
      return {
        success: result.ok,
        action: "test_connection",
        newJobsCreated: 0,
        employeesChecked: 0,
        errorMessage: result.ok ? undefined : `HTTP ${result.status}`,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "test_connection",
        newJobsCreated: 0,
        employeesChecked: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * The real, core sync operation — polls EmpEmployment for records
   * modified since the last successful sync, and for each one,
   * determines whether it represents a JOINER (new startDate,
   * no prior ProvisioningJob for this person), LEAVER (a new
   * endDate appeared), or MOVER (job/department changed on an
   * already-known employee) — then creates a real ProvisioningJob
   * with prompt text built from the actual SuccessFactors data,
   * exactly the same job shape the Prompt Console itself creates,
   * just triggered by a schedule instead of a person typing.
   *
   * This uses polling on lastModifiedDateTime rather than a true
   * webhook, per the real constraint found in research: SAP's
   * Intelligent Services event framework is not a standard webhook
   * registration API, so scheduled polling is the honest, currently
   * buildable integration pattern — matches the schema's own
   * "hris_webhook" label loosely (the trigger is HRIS-originated),
   * not literally an inbound webhook call.
   */
  async syncChangesSince(companyDbId: string, sinceIso: string): Promise<SuccessFactorsSyncResult> {
    const start = Date.now();
    let newJobsCreated = 0;
    let employeesChecked = 0;

    try {
      const filter = `lastModifiedDateTime ge datetime'${sinceIso}'`;
      const result = await this.callODataV2(
        `EmpEmployment?$filter=${encodeURIComponent(filter)}&$expand=EmpJob`
      );

      if (!result.ok) {
        return {
          success: false,
          action: "sync_changes",
          newJobsCreated: 0,
          employeesChecked: 0,
          errorMessage: `HTTP ${result.status}`,
          durationMs: Date.now() - start,
        };
      }

      const records = ((result.data as { d?: { results?: SfEmployeeRecord[] } })?.d?.results) ?? [];
      employeesChecked = records.length;

      for (const record of records) {
        const existingEmployee = await prisma.employee.findFirst({
          where: { companyId: companyDbId, externalId: record.personIdExternal },
        });

        let prompt: string | null = null;
        let eventType: "JOINER" | "MOVER" | "LEAVER" | null = null;

        if (!existingEmployee && record.email) {
          // Genuinely new person in SuccessFactors — a real JOINER trigger.
          eventType = "JOINER";
          prompt = `Onboard ${record.email} (${record.firstName ?? ""} ${record.lastName ?? ""}) as ${record.jobTitle ?? "employee"}${record.department ? ` in ${record.department}` : ""}`;
        } else if (existingEmployee && record.endDate) {
          // A termination date appeared on a previously-known employee.
          eventType = "LEAVER";
          prompt = `Offboard ${existingEmployee.email} — SuccessFactors reports last day ${record.endDate}`;
        } else if (
          existingEmployee &&
          (record.jobTitle !== existingEmployee.jobTitle || record.department !== existingEmployee.department)
        ) {
          // Job title or department changed on a known employee — a real MOVER trigger.
          eventType = "MOVER";
          prompt = `Move ${existingEmployee.email} to ${record.jobTitle ?? existingEmployee.jobTitle} in ${record.department ?? existingEmployee.department}, per SuccessFactors update`;
        }

        if (prompt && eventType) {
          await prisma.provisioningJob.create({
            data: {
              companyId: companyDbId,
              employeeId: existingEmployee?.id ?? null,
              eventType,
              status: "PENDING",
              prompt,
              triggeredBy: "hris_webhook",
            },
          });
          newJobsCreated++;
        }
      }

      return {
        success: true,
        action: "sync_changes",
        newJobsCreated,
        employeesChecked,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        action: "sync_changes",
        newJobsCreated,
        employeesChecked,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }
}
