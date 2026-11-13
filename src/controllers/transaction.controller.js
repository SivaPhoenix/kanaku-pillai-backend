import { CLIENT_PLATFORM_HEADER } from "../constants/auth.js";
import { CLIENT_PLATFORMS } from "../constants/enums.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as exportService from "../services/transaction-export.service.js";
import * as transactionService from "../services/transaction.service.js";
import { ApiError } from "../utils/api-error.js";
import { ok } from "../utils/api-response.js";

function clientPlatform(req) {
  const value = (req.get(CLIENT_PLATFORM_HEADER) ?? "web").toLowerCase();
  if (!CLIENT_PLATFORMS.includes(value)) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      "Request validation failed",
      [{ field: "headers.x-client-platform", message: "must be web, ios or android" }],
    );
  }
  return value;
}

export async function list(req, res) {
  const { items, page } = await transactionService.listTransactions(
    req.user.id,
    req.validated.query,
  );
  ok(res, HTTP_STATUS.OK, items, page);
}

export async function summary(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await transactionService.summarizeTransactions(req.user.id, req.validated.query),
  );
}

export async function day(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await transactionService.getDay(req.user.id, req.validated.params.localDate),
  );
}

export async function exportCsv(req, res) {
  const { csv, truncated } = await exportService.exportCsv(req.user.id, req.validated.query);
  if (truncated) res.set("X-Export-Truncated", "true");
  res
    .status(HTTP_STATUS.OK)
    .set("Content-Type", "text/csv; charset=utf-8")
    .set("Content-Disposition", 'attachment; filename="kanaku-pillai-transactions.csv"')
    .send(csv);
}

export async function create(req, res) {
  const created = await transactionService.createTransaction(
    req.user.id,
    req.validated.body,
    clientPlatform(req),
  );
  ok(res, HTTP_STATUS.CREATED, created);
}

export async function get(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await transactionService.getTransaction(req.user.id, req.validated.params.id),
  );
}

export async function update(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await transactionService.updateTransaction(
      req.user.id,
      req.validated.params.id,
      req.validated.body,
    ),
  );
}

export async function remove(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await transactionService.deleteTransaction(req.user.id, req.validated.params.id),
  );
}

export async function restore(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await transactionService.restoreTransaction(req.user.id, req.validated.params.id),
  );
}

export async function duplicate(req, res) {
  const created = await transactionService.duplicateTransaction(
    req.user.id,
    req.validated.params.id,
    req.validated.body,
    clientPlatform(req),
  );
  ok(res, HTTP_STATUS.CREATED, created);
}
