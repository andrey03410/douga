import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveActor } from "@/mcp/actor";
import { createMcpServer } from "@/mcp/create-server";

async function main() {
  const server = createMcpServer(await resolveActor(), { local: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Startup failure (e.g. actor unresolved): report on stderr and exit non-zero.
  process.stderr.write(
    `MCP server failed to start: ${(err as Error)?.message ?? err}\n`,
  );
  process.exit(1);
});
