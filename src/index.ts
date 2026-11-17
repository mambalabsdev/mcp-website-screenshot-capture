#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// How long the actor run itself is allowed to take, in seconds. Fleet standard
// (standing build rule 5, 2026-10-05). A run of 50 searches of 100 posts each
const ACTOR_RUN_TIMEOUT_SECS = 1800;

// How long this wrapper waits for that run, in milliseconds. The actor's own
// timeout plus two minutes, so the run's own TIMED-OUT status is what the
// caller sees rather than the wrapper giving up first and reporting nothing.
const WRAPPER_WAIT_MS = (ACTOR_RUN_TIMEOUT_SECS + 120) * 1000;
const POLL_INTERVAL_MS = 3000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. Apify's synchronous endpoints carry a platform
// ceiling of 300 seconds on the HTTP wait itself and answer 408 past it whatever
// the timeout parameter says, so a long run reads as a timeout even though the
// actor goes on to finish. Starting the run, polling it to a terminal status and
// then reading the dataset is the only way to wait as long as the actor needs.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const headers = {
    Authorization: `Bearer ${APIFY_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const httpError = async (response: Response): Promise<string> => {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }
    switch (response.status) {
      case 400:
        return `The ${actorLabel} run was rejected as invalid input.${detail}`;
      case 401:
        return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
      case 402:
        return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
      default:
        return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
  };

  // 1. Start the run.
  let started: Response;
  try {
    started = await fetch(
      `https://api.apify.com/v2/acts/${actorPath}/runs?timeout=${ACTOR_RUN_TIMEOUT_SECS}`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }
  if (!started.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
  }

  let run: { id?: string; status?: string; defaultDatasetId?: string };
  try {
    run = ((await started.json()) as { data?: typeof run }).data ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
  }
  const runId = run.id;
  if (!runId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
  }

  // 2. Poll to a terminal status.
  const deadline = Date.now() + WRAPPER_WAIT_MS;
  let status = run.status ?? "READY";
  let datasetId = run.defaultDatasetId;
  while (!TERMINAL.has(status)) {
    if (Date.now() >= deadline) {
      return {
        isError: true,
        content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
      };
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
    }
    if (!poll.ok) {
      return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
    }
    const body = (await poll.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    status = body.data?.status ?? status;
    datasetId = body.data?.defaultDatasetId ?? datasetId;
  }

  // 3. A run that did not succeed is a failure the caller must see, never an
  // empty success. Surfacing it here is what keeps a crashed run from reading
  // as "no results found".
  if (status !== "SUCCEEDED") {
    return {
      isError: true,
      content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
    };
  }
  if (!datasetId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
  }

  // 4. Read the dataset.
  let ds: Response;
  try {
    ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
  }
  if (!ds.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
  }

  let items: unknown;
  try {
    items = await ds.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

// The actor's number and on or off inputs are text fields (Apify checks input
// types before the actor starts, and Clay sends text), so numbers and booleans
// from the model are sent as text.
function asActorInput(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(compact(args))) {
    out[k] = typeof v === "number" || typeof v === "boolean" ? String(v) : v;
  }
  return out;
}

const server = new McpServer({
  name: "mamba-website-screenshot-capture",
  version: pkg.version,
});

// Website Screenshot Capture (immutable actor ID nWd9M6qngY0sFiM8N). Every buyer facing input of the actor is exposed.
server.registerTool(
  "capture_website_screenshots",
  {
    title: "Capture website screenshots",
    description:
      "Open each URL in a Chromium browser and save a PNG or JPEG screenshot, full page or window only. Returns one row per URL with the image link, final URL, HTTP status, page title, and image size. Pages that refuse the browser come back as free blocked rows.",
    annotations: {
      title: "Capture website screenshots",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      urls: z.array(z.string()).optional().describe("Pages to capture, each starting with http:// or https://. A bare domain such as example.com gets https:// added. From Clay, put the column inside a one item list."),
      full_page: z.boolean().optional().describe("yes captures the whole scrollable page, up to 16,000 pixels tall. no (default) captures the visible window only."),
      viewport_width: z.number().optional().describe("Browser window width, 320 to 3840. Default 1280."),
      viewport_height: z.number().optional().describe("Browser window height, 240 to 2160. Default 800. With Full page on, the image is as tall as the page."),
      format: z.enum(["png","jpeg"]).optional().describe("png (default) or jpeg. JPEG files are smaller."),
      jpeg_quality: z.number().optional().describe("1 to 100, used for jpeg only. Default 80."),
      wait_until: z.enum(["load","domcontentloaded","networkidle"]).optional().describe("When the page counts as loaded. load (default): the page and its images loaded. domcontentloaded: the HTML is parsed, faster. networkidle: no network traffic for 0.5 s, best for pages that load content late."),
      delay_ms: z.number().optional().describe("Extra wait after the page loads and before the capture, 0 to 20000. Default 0."),
      scroll_to_bottom: z.boolean().optional().describe("yes scrolls down the page before the capture so images that load on scroll appear, then returns to the top. Default no."),
      hide_selectors: z.array(z.string()).optional().describe("Elements to hide before the capture, for example a cookie banner or a chat widget: #cookie-banner, .chat-widget."),
      block_trackers: z.boolean().optional().describe("yes (default) skips analytics, ad, and session replay scripts and video or audio files, which draw nothing you need in the image and make pages slower. no loads everything, so ads appear."),
      timeout_seconds: z.number().optional().describe("Longest wait for one page to load, 10 to 120. Default 60. A page still loading at this point is captured as it stands and marked partial."),
      max_charge_usd: z.string().optional().describe("Optional. The run stops before a charge that would pass this amount. Summary rows are always returned."),
      proxy_mode: z.enum(["auto","none"]).optional().describe("auto (default): pages load through the Apify proxy pool. none: pages load straight from the Apify server. A reliability setting only; it does not change what you pay."),
    },
  },
  async (args) => runActor("nWd9M6qngY0sFiM8N", "Website Screenshot Capture", asActorInput(args as Record<string, unknown>)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
