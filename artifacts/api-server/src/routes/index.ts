import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import tradesRouter from "./trades";
import marketsRouter from "./markets";
import analysisRouter from "./analysis";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(tradesRouter);
router.use(marketsRouter);
router.use(analysisRouter);
router.use(settingsRouter);

export default router;
