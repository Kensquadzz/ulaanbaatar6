import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Bridges, type Bridge } from '../src/world/bridges';

const bridge: Bridge = { ids: ['x'], name: 'test', class: 'primary', width: 10, length_m: 100, clearance_m: 7,
  pts: [[0, 0, 0], [0, 50, 7], [0, 100, 0]] };

describe('bridges', () => {
  const b = new Bridges();
  b.load([bridge], []);
  it('reports the deck height on the bridge and nothing beside it', () => {
    expect(b.deckAt(0, 50)).toBeCloseTo(7);
    expect(b.deckAt(3, 25)).toBeCloseTo(3.5);
    expect(b.deckAt(8, 50)).toBeNull();
  });
  it('cars coming up the ramp stay on the deck, cars underneath stay on the ground', () => {
    expect(b.surface(0, 50, 6.9, 0)).toBeCloseTo(7);     // driving on the deck
    expect(b.surface(0, 50, 0, 0)).toBe(0);              // passing underneath
  });
  it('builds deck, parapet and pier geometry with colliders, decks flagged for cars', () => {
    const { mesh, colliders } = b.build(0, 0, () => 0);
    expect(mesh.index.length).toBeGreaterThan(0);
    expect(colliders.some((c) => c.deck)).toBe(true);
    expect(colliders.some((c) => !c.deck)).toBe(true);
  });
  it('the shipped data has the real Peace Avenue bridge with an estimated deck', () => {
    const f = new URL('../../data/tiles/bridges.json', import.meta.url);
    if (!fs.existsSync(f)) return;
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const peace = data.bridges.find((x: Bridge) => x.name === 'Энхтайваны гүүр');
    expect(peace).toBeTruthy();
    expect(peace.deck_height_src).toBe('estimated_from_length');
    expect(peace.length_m).toBeGreaterThan(300);
  });
});
