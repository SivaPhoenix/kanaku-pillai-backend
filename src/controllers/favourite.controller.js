import { HTTP_STATUS } from "../constants/http-status.js";
import * as favouriteService from "../services/favourite.service.js";
import { ok } from "../utils/api-response.js";

export async function list(req, res) {
  ok(res, HTTP_STATUS.OK, await favouriteService.listFavourites(req.user.id));
}

export async function create(req, res) {
  ok(
    res,
    HTTP_STATUS.CREATED,
    await favouriteService.createFavourite(req.user.id, req.validated.body),
  );
}

export async function update(req, res) {
  const { id } = req.validated.params;
  ok(
    res,
    HTTP_STATUS.OK,
    await favouriteService.updateFavourite(req.user.id, id, req.validated.body),
  );
}

export async function remove(req, res) {
  await favouriteService.deleteFavourite(req.user.id, req.validated.params.id);
  res.status(HTTP_STATUS.NO_CONTENT).end();
}

export async function reorder(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await favouriteService.reorderFavourites(req.user.id, req.validated.body.ids),
  );
}
