import { Router, type IRouter } from "express";
import { botState } from "../../bot/state";
import {
  GetSettingsResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/settings", (_req, res): void => {
  res.json(GetSettingsResponse.parse(botState.settings));
});

router.post("/settings", (req, res): void => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  botState.updateSettings(parsed.data);
  res.json(UpdateSettingsResponse.parse(botState.settings));
});

export default router;
