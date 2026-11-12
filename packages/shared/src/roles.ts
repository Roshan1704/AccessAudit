export const Roles = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof Roles)[number];

const rank: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function roleAtLeast(actual: Role, required: Role): boolean {
  return rank[actual] >= rank[required];
}

export const VerificationMethods = ['dns_txt', 'well_known', 'meta_tag'] as const;
export type VerificationMethod = (typeof VerificationMethods)[number];

export const DomainStatuses = ['pending', 'verified', 'failed', 'expired', 'revoked'] as const;
export type DomainStatus = (typeof DomainStatuses)[number];
