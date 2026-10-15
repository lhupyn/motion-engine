import { describe, it, expect, vi, afterEach } from 'vitest';
import { Face, auViolations } from '../src/face.js';
import FACS from '../src/facs.json' with { type: 'json' };

// Per-avatar calibration: au_limits and avoid in facs.json are enforced here, not clamped at runtime.
describe('facs.json calibration', () => {
  it('every bundled expression stays within au_limits and avoid', () => {
    expect(auViolations(FACS)).toEqual([]);
  });
});

describe('auViolations', () => {
  const catalog = (extra, expressions) => ({
    au_map: { AU7: { eyeSquintLeft: 1 }, AU12: { mouthSmileLeft: 1 }, AU25: { mouthLowerDownLeft: 1 } },
    expressions,
    ...extra,
  });

  it('passes without limits', () => {
    expect(auViolations(catalog({}, { grin: { aus: { AU7: 1, AU12: 1 } } }))).toEqual([]);
  });

  it('holds moods to max and beats to beatMax', () => {
    const limits = { au_limits: { AU25: { max: 0.4, beatMax: 0.8, note: 'teeth show' } } };
    expect(
      auViolations(
        catalog(limits, {
          calm: { aus: { AU25: 0.4 } },
          laugh: { kind: 'beat', aus: { AU25: 0.7 } },
        }),
      ),
    ).toEqual([]);
    expect(
      auViolations(
        catalog(limits, {
          gape: { aus: { AU25: 0.5 } },
          roar: { kind: 'beat', aus: { AU25: 0.9 } },
        }),
      ),
    ).toEqual(['gape: AU25 0.5 is above 0.4 — teeth show', 'roar: AU25 0.9 is above 0.8 for a beat — teeth show']);
  });

  it('beatMax defaults to max', () => {
    expect(
      auViolations(catalog({ au_limits: { AU7: { max: 0.1 } } }, { blink: { kind: 'beat', aus: { AU7: 0.2 } } })),
    ).toEqual(['blink: AU7 0.2 is above 0.1 for a beat']);
  });

  it('counts a one-sided AU on its side, added to the both-sides one', () => {
    const limits = { au_limits: { AU12: { max: 0.6 } } };
    expect(auViolations(catalog(limits, { smirk: { aus: { AU12_L: 0.6 } } }))).toEqual([]);
    expect(auViolations(catalog(limits, { lopsided: { aus: { AU12: 0.4, AU12_L: 0.3 } } }))).toEqual([
      'lopsided: AU12 0.7 is above 0.6',
    ]);
    expect(
      auViolations(catalog({ au_limits: { AU12: { max: 0.3 } } }, { sum: { aus: { AU12: 0.1, AU12_L: 0.2 } } })),
    ).toEqual([]);
  });

  it('flags a combination only when every AU in it is above its level', () => {
    const avoid = { avoid: [{ aus: { AU7: 0.1, AU12: 0.5 }, note: 'a forced, suspicious smile' }] };
    expect(
      auViolations(
        catalog(avoid, {
          warm: { aus: { AU7: 0.1, AU12: 0.9 } },
          squint: { aus: { AU7: 0.6, AU12: 0.3 } },
        }),
      ),
    ).toEqual([]);
    expect(auViolations(catalog(avoid, { smug: { aus: { AU7: 0.3, AU12: 0.6 } } }))).toEqual([
      'smug: AU7 + AU12 together — a forced, suspicious smile',
    ]);
  });

  it('rejects AUs that au_map does not know, and malformed rules', () => {
    expect(
      auViolations(
        catalog(
          {
            au_limits: { AU99: { max: 0.5 }, AU7: {} },
            avoid: [{ aus: { AU12: 0.5, AU98: 0.1 } }, { aus: { AU7: 0.1 } }],
          },
          {},
        ),
      ),
    ).toEqual([
      'au_limits: unknown AU "AU99"',
      'au_limits: AU7 needs a numeric max',
      'avoid: unknown AU "AU98"',
      'avoid: a rule needs at least two AUs (AU7)',
    ]);
  });
});

describe('Face', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns about a catalog that breaks its own limits, and still plays it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const facs = {
      au_map: { AU12: { mouthSmileLeft: 1 } },
      au_limits: { AU12: { max: 0.5 } },
      expressions: { grin: { aus: { AU12: 0.9 } } },
    };
    const face = new Face({ restBaseline: () => 0, setExpressionMorph: vi.fn(), releaseMorph: vi.fn() }, { facs });
    expect(warn).toHaveBeenCalledWith('[motion-engine] grin: AU12 0.9 is above 0.5');
    expect(face.play('grin')).toBe(true);
    face.update(400);
    expect(face.adapter.setExpressionMorph).toHaveBeenCalledWith('mouthSmileLeft', 0.9);
  });
});
