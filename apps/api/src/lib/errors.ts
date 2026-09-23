export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Eintrag') => new AppError(404, `${what} nicht gefunden`, 'NOT_FOUND');
export const forbidden = (msg = 'Keine Berechtigung für diese Aktion') => new AppError(403, msg, 'FORBIDDEN');
export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, 'BAD_REQUEST', details);
export const conflict = (msg: string) => new AppError(409, msg, 'CONFLICT');
export const unauthorized = (msg = 'Nicht angemeldet') => new AppError(401, msg, 'UNAUTHORIZED');
