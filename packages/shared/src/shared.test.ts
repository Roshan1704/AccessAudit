import { describe, expect, it } from 'vitest';
import { AppError, ErrorCodes, httpStatusForCode } from './errors.js';
import { loadConfig } from './config.js';
import { roleAtLeast, Roles } from './roles.js';
import {
  addDomainSchema,
  createOrgSchema,
  createProjectSchema,
  inviteSchema,
  loginSchema,
  registerSchema,
} from './schemas.js';

describe('roles', () => {
  it('orders viewer < member < admin < owner', () => {
    for (const r of Roles) expect(roleAtLeast(r, r)).toBe(true);
    expect(roleAtLeast('viewer', 'member')).toBe(false);
    expect(roleAtLeast('member', 'viewer')).toBe(true);
    expect(roleAtLeast('admin', 'owner')).toBe(false);
    expect(roleAtLeast('owner', 'admin')).toBe(true);
  });
});

describe('errors', () => {
  it('maps every code to an HTTP status', () => {
    for (const c of ErrorCodes) expect(httpStatusForCode[c]).toBeGreaterThanOrEqual(400);
  });
  it('AppError exposes status and details', () => {
    const e = new AppError('FORBIDDEN', 'no', { a: 1 });
    expect(e.status).toBe(403);
    expect(e.details).toEqual({ a: 1 });
  });
});

describe('config', () => {
  const base = { DATABASE_URL: 'postgresql://x', SESSION_COOKIE_SECRET: 's'.repeat(32) };
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c.API_PORT).toBe(4000);
    expect(c.DOMAIN_REVALIDATE_DAYS).toBe(30);
    expect(c.WEB_ORIGIN).toBe('http://localhost:3000');
  });
  it('rejects a short session secret and missing database url', () => {
    expect(() => loadConfig({ ...base, SESSION_COOKIE_SECRET: 'short' })).toThrow(
      /Invalid configuration/,
    );
    expect(() => loadConfig({ SESSION_COOKIE_SECRET: 's'.repeat(32) })).toThrow(/DATABASE_URL/);
  });
  it('rejects out-of-range revalidation days', () => {
    expect(() => loadConfig({ ...base, DOMAIN_REVALIDATE_DAYS: '0' })).toThrow();
  });
});

describe('schemas', () => {
  it('normalises email and enforces password length', () => {
    const ok = registerSchema.parse({
      email: '  A@Example.COM ',
      password: 'x'.repeat(12),
      name: ' N ',
    });
    expect(ok.email).toBe('a@example.com');
    expect(ok.name).toBe('N');
    expect(
      registerSchema.safeParse({ email: 'a@example.com', password: 'short', name: 'n' }).success,
    ).toBe(false);
  });
  it('rejects unknown fields (no mass assignment)', () => {
    expect(
      registerSchema.safeParse({
        email: 'a@example.com',
        password: 'x'.repeat(12),
        name: 'n',
        role: 'owner',
      }).success,
    ).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@example.com', password: 'p', extra: 1 }).success).toBe(
      false,
    );
  });
  it('validates org slugs', () => {
    expect(createOrgSchema.safeParse({ name: 'Acme', slug: 'acme-co' }).success).toBe(true);
    for (const slug of ['a', '-ab', 'ab-', 'Bad Slug', 'x'.repeat(41)]) {
      expect(createOrgSchema.safeParse({ name: 'Acme', slug }).success, slug).toBe(false);
    }
  });
  it('invitations cannot grant owner', () => {
    expect(inviteSchema.safeParse({ email: 'a@example.com', role: 'owner' }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: 'a@example.com', role: 'viewer' }).success).toBe(true);
  });
  it('project and domain inputs', () => {
    expect(createProjectSchema.safeParse({ name: 'S', baseUrl: 'not a url' }).success).toBe(false);
    expect(
      createProjectSchema.safeParse({ name: 'S', baseUrl: 'https://example.com' }).success,
    ).toBe(true);
    expect(addDomainSchema.parse({ hostname: ' Example.COM ', method: 'dns_txt' }).hostname).toBe(
      'example.com',
    );
    expect(addDomainSchema.safeParse({ hostname: 'example.com', method: 'email' }).success).toBe(
      false,
    );
  });
});
