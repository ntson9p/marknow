import { useId, type ReactNode } from 'react';

import { useUiStore } from '@/app/store/ui';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/features/settings/store';

/**
 * Settings (FR-13).
 *
 * Deliberately one scrolling column of titled sections rather than a
 * category rail: a rail earns its complexity at VS Code's scale, not at a
 * handful of preferences, and it is the layout that fights a narrow screen
 * hardest (§8.2). Growth is adding a `<Section>` or a `<SettingRow>` — no
 * restructuring, and no navigation state to hold.
 */
export function SettingsPanel() {
  const open = useUiStore((s) => s.activePanel === 'settings');
  return open ? <SettingsDialog /> : null;
}

function SettingsDialog() {
  const close = () => useUiStore.getState().setActivePanel(null);
  const diagramScroll = useSettingsStore((s) => s.diagramScroll);
  const setDiagramScroll = useSettingsStore((s) => s.setDiagramScroll);
  const tableAlign = useSettingsStore((s) => s.markdownStyle.tableAlign);
  const setMarkdownStyle = useSettingsStore((s) => s.setMarkdownStyle);
  const bubbleMenu = useSettingsStore((s) => s.bubbleMenu);
  const setBubbleMenu = useSettingsStore((s) => s.setBubbleMenu);

  return (
    <Modal
      open
      onClose={close}
      title="Settings"
      description="Saved on this device."
      size="lg"
      footer={
        <Button size="sm" variant="ghost" onClick={close}>
          Close
        </Button>
      }
    >
      <div className="space-y-6" data-testid="settings-panel">
        <Section title="Editor">
          <SettingRow
            label="Show quick actions on selection"
            hint="Selecting text pops a small toolbar over it — bold, italic, strikethrough, code, link, and turn-into. Off, the selection stays unobscured and those actions remain on the main toolbar and their shortcuts; on, they come to the text, which is the quicker reach on a touch screen."
          >
            {(labelId) => (
              <Switch
                checked={bubbleMenu}
                onCheckedChange={setBubbleMenu}
                aria-labelledby={labelId}
                data-testid="setting-bubble-menu"
              />
            )}
          </SettingRow>
        </Section>
        <Section title="Markdown style">
          <SettingRow
            label="Align table columns"
            hint="Pad table cells so the pipes line up in the markdown source. Off, tables keep their compact form and rich-text edits leave untouched table rows exactly as you wrote them; on, every table is re-padded whenever the document is normalized."
          >
            {(labelId) => (
              <Switch
                checked={tableAlign}
                onCheckedChange={(on) => setMarkdownStyle({ tableAlign: on })}
                aria-labelledby={labelId}
                data-testid="setting-table-align"
              />
            )}
          </SettingRow>
        </Section>
        <Section title="Diagrams">
          <SettingRow
            label="Scroll wide diagrams"
            hint="Too wide for the page, a diagram shrinks to fit — sometimes past the point of being readable. Turn this on to stop it at 60% and scroll it sideways instead. The preview column always shrinks to fit."
          >
            {(labelId) => (
              <Switch
                checked={diagramScroll}
                onCheckedChange={setDiagramScroll}
                aria-labelledby={labelId}
                data-testid="setting-diagram-scroll"
              />
            )}
          </SettingRow>
        </Section>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="divide-y divide-border rounded-md border border-border">{children}</div>
    </section>
  );
}

/**
 * One preference: name and explanation on the left, its control on the right.
 * The control is a render prop so it can be labelled by the row's own heading
 * — a switch has no text of its own to name it.
 */
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: (labelId: string) => ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="flex items-start justify-between gap-6 px-3 py-3">
      <div className="min-w-0">
        <div id={labelId} className="text-sm font-medium">
          {label}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children(labelId)}</div>
    </div>
  );
}
