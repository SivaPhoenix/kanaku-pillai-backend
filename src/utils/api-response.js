// Success envelope: { data } for single resources, { data, page } for cursor-paginated lists.
export function ok(res, status, data, page = undefined) {
  return res.status(status).json(page ? { data, page } : { data });
}
