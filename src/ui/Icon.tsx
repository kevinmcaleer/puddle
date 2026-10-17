import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft, Blend, Calendar, ClipboardPaste, CaseSensitive, Check, ChevronDown, ChevronRight, ChevronUp, CircleHelp, Clock, Code, Columns2, Download, Ellipsis, Eye,
  File, Globe, FileText, GripVertical, Info, Keyboard, LayoutTemplate, Link, ListPlus, Monitor, Moon, PanelBottomClose, PanelBottomOpen, PanelRightClose, PanelRightOpen, Pin, Plus, Redo2, RefreshCw,
  Group, Search, ShieldCheck, Sigma, SlidersHorizontal, Sun, TableProperties, TriangleAlert, Type, Undo2, Ungroup, Workflow, X,
} from 'lucide-react';
import { cx } from './cx';

// Mapping from the design system's icon names to Lucide (brand book, Iconography).
const LUCIDE = {
  source: File,
  transform: SlidersHorizontal,
  join: Blend,
  append: ListPlus,
  query: TableProperties,
  check: ShieldCheck,
  output: Eye,
  eye: Eye,
  pin: Pin,
  plus: Plus,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'arrow-left': ArrowLeft,
  grip: GripVertical,
  tick: Check,
  cross: X,
  alert: TriangleAlert,
  info: Info,
  help: CircleHelp,
  more: Ellipsis,
  export: Download,
  code: Code,
  layout: Workflow,
  notes: FileText,
  search: Search,
  calendar: Calendar,
  clock: Clock,
  text: Type,
  case: CaseSensitive,
  undo: Undo2,
  redo: Redo2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  'panel-close': PanelBottomClose,
  'panel-open': PanelBottomOpen,
  paste: ClipboardPaste,
  link: Link,
  web: Globe,
  refresh: RefreshCw,
  keyboard: Keyboard,
  'sidebar-close': PanelRightClose,
  'sidebar-open': PanelRightOpen,
  compare: Columns2,
  template: LayoutTemplate,
  totals: Sigma,
  group: Group,
  ungroup: Ungroup,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof LUCIDE | 'trim';

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}

export function Icon({ name, size = 16, className, title }: IconProps) {
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  if (name === 'trim') {
    // Lucide has no close match for trim, so the design system's stand-in stays.
    return (
      <svg className={cx('ui-icon', className)} width={size} height={size} viewBox="0 0 16 16" {...a11y}>
        <path d="M2 3v10M14 3v10M5 8h6" />
      </svg>
    );
  }
  const Glyph = LUCIDE[name];
  return <Glyph className={cx('ui-icon', className)} size={size} strokeWidth={1.6} {...a11y} />;
}
