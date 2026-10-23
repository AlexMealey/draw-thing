import { beforeEach, describe, expect, it } from 'vitest';
import { activeIndex, documentStore, effectiveLayer, layerRows } from './documentStore';

const store = () => documentStore.getState();
const names = () => store().layers.map((l) => l.name);

describe('documentStore', () => {
  beforeEach(() => store().reset({ width: 100, height: 100, maxLayers: 3 }));

  it('starts on the background it is given, white by default', () => {
    expect(store().background).toEqual({ color: '#ffffff', visible: true });
    store().reset({
      width: 10,
      height: 10,
      maxLayers: 1,
      background: { color: '#f4efe4', visible: false },
    });
    expect(store().background).toEqual({ color: '#f4efe4', visible: false });
  });

  it('starts with one selected layer', () => {
    expect(names()).toEqual(['Layer 1']);
    expect(activeIndex(store())).toBe(0);
  });

  it('adds layers above the active one, up to the budget', () => {
    expect(store().addLayer()).not.toBeNull();
    store().selectLayer(store().layers[0]!.id);
    expect(store().addLayer()).not.toBeNull();
    expect(names()).toEqual(['Layer 1', 'Layer 3', 'Layer 2']);
    expect(store().layers[activeIndex(store())]!.name).toBe('Layer 3');
    expect(store().addLayer()).toBeNull();
  });

  it('never removes the last layer, and selects the layer below a removed active one', () => {
    store().removeLayer(store().activeLayerId);
    expect(names()).toEqual(['Layer 1']);
    store().addLayer();
    store().addLayer();
    store().removeLayer(store().activeLayerId);
    expect(names()).toEqual(['Layer 1', 'Layer 2']);
    expect(store().layers[activeIndex(store())]!.name).toBe('Layer 2');
  });

  it('moves layers within bounds', () => {
    store().addLayer();
    store().addLayer();
    const top = store().layers[2]!.id;
    store().moveLayer(top, -5);
    expect(names()).toEqual(['Layer 3', 'Layer 1', 'Layer 2']);
  });

  it('updates layer properties immutably', () => {
    const before = store().layers;
    store().updateLayer(before[0]!.id, { opacity: 0.5, blendMode: 'multiply' });
    expect(store().layers).not.toBe(before);
    expect(store().layers[0]).toMatchObject({ opacity: 0.5, blendMode: 'multiply' });
  });
});

describe('layer groups', () => {
  const ids = () => store().layers.map((l) => l.id);
  const groupOf = (i: number) => store().layers[i]!.groupId;
  // Five layers, bottom to top: L1..L5, with L2 and L3 grouped.
  let g = '';
  beforeEach(() => {
    store().reset({ width: 100, height: 100, maxLayers: 10 });
    for (let i = 0; i < 4; i++) store().addLayer();
    const [, l2, l3] = store().layers;
    g = store().groupLayer(l2!.id)!;
    store().moveLayer(l3!.id, 2, g);
  });

  it('groups a layer, and new layers above a grouped one join it', () => {
    expect(names()).toEqual(['Layer 1', 'Layer 2', 'Layer 3', 'Layer 4', 'Layer 5']);
    expect([0, 1, 2, 3].map(groupOf)).toEqual([null, g, g, null]);
    store().selectLayer(store().layers[2]!.id);
    store().addLayer();
    expect(groupOf(3)).toBe(g);
    expect(store().groupLayer(store().layers[1]!.id)).toBeNull(); // already grouped
  });

  it('applies group visibility, opacity and locks on top of the layer’s own', () => {
    store().updateGroup(g, { opacity: 0.5, alphaLocked: true, visible: false });
    store().updateLayer(store().layers[1]!.id, { opacity: 0.5 });
    const eff = effectiveLayer(store().layers[1]!, store().groups);
    expect(eff).toMatchObject({ opacity: 0.25, alphaLocked: true, visible: false, locked: false });
    expect(store().layers[1]!.alphaLocked).toBe(false); // the layer's own flag is untouched
    expect(effectiveLayer(store().layers[0]!, store().groups).opacity).toBe(1);
  });

  it('lists rows top first, with group children', () => {
    const rows = layerRows(store());
    expect(
      rows.map((r) => (r.kind === 'group' ? r.children.map((c) => c.name) : r.layer.name)),
    ).toEqual(['Layer 5', 'Layer 4', ['Layer 3', 'Layer 2'], 'Layer 1']);
  });

  it('joins the group a layer is dropped into, and never splits a group', () => {
    const l5 = store().layers[4]!.id;
    store().moveLayer(l5, 2, null); // between L2 and L3: must join
    expect(names()).toEqual(['Layer 1', 'Layer 2', 'Layer 5', 'Layer 3', 'Layer 4']);
    expect(groupOf(2)).toBe(g);
    // Asked to join a group that isn't next to where it lands: it stays out.
    store().moveLayer(store().layers[4]!.id, 0, g);
    expect(groupOf(0)).toBeNull();
  });

  it('takes a layer out above its group, and drops empty groups', () => {
    const l2 = store().layers[1]!.id;
    store().removeFromGroup(l2);
    expect(names()).toEqual(['Layer 1', 'Layer 3', 'Layer 2', 'Layer 4', 'Layer 5']);
    expect([1, 2].map(groupOf)).toEqual([g, null]);
    store().removeLayer(store().layers[1]!.id);
    expect(store().groups).toEqual([]);
  });

  it('moves a whole group, never into another one', () => {
    store().moveGroup(g, 3);
    expect(names()).toEqual(['Layer 1', 'Layer 4', 'Layer 5', 'Layer 2', 'Layer 3']);
    const other = store().groupLayer(store().layers[1]!.id)!;
    store().moveLayer(store().layers[2]!.id, 2, other); // L4, L5 grouped
    store().moveGroup(g, 2); // would land between L4 and L5
    expect(names()).toEqual(['Layer 1', 'Layer 4', 'Layer 5', 'Layer 2', 'Layer 3']);
    store().moveGroup(g, 0);
    expect(names()).toEqual(['Layer 2', 'Layer 3', 'Layer 1', 'Layer 4', 'Layer 5']);
  });

  it('ungroups in place, and deletes a group with its layers', () => {
    const before = ids();
    store().ungroup(g);
    expect(ids()).toEqual(before);
    expect(store().groups).toEqual([]);
    g = store().groupLayer(store().layers[1]!.id)!;
    store().selectLayer(store().layers[1]!.id);
    expect(store().removeGroup(g)).toBe(true);
    expect(names()).toEqual(['Layer 1', 'Layer 3', 'Layer 4', 'Layer 5']);
    expect(store().layers[activeIndex(store())]!.name).toBe('Layer 1');
  });

  it('won’t delete a group holding every layer', () => {
    store().reset({ width: 10, height: 10, maxLayers: 2 });
    const only = store().groupLayer(store().layers[0]!.id)!;
    expect(store().removeGroup(only)).toBe(false);
    expect(store().layers).toHaveLength(1);
  });
});
