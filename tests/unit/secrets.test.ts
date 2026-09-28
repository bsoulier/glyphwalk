import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Shapes of credentials that must never be committed: GitHub, AWS, Google, Slack, OpenAI-style keys, PEM keys. */
const SECRET = new RegExp([
  'gh[pousr]_[A-Za-z0-9]{30,}',
  'github_pat_[A-Za-z0-9_]{30,}',
  'AKIA[0-9A-Z]{16}',
  'AIza[0-9A-Za-z_-]{35}',
  'xox[abprs]-[A-Za-z0-9-]{10,}',
  '\\bsk-[A-Za-z0-9]{32,}',
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  'x-access-token:[^@\\s]{8,}@',
].join('|'));

const tracked: string[] = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

describe('no secrets in the repository', () => {
  it('commits no files that usually hold secrets', () => {
    const risky = tracked.filter((f) => /(^|\/)(\.env(\..+)?|\.dev\.vars(\..+)?)$|\.(pem|key)$/.test(f) && f !== '.env.production');
    expect(risky).toEqual([]);
  });

  it('has no credentials in any tracked file', () => {
    const hits = tracked.filter((f) => {
      if (/\.(png|jpe?g|gif|ico|webp)$/.test(f)) return false;
      return SECRET.test(readFileSync(f, 'utf8'));
    });
    expect(hits).toEqual([]);
  });

  it('keeps only public settings in .env.production', () => {
    const lines = readFileSync('.env.production', 'utf8').split('\n').filter((l: string) => l.trim() && !l.trim().startsWith('#'));
    const allowed: Record<string, RegExp> = {
      VITE_ONLINE_URL: /^(wss:\/\/[a-z0-9.-]+(\/[a-z0-9._/-]*)?)?$/,
      VITE_GOATCOUNTER: /^[a-z0-9-]*$/,
    };
    for (const line of lines) {
      const [key, ...rest] = line.split('=');
      expect(Object.keys(allowed)).toContain(key.trim());
      expect(rest.join('=').trim()).toMatch(allowed[key.trim()]);
    }
  });
});
