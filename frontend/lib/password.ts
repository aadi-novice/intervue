export interface PasswordRule {
  id: "length" | "letter" | "digit";
  label: string;
  met: boolean;
}

export const MIN_PASSWORD_LENGTH = 10;

/** Mirrors the backend rule: >= 10 chars containing letters and digits. */
export function passwordRules(password: string): PasswordRule[] {
  return [
    { id: "length", label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: password.length >= MIN_PASSWORD_LENGTH },
    { id: "letter", label: "Contains a letter", met: /[A-Za-z]/.test(password) },
    { id: "digit", label: "Contains a digit", met: /\d/.test(password) },
  ];
}

export function isPasswordValid(password: string): boolean {
  return passwordRules(password).every((r) => r.met);
}
