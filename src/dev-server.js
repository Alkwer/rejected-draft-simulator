#!/usr/bin/env node
import { createWebServer } from "./web-server.js";
import { formatDevServerUrl, maybeOpenBrowser, parseDevServerArgs } from "./dev-server-runtime.js";

const host = process.env.HOST ?? "127.0.0.1";
const startPort = Number(process.env.PORT ?? 5173);
const options = parseDevServerArgs(process.argv.slice(2));

listen(startPort);

function listen(port) {
  const server = createWebServer();
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < startPort + 20) {
      listen(port + 1);
      return;
    }
    console.error(error);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const url = formatDevServerUrl({ host, port });
    console.log(`Rejected Draft Simulator UI: ${url}`);
    maybeOpenBrowser(url, options).catch((error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });
  });
}
