import { HTTP_STATUS } from "../constants/http-status.js";
import * as categoryService from "../services/category.service.js";
import { ok } from "../utils/api-response.js";

export async function list(req, res) {
  ok(res, HTTP_STATUS.OK, await categoryService.listCategories(req.user.id, req.validated.query));
}

export async function create(req, res) {
  ok(
    res,
    HTTP_STATUS.CREATED,
    await categoryService.createCategory(req.user.id, req.validated.body),
  );
}

export async function update(req, res) {
  const { id } = req.validated.params;
  ok(
    res,
    HTTP_STATUS.OK,
    await categoryService.updateCategory(req.user.id, id, req.validated.body),
  );
}

export async function archive(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await categoryService.archiveCategory(req.user.id, req.validated.params.id),
  );
}

export async function unarchive(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await categoryService.unarchiveCategory(req.user.id, req.validated.params.id),
  );
}

export async function remove(req, res) {
  await categoryService.deleteCategory(req.user.id, req.validated.params.id);
  res.status(HTTP_STATUS.NO_CONTENT).end();
}

export async function reorder(req, res) {
  ok(res, HTTP_STATUS.OK, await categoryService.reorderCategories(req.user.id, req.validated.body));
}
