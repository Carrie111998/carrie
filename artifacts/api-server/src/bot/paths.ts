import path from "path";

export const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

export const DATA_DIR = path.resolve(process.env["BOT_DATA_DIR"] ?? path.join(workspaceRoot, "data"));
