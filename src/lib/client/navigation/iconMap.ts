import type { ComponentType } from "svelte";
import {
  Clock,
  FolderTree,
  Link,
  Microscope,
  Palette,
  Settings,
  Sliders,
  Tag,
  Wrench,
} from "lucide-svelte";

export const NAV_ICON_MAP: Record<string, ComponentType> = {
  Clock,
  FolderTree,
  Link,
  Microscope,
  Palette,
  Settings,
  Sliders,
  Tag,
  Wrench,
};

export function resolveNavIcon(iconKey: string): ComponentType | undefined {
  return NAV_ICON_MAP[iconKey];
}
