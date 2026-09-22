import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

/**
 * Constrain telemetry details to policy:
 * - May contain only letters, digits, spaces and the characters . , : ; / % ( ) - _
 * - Must be <= 500 chars
 * - Must NOT contain a path separator followed by a filename extension (e.g. "src/app.ts"),
 *   a backslash, or a newline.
 */
function isValidTelemetryDetails(details: unknown): boolean {
  if (typeof details !== "string") {
    return false;
  }
  if (details.length > 500) {
    return false;
  }
  if (
    details.includes("\\") ||
    details.includes("\n") ||
    details.includes("\r")
  ) {
    return false;
  }
  if (!/^[a-zA-Z0-9 .,:;/%()_-]*$/.test(details)) {
    return false;
  }
  if (/[/\\][a-zA-Z0-9_.-]*\.[a-zA-Z0-9]+/.test(details)) {
    return false;
  }
  return true;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ runs: [] });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  let query = supabase
    .from("conformance_runs")
    .select(
      "id, project_id, commit_sha, agent_trigger, status, details, created_at, projects(name, repo_url)",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  const isUuid =
    typeof projectId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      projectId,
    );

  if (projectId && isUuid) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(request: Request) {
  try {
    // 1. Authenticate the caller
    const authHeader = request.headers.get("authorization");
    let token: string | null = null;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.replace(/^Bearer\s+/i, "").trim();
    }

    // Reject anonymous sessions explicitly
    if (token === "anon_cli_session") {
      return NextResponse.json(
        {
          error:
            "Unauthorized: anonymous telemetry is not permitted. Run 'anvilmark login --token <TOKEN>' first.",
        },
        { status: 401 },
      );
    }

    const supabase = await createClient();
    let authenticatedUser: { id: string; email?: string } | null = null;

    if (supabase) {
      // Check session cookie first
      const {
        data: { user: sessionUser },
      } = await supabase.auth.getUser();
      if (sessionUser) {
        authenticatedUser = sessionUser;
      } else if (token) {
        // If Bearer token is a JWT, verify with Supabase
        const {
          data: { user: jwtUser },
        } = await supabase.auth.getUser(token);
        if (jwtUser) {
          authenticatedUser = jwtUser;
        }
      }
    }

    // The only credentials that can be verified are a Supabase session or JWT
    // (checked above) and the deployment's own service token. A token is never
    // accepted because of how it is shaped: a prefix is a naming convention,
    // not proof of anything, and anyone can send one.
    const serverApiToken = process.env.ANVILMARK_API_TOKEN;
    const isServiceToken = Boolean(
      serverApiToken && token && token === serverApiToken,
    );

    if (!authenticatedUser && !isServiceToken) {
      return NextResponse.json(
        {
          error:
            "Unauthorized: valid Bearer token or authenticated session required to record conformance telemetry.",
        },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { projectId, commitSha, agentTrigger, status, details } = body;

    // Disallow forbidden source egress fields
    if (
      body.source !== undefined ||
      body.code !== undefined ||
      body.file_contents !== undefined ||
      body.files !== undefined ||
      body.ast !== undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Source code egress is strictly prohibited by ANVILMARK telemetry policy.",
        },
        { status: 400 },
      );
    }

    if (
      !projectId ||
      typeof projectId !== "string" ||
      projectId.trim() === "" ||
      projectId.length > 100
    ) {
      return NextResponse.json(
        { error: "Missing or invalid projectId" },
        { status: 400 },
      );
    }

    // Validate commitSha format: 7-40 hex characters
    if (
      !commitSha ||
      typeof commitSha !== "string" ||
      !/^[0-9a-fA-F]{7,40}$/.test(commitSha.trim())
    ) {
      return NextResponse.json(
        { error: "Invalid commitSha format. Must be 7-40 hex characters." },
        { status: 400 },
      );
    }

    if (!["pass", "fail", "warn"].includes(status)) {
      return NextResponse.json(
        { error: "Status must be one of: pass, fail, warn" },
        { status: 400 },
      );
    }

    if (!isValidTelemetryDetails(details)) {
      return NextResponse.json(
        {
          error:
            "Invalid details: must be <= 500 characters, contain only letters, digits, spaces and . , : ; / % ( ) - _, and must not contain a path separator followed by a filename extension, a backslash, or a newline.",
        },
        { status: 400 },
      );
    }

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        projectId,
      );

    // If it is a demo or reference project (non-UUID), return a clean simulation record
    if (!isUuid) {
      return NextResponse.json({
        ok: true,
        run: {
          id: `sim_${Date.now()}`,
          project_id: projectId,
          commit_sha: commitSha.slice(0, 7),
          agent_trigger:
            typeof agentTrigger === "string"
              ? agentTrigger.slice(0, 100)
              : "CI Conformance Check",
          status,
          details,
          created_at: new Date().toISOString(),
        },
      });
    }

    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 },
      );
    }

    // Verify project exists
    const { data: projectRecord, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single();

    if (projErr || !projectRecord) {
      return NextResponse.json(
        { error: "Project not found or unregistered in console" },
        { status: 404 },
      );
    }

    // Ownership is checked for every write, not only for the callers who
    // authenticated properly: a path that skips it is the hole it was meant to
    // close. The deployment's service token is the one exception, and it is a
    // secret held by the operator rather than a user credential.
    if (!isServiceToken) {
      if (!authenticatedUser || projectRecord.user_id !== authenticatedUser.id)
        return NextResponse.json(
          { error: "Forbidden: user does not own this project" },
          { status: 403 },
        );
    }

    const { data: run, error: runError } = await supabase
      .from("conformance_runs")
      .insert({
        project_id: projectId,
        commit_sha: commitSha.slice(0, 7),
        agent_trigger:
          typeof agentTrigger === "string"
            ? agentTrigger.slice(0, 100)
            : "CI Conformance Check",
        status,
        details,
      })
      .select()
      .single();

    if (runError) {
      return NextResponse.json({ error: runError.message }, { status: 400 });
    }

    // Update project conformance status
    const projectStatus =
      status === "pass"
        ? "verified"
        : status === "fail"
          ? "drift_detected"
          : "verified";

    await supabase
      .from("projects")
      .update({
        conformance_status: projectStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    return NextResponse.json({ ok: true, run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
