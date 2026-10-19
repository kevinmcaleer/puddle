// Export › Image on the Schema view: the view on show (or the selected tables) as SVG, PNG or PDF, in the light or dark
// theme, drawn from the diagram on screen; or a PNG copied to the clipboard.
import { useEffect, useState } from 'react';
import { saveBlob } from '../export/deliver';
import { Dialog, Field, Select, Switch, Button } from '../ui';
import { canvasBlob, exportBounds, jpegPdf, pictureOf, svgToCanvas } from './diagram/exportImage';
import type { Diagram } from './diagram/geometry';

type Format = 'svg' | 'png' | 'pdf';

const FORMATS: { value: Format; label: string }[] = [
  { value: 'svg', label: 'SVG (vector)' },
  { value: 'png', label: 'PNG' },
  { value: 'pdf', label: 'PDF' },
];

/** What was picked last, while the app is open. */
let last = { format: 'svg' as Format, scale: 2, theme: 'light' as 'light' | 'dark', transparent: false };

export function ExportImageDialog({ diagram, selected, fileName, onClose }: { diagram: Diagram; selected: string[]; fileName: string; onClose: () => void }) {
  const [format, setFormat] = useState(last.format);
  const [scale, setScale] = useState(last.scale);
  const [theme, setTheme] = useState(last.theme);
  const [transparent, setTransparent] = useState(last.transparent);
  const [message, setMessage] = useState<string | null>(null);
  const bounds = exportBounds(diagram, selected);
  const shown = selected.filter((id) => diagram.tables.some((t) => t.id === id)).length;
  useEffect(() => {
    last = { format, scale, theme, transparent };
  }, [format, scale, theme, transparent]);

  const picture = () => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid="schema-diagram"]');
    if (!svg) throw new Error('The diagram isn’t on screen.');
    return pictureOf(svg, bounds, { theme, transparent: format === 'png' && transparent });
  };
  const png = async () => {
    const p = picture();
    return canvasBlob(await svgToCanvas(p.svg, bounds, scale), 'image/png');
  };
  const run = (job: () => Promise<void>) => void job().catch((e: Error) => setMessage(e.message));

  return (
    <Dialog
      title="Export as image"
      confirm={`Download ${fileName}.${format}`}
      onClose={onClose}
      onConfirm={() =>
        run(async () => {
          if (format === 'svg') saveBlob(new Blob([picture().svg], { type: 'image/svg+xml' }), `${fileName}.svg`);
          else if (format === 'png') saveBlob(await png(), `${fileName}.png`);
          else {
            const p = picture();
            const canvas = await svgToCanvas(p.svg, bounds, scale, p.background);
            const jpeg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer());
            saveBlob(new Blob([jpegPdf(jpeg, { w: canvas.width, h: canvas.height }, bounds)], { type: 'application/pdf' }), `${fileName}.pdf`);
          }
          onClose();
        })
      }
    >
      <p className="text-label text-ink-muted">{shown ? `The ${shown} selected ${shown === 1 ? 'table' : 'tables'}, as drawn.` : 'The diagram as drawn in this view, at its detail level.'}</p>
      <Field label="Format" htmlFor="export-image-format">
        <Select id="export-image-format" data-autofocus options={FORMATS} value={format} onChange={(e) => setFormat(e.target.value as Format)} />
      </Field>
      <Field label="Theme" htmlFor="export-image-theme">
        <Select id="export-image-theme" options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark')} />
      </Field>
      {format !== 'svg' && (
        <Field label="Size" htmlFor="export-image-scale">
          <Select id="export-image-scale" options={[1, 2, 4].map((k) => ({ value: String(k), label: `${k}x (${Math.ceil(bounds.w * k)} × ${Math.ceil(bounds.h * k)})` }))} value={String(scale)} onChange={(e) => setScale(Number(e.target.value))} />
        </Field>
      )}
      {format === 'png' && <Switch label="Transparent background" checked={transparent} onChange={setTransparent} />}
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon="paste"
          onClick={() =>
            run(async () => {
              if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('This browser won’t let Puddle put an image on the clipboard. Download it instead.');
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': png() })]);
              setMessage('Copied the picture as a PNG.');
            })
          }
        >
          Copy image
        </Button>
      </div>
      {message && (
        <p className="text-label text-ink-muted" role="status">
          {message}
        </p>
      )}
    </Dialog>
  );
}
