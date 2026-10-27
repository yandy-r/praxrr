/** Tag with metadata */
export interface Tag {
  name: string;
  created_at: string;
}

/** Mixin for list rows that can differ from the upstream (base) layer through user ops */
export interface LocallyModifiable {
  locallyModified?: boolean;
}
