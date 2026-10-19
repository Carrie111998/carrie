import express, { type Express } from "express";
import { existsSync } from "fs";
import path from "path";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { workspaceRoot } from "./bot/engine";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// When the dashboard has been built, serve it too so one process runs the whole app.
const staticDir = path.resolve(process.env["STATIC_DIR"] ?? path.join(workspaceRoot, "artifacts/trading-bot/dist/public"));
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
}

export default app;
