import { spawn } from "node:child_process";

export function parseDevServerArgs(args = []) {
  return {
    open: args.includes("--open") || args.includes("-o"),
  };
}

export function formatDevServerUrl({ host, port }) {
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return `http://${displayHost}:${port}`;
}

export async function maybeOpenBrowser(url, { open = false, opener = openUrl } = {}) {
  if (!open) {
    return false;
  }
  await opener(url);
  return true;
}

export function openUrl(url) {
  const { command, args } = getOpenCommand(url);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function getOpenCommand(url) {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/c", "start", "", url] };
  }
  if (process.platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}
