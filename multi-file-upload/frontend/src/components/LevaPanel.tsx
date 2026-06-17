import { useState, useRef, useEffect, useCallback } from 'react';
import type { ITL3DMode, FaceNCutsView } from './ITL3D_types';
import './LevaPanel.css';

// ── Types ──
export interface LevaConfig {
  // Scene
  autoRotate: boolean;
  contactShadow: boolean;
  lightIntensity: number;
  preset: string;
  shadows: boolean;
  background: string;

  // View
  orientation: number;
  canRotate: boolean;
  canDrag: boolean;

  // Cutting
  cutMode: ITL3DMode;
  cutDepth: number;
  cutAngle: number;
  cutN: number;
  cutR: number;
  showCuttingSurface: boolean;
  cutFaceMaskColor: string;
  cutBodyMaskColor: string;
  showCutBodyWireframe: boolean;
  faceNCutsView: FaceNCutsView;

  // Opacity
  modelOpacityForFaceOrBoth: number;
  overlayOpacityForBodyOrBoth: number;
  cutBodyDepthOpacity: number;
  cutBodyNCutsOpacity: number;
}

export const DEFAULT_CONFIG: LevaConfig = {
  autoRotate: false,
  contactShadow: true,
  lightIntensity: 1.0,
  preset: 'rembrandt',
  shadows: true,
  background: '#f0f0f0',

  orientation: 4,
  canRotate: true,
  canDrag: true,

  cutMode: 'cutFace',
  cutDepth: 0,
  cutAngle: 0,
  cutN: 0,
  cutR: 96,
  showCuttingSurface: true,
  cutFaceMaskColor: '#ff6b6b',
  cutBodyMaskColor: '#4472c4',
  showCutBodyWireframe: false,
  faceNCutsView: 'FaceAndBody',

  modelOpacityForFaceOrBoth: 0.45,
  overlayOpacityForBodyOrBoth: 0.82,
  cutBodyDepthOpacity: 0.5,
  cutBodyNCutsOpacity: 0.72,
};

export interface LevaPanelProps {
  config: LevaConfig;
  onChange: (patch: Partial<LevaConfig>) => void;
  onScreenshot?: () => void;
  onDownload?: () => void;
  onExportConfig?: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

// ── Dropdown state for portal rendering ──
interface DropdownState {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  top: number;
  left: number;
  width: number;
}

// ── Sub-components ──

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="lv-row">
      <div className="lv-label-wrap">
        <label className="lv-label">{label}</label>
      </div>
      <div className="lv-toggle-wrap">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <label onClick={() => onChange(!checked)}>
          <svg fill="none" viewBox="0 0 24 24" width="14" height="14">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" stroke="currentColor" />
          </svg>
        </label>
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, min = 0, max = 5, step = 0.1, digits }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; digits?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const fmt = digits !== undefined ? value.toFixed(digits) : value.toFixed(1);

  const startEdit = () => {
    setEditText(String(value));
    setEditing(true);
    // defer focus so React commits the input first
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    const parsed = parseFloat(editText);
    if (!isNaN(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      onChange(clamped);
    }
    setEditing(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditing(false);
  };

  const displayValue = editing ? editText : fmt;
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="lv-row">
      <div className="lv-label-wrap">
        <label className="lv-label">{label}</label>
      </div>
      <div className="lv-slider-wrap">
        <div className="lv-slider-track">
          <div className="lv-slider-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
          <div className="lv-slider-thumb" style={{ left: `calc(${Math.min(100, Math.max(0, pct))}% - 4px)` }} />
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="lv-slider-input"
          />
        </div>
        <div className="lv-value-input">
          <input
            ref={inputRef}
            type="text"
            value={displayValue}
            onFocus={startEdit}
            onBlur={commitEdit}
            onKeyDown={handleKey}
            onChange={(e) => setEditText(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

function Select({ label, value, options, onChange, onOpenDropdown }: {
  label: string; value: string; options: { label: string; value: string }[]; onChange: (v: string) => void;
  onOpenDropdown: (state: DropdownState | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  const toggle = () => {
    if (open) {
      setOpen(false);
      onOpenDropdown(null);
    } else {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) {
        // Get panel offset — the panel is the nearest positioned ancestor
        // We walk up to find .lv-panel, then subtract its rect
        const panel = wrapRef.current?.closest('.lv-panel') as HTMLElement | null;
        const panelRect = panel?.getBoundingClientRect();
        const top = panelRect ? rect.bottom - panelRect.top + 2 : rect.bottom + 2;
        const left = panelRect ? rect.left - panelRect.left : rect.left;
        onOpenDropdown({
          options,
          value,
          onChange: (v) => { onChange(v); setOpen(false); onOpenDropdown(null); },
          top,
          left,
          width: rect.width,
        });
        setOpen(true);
      }
    }
  };

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        onOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onOpenDropdown]);

  return (
    <div className="lv-row">
      <div className="lv-label-wrap">
        <label className="lv-label">{label}</label>
      </div>
      <div className="lv-select-wrap" ref={wrapRef} onClick={toggle}>
        <div className="lv-select-display">{selected?.label ?? value}</div>
        <svg width="9" height="5" viewBox="0 0 9 5" className="lv-select-arrow" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <path d="M3.8 4.4c.4.3 1 .3 1.4 0L8 1.7A1 1 0 007.4 0H1.6a1 1 0 00-.7 1.7l3 2.7z" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}

function ColorInput({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="lv-row">
      <div className="lv-label-wrap">
        <label className="lv-label">{label}</label>
      </div>
      <div className="lv-color-wrap">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="lv-color-text" />
      </div>
    </div>
  );
}

function Folder({ label, isOpen, onToggle, children }: { label: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="lv-folder">
      <div className="lv-folder-header" onClick={onToggle}>
        <svg width="9" height="5" viewBox="0 0 9 5" style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 200ms' }}>
          <path d="M3.8 4.4c.4.3 1 .3 1.4 0L8 1.7A1 1 0 007.4 0H1.6a1 1 0 00-.7 1.7l3 2.7z" fill="currentColor" />
        </svg>
        <span>{label}</span>
      </div>
      <div className={`lv-folder-body ${isOpen ? 'open' : ''}`}>
        {children}
      </div>
    </div>
  );
}

// ── Main LevaPanel ──
export default function LevaPanel({ config, onChange, onScreenshot, onDownload, onExportConfig, isOpen, onToggle }: LevaPanelProps) {
  const [openFolder, setOpenFolder] = useState<string | null>('scene');
  const [dropdown, setDropdown] = useState<DropdownState | null>(null);

  const toggleFolder = (name: string) => {
    setOpenFolder((prev) => (prev === name ? null : name));
  };

  const handleOpenDropdown = useCallback((state: DropdownState | null) => {
    setDropdown(state);
  }, []);

  return (
    <>
      {/* Floating toggle button */}
      <button
        className={`lv-float-btn ${isOpen ? 'open' : ''}`}
        onClick={onToggle}
        title={isOpen ? 'Collapse panel' : 'Expand panel'}
      >
        <svg width="20" height="10" viewBox="0 0 28 14" fill="currentColor">
          <circle cx="2" cy="2" r="2" /><circle cx="14" cy="2" r="2" /><circle cx="26" cy="2" r="2" />
          <circle cx="2" cy="12" r="2" /><circle cx="14" cy="12" r="2" /><circle cx="26" cy="12" r="2" />
        </svg>
      </button>

      {/* Panel */}
      <div className={`lv-panel ${isOpen ? 'open' : ''}`}>
        {/* Handle bar */}
        <div className="lv-handle-bar">
          <div className="lv-hb-left" onClick={onToggle} title="Collapse panel">
            <svg width="20" height="10" viewBox="0 0 28 14" fill="currentColor">
              <circle cx="2" cy="2" r="2" /><circle cx="14" cy="2" r="2" /><circle cx="26" cy="2" r="2" />
              <circle cx="2" cy="12" r="2" /><circle cx="14" cy="12" r="2" /><circle cx="26" cy="12" r="2" />
            </svg>
          </div>
        </div>

        {/* Filter input */}
        <div className="lv-filter">
          <input readOnly />
        </div>

        {/* Body */}
        <div className="lv-body">

          {/* ── Scene ── */}
          <Folder label="scene" isOpen={openFolder === 'scene'} onToggle={() => toggleFolder('scene')}>
            <Toggle label="shadows" checked={config.shadows} onChange={(v) => onChange({ shadows: v })} />
            <Toggle label="contactShadow" checked={config.contactShadow} onChange={(v) => onChange({ contactShadow: v })} />
            <Slider
              label="light intensity"
              value={config.lightIntensity}
              onChange={(v) => onChange({ lightIntensity: v })}
              min={0.1} max={5} step={0.1}
            />
            <Select
              label="preset"
              value={config.preset}
              options={[
                { label: 'rembrandt', value: 'rembrandt' },
                { label: 'portrait', value: 'portrait' },
                { label: 'upfront', value: 'upfront' },
                { label: 'soft', value: 'soft' },
              ]}
              onChange={(v) => onChange({ preset: v })}
              onOpenDropdown={handleOpenDropdown}
            />
            <ColorInput label="background" value={config.background} onChange={(v) => onChange({ background: v })} />
          </Folder>

          {/* ── View ── */}
          <Folder label="view" isOpen={openFolder === 'view'} onToggle={() => toggleFolder('view')}>
            <Slider
              label="orientation"
              value={config.orientation}
              onChange={(v) => onChange({ orientation: v })}
              min={1} max={12} step={1} digits={0}
            />
            <Toggle label="autoRotate" checked={config.autoRotate} onChange={(v) => onChange({ autoRotate: v })} />
            <Toggle label="canRotate" checked={config.canRotate} onChange={(v) => onChange({ canRotate: v })} />
            <Toggle label="canDrag" checked={config.canDrag} onChange={(v) => onChange({ canDrag: v })} />
          </Folder>

          {/* ── Cutting ── */}
          <Folder label="cutting(Load...)" isOpen={openFolder === 'cutting'} onToggle={() => toggleFolder('cutting')}>
            <div />
            <Select
              label="mode"
              value={config.cutMode}
              options={[
                { label: 'cutFace', value: 'cutFace' },
                { label: 'cutBody', value: 'cutBody' },
              ]}
              onChange={(v) => onChange({ cutMode: v as ITL3DMode })}
              onOpenDropdown={handleOpenDropdown}
            />
            <Slider
              label="cutDepth"
              value={config.cutDepth}
              onChange={(v) => onChange({ cutDepth: v })}
              min={0} max={100} step={1} digits={0}
            />
            <Slider
              label="cutAngle"
              value={config.cutAngle}
              onChange={(v) => onChange({ cutAngle: v })}
              min={0} max={360} step={1} digits={0}
            />
            <Slider
              label="cutN"
              value={config.cutN}
              onChange={(v) => onChange({ cutN: v })}
              min={0} max={20} step={1} digits={0}
            />
            <Slider
              label="cutR"
              value={config.cutR}
              onChange={(v) => onChange({ cutR: v })}
              min={48} max={256} step={16} digits={0}
            />
            <Toggle label="showCuttingSurface" checked={config.showCuttingSurface} onChange={(v) => onChange({ showCuttingSurface: v })} />
            <ColorInput label="cutFaceMaskColor" value={config.cutFaceMaskColor} onChange={(v) => onChange({ cutFaceMaskColor: v })} />
            <ColorInput label="cutBodyMaskColor" value={config.cutBodyMaskColor} onChange={(v) => onChange({ cutBodyMaskColor: v })} />
            <Toggle label="showCutBodyWireframe" checked={config.showCutBodyWireframe} onChange={(v) => onChange({ showCutBodyWireframe: v })} />
            <Select
              label="faceNCutsView"
              value={config.faceNCutsView}
              options={[
                { label: 'Face', value: 'Face' },
                { label: 'Body', value: 'Body' },
                { label: 'FaceAndBody', value: 'FaceAndBody' },
              ]}
              onChange={(v) => onChange({ faceNCutsView: v as FaceNCutsView })}
              onOpenDropdown={handleOpenDropdown}
            />
          </Folder>

          {/* ── Opacity ── */}
          <Folder label="opacity" isOpen={openFolder === 'opacity'} onToggle={() => toggleFolder('opacity')}>
            <Slider
              label="modelOpacityForFaceOrBoth"
              value={config.modelOpacityForFaceOrBoth}
              onChange={(v) => onChange({ modelOpacityForFaceOrBoth: v })}
              min={0.05} max={1} step={0.01} digits={2}
            />
            <Slider
              label="overlayOpacityForBodyOrBoth"
              value={config.overlayOpacityForBodyOrBoth}
              onChange={(v) => onChange({ overlayOpacityForBodyOrBoth: v })}
              min={0.05} max={1} step={0.01} digits={2}
            />
            <Slider
              label="cutBodyDepthOpacity"
              value={config.cutBodyDepthOpacity}
              onChange={(v) => onChange({ cutBodyDepthOpacity: v })}
              min={0.05} max={1} step={0.01} digits={2}
            />
            <Slider
              label="cutBodyNCutsOpacity"
              value={config.cutBodyNCutsOpacity}
              onChange={(v) => onChange({ cutBodyNCutsOpacity: v })}
              min={0.05} max={1} step={0.01} digits={2}
            />
          </Folder>

          {/* ── Exports ── */}
          <Folder label="exports" isOpen={openFolder === 'exports'} onToggle={() => toggleFolder('exports')}>
            <div className="lv-exports">
              {/* {onExportConfig && (
                <button className="lv-export-btn" onClick={onExportConfig}>copy to clipboard</button>
              )} */}
              {onDownload && (
                <button className="lv-export-btn" onClick={onDownload}>download zip</button>
              )}
              {/* {onScreenshot && (
                <button className="lv-export-btn" onClick={onScreenshot}>download image</button>
              )} */}
            </div>
          </Folder>
        </div>

        {/* ── Dropdown portal: rendered outside scroll container ── */}
        {dropdown && (
          <div
            className="lv-dropdown-portal"
            style={{ top: dropdown.top, left: dropdown.left, width: dropdown.width }}
          >
            {dropdown.options.map((o) => (
              <div
                key={o.value}
                className={`lv-select-option ${o.value === dropdown.value ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  dropdown.onChange(o.value);
                }}
              >
                {o.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
