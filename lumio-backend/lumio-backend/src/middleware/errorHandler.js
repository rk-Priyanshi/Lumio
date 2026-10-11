const DB_DOWN = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR',
]);

export function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found.` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  console.error(err);

  if (err.type === 'entity.parse.failed')
    return res.status(400).json({ success: false, message: 'Invalid JSON in request body.' });
  if (err.type === 'entity.too.large')
    return res.status(413).json({ success: false, message: 'Request body is too large.' });

  if (err.code === 'ER_DUP_ENTRY')
    return res.status(409).json({ success: false, message: 'This record already exists.' });
  if (['ER_CHECK_CONSTRAINT_VIOLATED', 'ER_DATA_TOO_LONG', 'ER_TRUNCATED_WRONG_VALUE'].includes(err.code))
    return res.status(400).json({ success: false, message: 'A value was rejected by the database.' });

  if (DB_DOWN.has(err.code) || err.fatal)
    return res.status(503).json({ success: false, message: 'Database is unavailable. Please try again shortly.' });

  // Never leak SQL or stack details to the client.
  res.status(500).json({ success: false, message: 'Internal server error. Please try again.' });
}
