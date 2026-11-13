import { HTTP_STATUS } from "../constants/http-status.js";
import * as accountService from "../services/account.service.js";
import { ok } from "../utils/api-response.js";

export async function list(req, res) {
  ok(res, HTTP_STATUS.OK, await accountService.listAccounts(req.user.id, req.validated.query));
}

export async function summary(req, res) {
  ok(res, HTTP_STATUS.OK, await accountService.getSummary(req.user.id));
}

export async function create(req, res) {
  ok(res, HTTP_STATUS.CREATED, await accountService.createAccount(req.user.id, req.validated.body));
}

export async function get(req, res) {
  const { id } = req.validated.params;
  ok(res, HTTP_STATUS.OK, await accountService.getAccount(req.user.id, id, req.validated.query));
}

export async function update(req, res) {
  const { id } = req.validated.params;
  ok(res, HTTP_STATUS.OK, await accountService.updateAccount(req.user.id, id, req.validated.body));
}

export async function archive(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await accountService.archiveAccount(req.user.id, req.validated.params.id),
  );
}

export async function unarchive(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await accountService.unarchiveAccount(req.user.id, req.validated.params.id),
  );
}

export async function makeDefault(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await accountService.setDefaultAccount(req.user.id, req.validated.params.id),
  );
}

export async function remove(req, res) {
  await accountService.deleteAccount(req.user.id, req.validated.params.id);
  res.status(HTTP_STATUS.NO_CONTENT).end();
}

export async function reorder(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await accountService.reorderAccounts(req.user.id, req.validated.body.ids),
  );
}
