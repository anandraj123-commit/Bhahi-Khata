import { getBootstrap } from "../services/bootstrapService.js";

export const handle_get_bootstrap = async (req, res, next) => {
  try {
    res.json(await getBootstrap(req.shopId));
  } catch (e) {
    next(e);
  }
};
