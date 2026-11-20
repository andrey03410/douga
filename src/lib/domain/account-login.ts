/** Preserve email accounts and give provisioned usernames an internal email key. */
export function provisionedAccountEmail(login: string): string {
  const normalized = login.trim().toLowerCase();
  return /^[a-z0-9_-]{3,40}$/.test(normalized) ? `${normalized}@accounts.invalid` : login.trim();
}
