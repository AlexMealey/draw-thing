import { useDocument } from '../../state/documentStore';
import { toolStore, useTools } from '../../state/toolStore';
import { Panel } from '../ui/Panel';
import ui from '../ui/ui.module.css';

interface Props {
  onClose: () => void;
  onNewCanvas: () => void;
}

const GESTURES: [string, string][] = [
  ['Two-finger tap', 'Undo'],
  ['Three-finger tap', 'Redo'],
  ['Four-finger tap', 'Hide or show the interface'],
  ['Pinch, twist, drag', 'Zoom, rotate, move the canvas'],
  ['Quick pinch in', 'Fit canvas to screen'],
  ['Touch and hold', 'Eyedropper'],
  ['Pen barrel button', 'Eyedropper'],
  ['Space + drag', 'Move the canvas (keyboard)'],
  ['B / E / L / C', 'Brush, eraser, layers, color'],
  ['[ and ]', 'Smaller / bigger brush'],
];

export function ActionsPanel({ onClose, onNewCanvas }: Props) {
  const width = useDocument((s) => s.width);
  const height = useDocument((s) => s.height);
  const layers = useDocument((s) => s.layers.length);
  const maxLayers = useDocument((s) => s.maxLayers);
  const sidebarRight = useTools((s) => s.sidebarRight);
  const fingerDrawing = useTools((s) => s.fingerDrawing);
  const { setPrefs } = toolStore.getState();

  return (
    <Panel title="Actions" side="left" onClose={onClose}>
      <h3 className={ui.section}>Canvas</h3>
      <p style={{ margin: 0, fontSize: 14 }}>
        {width} × {height} px · {layers} of {maxLayers} layers
      </p>
      <p>
        <button className={ui.textButton} onClick={onNewCanvas}>
          New canvas…
        </button>
      </p>

      <h3 className={ui.section}>Preferences</h3>
      <label className={ui.switch}>
        Sidebar on the right
        <input
          type="checkbox"
          checked={sidebarRight}
          onChange={(e) => setPrefs({ sidebarRight: e.target.checked })}
        />
      </label>
      <label className={ui.switch}>
        Paint with a finger (until a pen is used)
        <input
          type="checkbox"
          checked={fingerDrawing}
          onChange={(e) => setPrefs({ fingerDrawing: e.target.checked })}
        />
      </label>

      <h3 className={ui.section}>Gestures & shortcuts</h3>
      <dl
        style={{
          margin: 0,
          fontSize: 13,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '6px 12px',
        }}
      >
        {GESTURES.map(([g, what]) => (
          <div key={g} style={{ display: 'contents' }}>
            <dt style={{ color: 'var(--color-text-muted)' }}>{g}</dt>
            <dd style={{ margin: 0 }}>{what}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
