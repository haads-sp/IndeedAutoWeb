import { readFileSync, readdirSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from, getClaims } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc, from, auth: { getClaims } }),
}));

import { acceptCurrentPolicies, consentStatus, outstandingPolicies } from './acceptance';
import {
  ACCEPTED_DOCUMENTS,
  CURRENT_POLICIES,
  DATA_DELETION_POLICY,
  signupAcceptanceMetadata,
} from './policies';

const TERMS = CURRENT_POLICIES.terms.version;
const PRIVACY = CURRENT_POLICIES.privacy.version;
const USER = '8a0d1e65-4a01-4f80-9350-7f7e2852511f';

/** A supabase-js query builder that resolves to `result` however it is chained. */
function query(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) builder[method] = () => builder;
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: { claims: { sub: USER } } });
});

describe('outstandingPolicies: only an exact current version counts', () => {
  it('an account with no acceptances owes both', () => {
    expect(outstandingPolicies([]).map((o) => o.document)).toEqual(['terms', 'privacy']);
  });

  it('an account that accepted both current versions owes nothing', () => {
    expect(
      outstandingPolicies([
        { document: 'terms', version: TERMS },
        { document: 'privacy', version: PRIVACY },
      ]),
    ).toEqual([]);
  });

  it('accepting an OLD version is not accepting the current one', () => {
    const owed = outstandingPolicies([
      { document: 'terms', version: 'an-older-version' },
      { document: 'privacy', version: PRIVACY },
    ]);
    expect(owed.map((o) => o.document)).toEqual(['terms']);
  });

  it('a current version accepted under the WRONG document does not count', () => {
    // Distinct versions, so a row can carry one document's current version under the other's name.
    const current = {
      terms: { ...CURRENT_POLICIES.terms, version: 'v-terms' },
      privacy: { ...CURRENT_POLICIES.privacy, version: 'v-privacy' },
    };
    const owed = outstandingPolicies(
      [
        { document: 'privacy', version: 'v-terms' },
        { document: 'terms', version: 'v-privacy' },
      ],
      current,
    );
    expect(owed.map((o) => o.document)).toEqual(['terms', 'privacy']);
  });
});

describe('the application and the database agree on documents and versions', () => {
  const migrations = readdirSync(new URL('../../../supabase/migrations', import.meta.url))
    .filter((name) => name.endsWith('_policy_acceptance.sql'));
  const sql = readFileSync(
    new URL(`../../../supabase/migrations/${migrations[0]}`, import.meta.url),
    'utf8',
  );

  it('found the migration', () => {
    expect(migrations).toHaveLength(1);
  });

  it("the documents a person accepts match the table's CHECK constraint exactly", () => {
    const constraint = sql.match(/policy_acceptances_document_known check \(document in \(([^)]*)\)\)/);
    const inSql = constraint?.[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(inSql).toEqual([...ACCEPTED_DOCUMENTS]);
  });

  it('the signup trigger reads exactly the documents the signup form sends', () => {
    const triggerDocuments = sql
      .match(/foreach v_document in array array\[([^\]]*)\]/)?.[1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''));
    expect(triggerDocuments).toEqual(Object.keys(signupAcceptanceMetadata().accepted_policies));
  });

  it.each([
    ['terms', CURRENT_POLICIES.terms.version],
    ['privacy', CURRENT_POLICIES.privacy.version],
    ['data deletion', DATA_DELETION_POLICY.version],
  ])("the %s version fits the table's version CHECK, so recording it cannot fail", (_label, version) => {
    expect(version).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
  });

  it('every current version is marked as a placeholder until a lawyer has reviewed the text', () => {
    for (const policy of [...Object.values(CURRENT_POLICIES), DATA_DELETION_POLICY]) {
      expect(policy.version).toMatch(/-placeholder$/);
    }
  });
});

describe('consentStatus', () => {
  it('reads only the signed-in account, and reports accepted when nothing is owed', async () => {
    const rows = [
      { document: 'terms', version: TERMS, accepted_at: '2026-09-15T03:00:00Z', source: 'signup' },
      { document: 'privacy', version: PRIVACY, accepted_at: '2026-09-15T03:00:00Z', source: 'signup' },
    ];
    const builder = query({ data: rows, error: null });
    const eq = vi.spyOn(builder as { eq: (column: string, value: string) => unknown }, 'eq');
    from.mockReturnValue(builder);

    expect(await consentStatus(USER)).toEqual({ status: 'accepted', acceptances: rows });
    expect(from).toHaveBeenCalledWith('policy_acceptances');
    expect(eq).toHaveBeenCalledWith('user_id', USER);
  });

  it('reports what is outstanding', async () => {
    from.mockReturnValue(query({ data: [], error: null }));
    const status = await consentStatus(USER);
    expect(status.status).toBe('outstanding');
  });

  it('a failed read is UNAVAILABLE: never accepted, and never outstanding (that would loop)', async () => {
    from.mockReturnValue(query({ data: null, error: { message: 'boom' } }));
    expect(await consentStatus(USER)).toEqual({ status: 'unavailable' });

    from.mockImplementation(() => {
      throw new Error('network');
    });
    expect(await consentStatus(USER)).toEqual({ status: 'unavailable' });
  });
});

describe('acceptCurrentPolicies', () => {
  it('does nothing at all without the confirmation', async () => {
    expect(await acceptCurrentPolicies(false)).toEqual({ outcome: 'not_confirmed' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('records exactly the current versions', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });

    expect(await acceptCurrentPolicies(true)).toEqual({ outcome: 'accepted', recorded: 2, userId: USER });
    expect(rpc).toHaveBeenCalledWith('accept_policies', {
      p_terms_version: TERMS,
      p_privacy_version: PRIVACY,
    });
  });

  it("a database refusal (insufficient_privilege) is not_permitted, not a crash", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'session is not active' } });
    expect(await acceptCurrentPolicies(true)).toEqual({ outcome: 'not_permitted' });
  });

  it('any other failure is unavailable', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection failure' } });
    expect(await acceptCurrentPolicies(true)).toEqual({ outcome: 'unavailable' });

    rpc.mockRejectedValue(new Error('fetch failed'));
    expect(await acceptCurrentPolicies(true)).toEqual({ outcome: 'unavailable' });
  });
});
