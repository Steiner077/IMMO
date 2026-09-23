import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/** Mindestanforderungen: 10 Zeichen, Buchstaben und Ziffern. */
export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 10) return 'Das Passwort muss mindestens 10 Zeichen lang sein.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Das Passwort muss Buchstaben und Ziffern enthalten.';
  return null;
}

/** Für konstante Antwortzeiten bei unbekannten Benutzern */
let dummyHash: string | null = null;
export async function dummyVerify(plain: string) {
  dummyHash ??= await bcrypt.hash('timing-protection-dummy', ROUNDS);
  await bcrypt.compare(plain, dummyHash);
}
