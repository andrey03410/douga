import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/mcp/create-server";
import { resolveApiToken } from "@/server/api-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "UNAUTHENTICATED" }, id: null },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="douga"' } },
  );

/**
 * MCP over Streamable HTTP, stateless: every request carries `Authorization: Bearer dga_…`,
 * resolves its account again and gets a fresh server. No Origin check: the caller is an
 * agent with a token, not a browser with a cookie. Local-disk tools are not registered.
 */
async function handle(req: Request): Promise<Response> {
  const header = req.headers.get("authorization") ?? "";
  const actor = await resolveApiToken(header.startsWith("Bearer ") ? header.slice(7).trim() : null);
  if (!actor) return unauthorized();
  const server = createMcpServer(actor, { local: false });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
