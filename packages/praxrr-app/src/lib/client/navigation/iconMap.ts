import type { ComponentType } from 'svelte';
import {
  Calculator,
  Clock,
  FolderTree,
  GitCompare,
  History,
  LayoutGrid,
  Link,
  Microscope,
  Network,
  Package,
  Palette,
  Settings,
  ShieldCheck,
  Sliders,
  Tag,
  Wrench,
} from 'lucide-svelte';

export const NAV_ICON_MAP: Record<string, ComponentType> = {
  Calculator,
  Clock,
  FolderTree,
  GitCompare,
  History,
  LayoutGrid,
  Link,
  Microscope,
  Network,
  Package,
  Palette,
  Settings,
  ShieldCheck,
  Sliders,
  Tag,
  Wrench,
};

export function resolveNavIcon(iconKey: string): ComponentType | undefined {
  return NAV_ICON_MAP[iconKey];
}
