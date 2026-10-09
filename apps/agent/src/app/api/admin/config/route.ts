import { storeFromEnv } from "@slice/observer/store";
import { authorized } from "@slice/observer/auth";
import { updateConfig } from "../../../../lib/config.js";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (
    !authorized(
      request.headers.get("authorization"),
      process.env.AGENT_ADMIN_TOKEN,
    )
  )
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    return Response.json({ error: "too_large" }, { status: 413 });
  try {
    const raw = await request.text();
    if (raw.length > 1024)
      return Response.json({ error: "too_large" }, { status: 413 });
    const body = JSON.parse(raw) as { revision: number; payTo: string };
    if (Object.keys(body).some((k) => !["revision", "payTo"].includes(k)))
      return Response.json({ error: "invalid_fields" }, { status: 400 });
    const config = await updateConfig(
      storeFromEnv(),
      body.revision,
      body.payTo,
    );
    return Response.json(
      {
        revision: config.revision,
        payTo: config.payTo,
        updatedAt: config.updatedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "invalid_config_or_revision_conflict" },
      { status: 409 },
    );
  }
}
