import { Router, type IRouter } from "express";
import { botState } from "../../bot/state";
import { GetAnalysisResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/analysis", (_req, res): void => {
  const analysis = {
    status: botState.analysis.status,
    progress: botState.analysis.progress,
    topMarkets: botState.analysis.topMarkets,
    lastUpdated: botState.analysis.lastUpdated,
    methodsUsed: botState.analysis.methodsUsed,
  };
  res.json(GetAnalysisResponse.parse(analysis));
});

export default router;
