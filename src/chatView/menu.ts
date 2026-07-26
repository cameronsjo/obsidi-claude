/**
 * Dropdown menu helper for the chat pane.
 *
 * Reproduces the design handoff's menu state machine: one menu open at a time,
 * a full-pane backdrop that closes any open menu on outside click, rich rows
 * (icon / colored status dot + name + faint description + active check), and
 * up/down + left/right anchoring against a trigger element. Used by all four
 * pane menus (header overflow, composer mode / add-context / model).
 */
import { setIcon } from 'obsidian';

export interface MenuItemSpec {
  /** Primary row label. */
  label: string;
  /** Optional faint caption shown beside/under the label. */
  description?: string;
  /** Lucide icon name rendered at the row's left (via setIcon). */
  icon?: string;
  /** CSS color for a small status dot at the row's left (mutually exclusive with icon). */
  dotColor?: string;
  /** Render a square accent chip at the left (model-picker style). */
  chip?: boolean;
  /** Show an active check at the row's right. */
  checked?: boolean;
  /** Danger styling: red text + red-tint hover (e.g. Clear conversation). */
  danger?: boolean;
  /** Right-aligned trailing hint (e.g. mono path "/"). */
  trailing?: string;
  onClick: () => void;
}

export interface MenuSectionSpec {
  /** Optional uppercase faint eyebrow above the section's items. */
  eyebrow?: string;
  items: MenuItemSpec[];
}

export interface OpenMenuOptions {
  sections: MenuSectionSpec[];
  /** Element the menu anchors to. */
  trigger: HTMLElement;
  /** Vertical open direction relative to the trigger. */
  direction?: 'down' | 'up';
  /** Horizontal alignment of the menu against the trigger. */
  align?: 'left' | 'right';
  minWidth?: number;
}

export interface MenuController {
  /** Toggle a named menu: reopen closes it; a different name swaps. */
  toggle(name: string, opts: OpenMenuOptions): void;
  open(name: string, opts: OpenMenuOptions): void;
  close(): void;
  isOpen(name?: string): boolean;
  destroy(): void;
}

const MENU_GAP = 6;

/**
 * Create a menu controller scoped to a pane container. Backdrop + menu are
 * mounted into `container`, which must be positioned (the pane container is
 * `display:flex` with the default `position:static`; we set it relative).
 */
export function createMenuController(container: HTMLElement): MenuController {
  let openName: string | null = null;
  let backdropEl: HTMLElement | null = null;
  let menuEl: HTMLElement | null = null;

  // The pane container needs a positioning context for absolute children.
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  function close(): void {
    openName = null;
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
    if (backdropEl) {
      backdropEl.remove();
      backdropEl = null;
    }
  }

  function renderItem(listEl: HTMLElement, item: MenuItemSpec): void {
    const row = listEl.createDiv('occ-menu-item');
    if (item.danger) row.addClass('is-danger');
    if (item.checked) row.addClass('is-active');

    // Left adornment: chip > dot > icon.
    if (item.chip) {
      row.createSpan('occ-menu-chip');
    } else if (item.dotColor) {
      const dot = row.createSpan('occ-menu-dot');
      dot.style.backgroundColor = item.dotColor;
    } else if (item.icon) {
      const ic = row.createSpan('occ-menu-icon');
      setIcon(ic, item.icon);
    }

    const text = row.createDiv('occ-menu-text');
    text.createSpan({ cls: 'occ-menu-label', text: item.label });
    if (item.description) {
      text.createSpan({ cls: 'occ-menu-desc', text: item.description });
    }

    if (item.trailing) {
      row.createSpan({ cls: 'occ-menu-trailing', text: item.trailing });
    }
    if (item.checked) {
      const check = row.createSpan('occ-menu-check');
      setIcon(check, 'check');
    }

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      item.onClick();
    });
  }

  function open(name: string, opts: OpenMenuOptions): void {
    close();
    openName = name;

    // Full-pane backdrop closes on outside click (handoff: z-index 40).
    backdropEl = container.createDiv('occ-menu-backdrop');
    backdropEl.addEventListener('click', () => close());

    menuEl = container.createDiv('occ-menu');
    if (opts.minWidth) menuEl.style.minWidth = `${opts.minWidth}px`;
    menuEl.addEventListener('click', (e) => e.stopPropagation());

    for (const section of opts.sections) {
      if (section.eyebrow) {
        menuEl.createDiv({ cls: 'occ-menu-eyebrow', text: section.eyebrow });
      }
      const list = menuEl.createDiv('occ-menu-list');
      for (const item of section.items) {
        renderItem(list, item);
      }
    }

    positionMenu(opts);
  }

  function positionMenu(opts: OpenMenuOptions): void {
    if (!menuEl) return;
    const direction = opts.direction ?? 'down';
    const align = opts.align ?? 'left';

    const cRect = container.getBoundingClientRect();
    const tRect = opts.trigger.getBoundingClientRect();

    // Horizontal anchor (clamped to the container).
    const menuWidth = menuEl.offsetWidth;
    let left =
      align === 'right'
        ? tRect.right - cRect.left - menuWidth
        : tRect.left - cRect.left;
    left = Math.max(6, Math.min(left, cRect.width - menuWidth - 6));
    menuEl.style.left = `${left}px`;

    // Vertical anchor.
    if (direction === 'up') {
      menuEl.style.bottom = `${cRect.bottom - tRect.top + MENU_GAP}px`;
    } else {
      menuEl.style.top = `${tRect.bottom - cRect.top + MENU_GAP}px`;
    }
  }

  function toggle(name: string, opts: OpenMenuOptions): void {
    if (openName === name) {
      close();
    } else {
      open(name, opts);
    }
  }

  function isOpen(name?: string): boolean {
    return name ? openName === name : openName !== null;
  }

  function destroy(): void {
    close();
  }

  return { toggle, open, close, isOpen, destroy };
}
