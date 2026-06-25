/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMenuController,
  type MenuController,
  type OpenMenuOptions,
} from '../../src/chatView/menu';

vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
}));

// Obsidian DOM extensions required by menu.ts
declare global {
  interface HTMLElement {
    createDiv(options?: string | { cls?: string; text?: string; attr?: Record<string, string> }): HTMLDivElement;
    createSpan(
      options?: string | { cls?: string; text?: string; attr?: Record<string, string> }
    ): HTMLSpanElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: { cls?: string; attr?: Record<string, string>; text?: string }
    ): HTMLElementTagNameMap[K];
    empty(): void;
    addClass(cls: string): void;
    hasClass(cls: string): boolean;
    toggleClass(cls: string, force?: boolean): void;
  }
}

HTMLElement.prototype.createDiv = function (
  options?: string | { cls?: string; text?: string; attr?: Record<string, string> }
): HTMLDivElement {
  const div = document.createElement('div');
  if (typeof options === 'string') {
    div.className = options;
  } else if (options) {
    if (options.cls) div.className = options.cls;
    if (options.text) div.textContent = options.text;
    if (options.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        div.setAttribute(key, value);
      }
    }
  }
  this.appendChild(div);
  return div;
};

HTMLElement.prototype.createSpan = function (
  options?: string | { cls?: string; text?: string; attr?: Record<string, string> }
): HTMLSpanElement {
  const span = document.createElement('span');
  if (typeof options === 'string') {
    span.className = options;
  } else if (options) {
    if (options.cls) span.className = options.cls;
    if (options.text) span.textContent = options.text;
    if (options.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        span.setAttribute(key, value);
      }
    }
  }
  this.appendChild(span);
  return span;
};

HTMLElement.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: { cls?: string; attr?: Record<string, string>; text?: string }
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  if (options?.cls) (el as HTMLElement).className = options.cls;
  if (options?.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      (el as HTMLElement).setAttribute(key, value);
    }
  }
  if (options?.text) (el as HTMLElement).textContent = options.text;
  this.appendChild(el);
  return el;
};

HTMLElement.prototype.empty = function (): void {
  while (this.firstChild) this.removeChild(this.firstChild);
};

HTMLElement.prototype.addClass = function (cls: string): void {
  this.classList.add(cls);
};

HTMLElement.prototype.hasClass = function (cls: string): boolean {
  return this.classList.contains(cls);
};

HTMLElement.prototype.toggleClass = function (cls: string, force?: boolean): void {
  if (force !== undefined) {
    this.classList.toggle(cls, force);
  } else {
    this.classList.toggle(cls);
  }
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeTrigger(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function makeOpts(overrides?: Partial<OpenMenuOptions>): OpenMenuOptions {
  return {
    sections: [{ items: [{ label: 'Default item', onClick: vi.fn() }] }],
    trigger: makeTrigger(),
    ...overrides,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('createMenuController', () => {
  let container: HTMLElement;
  let ctrl: MenuController;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    ctrl = createMenuController(container);
  });

  afterEach(() => {
    ctrl.destroy();
    container.remove();
    // Clean up any stray trigger elements added to body
    document.body.querySelectorAll('div').forEach((el) => {
      if (el !== container) el.remove();
    });
  });

  // ── initial state ───────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('isOpen() returns false before any menu is opened', () => {
      expect(ctrl.isOpen()).toBe(false);
    });

    it('isOpen(name) returns false for any name before opening', () => {
      expect(ctrl.isOpen('main')).toBe(false);
    });
  });

  // ── open ────────────────────────────────────────────────────────────────────

  describe('open', () => {
    it('makes isOpen() true', () => {
      ctrl.open('main', makeOpts());
      expect(ctrl.isOpen()).toBe(true);
    });

    it('makes isOpen(name) true for the opened name', () => {
      ctrl.open('main', makeOpts());
      expect(ctrl.isOpen('main')).toBe(true);
    });

    it('isOpen(otherName) stays false after open', () => {
      ctrl.open('main', makeOpts());
      expect(ctrl.isOpen('other')).toBe(false);
    });

    it('mounts a backdrop element in the container', () => {
      ctrl.open('main', makeOpts());
      expect(container.querySelector('.occ-menu-backdrop')).not.toBeNull();
    });

    it('mounts a menu element in the container', () => {
      ctrl.open('main', makeOpts());
      expect(container.querySelector('.occ-menu')).not.toBeNull();
    });

    it('applies minWidth to the menu element', () => {
      ctrl.open('main', makeOpts({ minWidth: 220 }));
      const menu = container.querySelector('.occ-menu') as HTMLElement;
      expect(menu.style.minWidth).toBe('220px');
    });

    it('opening a second menu closes the first', () => {
      ctrl.open('a', makeOpts());
      ctrl.open('b', makeOpts());
      expect(ctrl.isOpen('a')).toBe(false);
      expect(ctrl.isOpen('b')).toBe(true);
    });

    it('only one .occ-menu exists after opening two menus', () => {
      ctrl.open('a', makeOpts());
      ctrl.open('b', makeOpts());
      expect(container.querySelectorAll('.occ-menu').length).toBe(1);
    });
  });

  // ── close ────────────────────────────────────────────────────────────────────

  describe('close', () => {
    it('makes isOpen() false', () => {
      ctrl.open('main', makeOpts());
      ctrl.close();
      expect(ctrl.isOpen()).toBe(false);
    });

    it('removes the backdrop from the container', () => {
      ctrl.open('main', makeOpts());
      ctrl.close();
      expect(container.querySelector('.occ-menu-backdrop')).toBeNull();
    });

    it('removes the menu from the container', () => {
      ctrl.open('main', makeOpts());
      ctrl.close();
      expect(container.querySelector('.occ-menu')).toBeNull();
    });

    it('is safe to call when no menu is open', () => {
      expect(() => ctrl.close()).not.toThrow();
    });
  });

  // ── toggle ───────────────────────────────────────────────────────────────────

  describe('toggle', () => {
    it('first call opens the named menu', () => {
      ctrl.toggle('main', makeOpts());
      expect(ctrl.isOpen('main')).toBe(true);
    });

    it('second call with the same name closes the menu', () => {
      const opts = makeOpts();
      ctrl.toggle('main', opts);
      ctrl.toggle('main', opts);
      expect(ctrl.isOpen()).toBe(false);
    });

    it('second call with a different name swaps to the new menu', () => {
      ctrl.toggle('a', makeOpts());
      ctrl.toggle('b', makeOpts());
      expect(ctrl.isOpen('a')).toBe(false);
      expect(ctrl.isOpen('b')).toBe(true);
    });
  });

  // ── backdrop click ────────────────────────────────────────────────────────────

  describe('backdrop click', () => {
    it('clicking the backdrop closes the menu', () => {
      ctrl.open('main', makeOpts());
      const backdrop = container.querySelector('.occ-menu-backdrop') as HTMLElement;
      backdrop.click();
      expect(ctrl.isOpen()).toBe(false);
    });

    it('clicking the backdrop removes the menu element', () => {
      ctrl.open('main', makeOpts());
      const backdrop = container.querySelector('.occ-menu-backdrop') as HTMLElement;
      backdrop.click();
      expect(container.querySelector('.occ-menu')).toBeNull();
    });
  });

  // ── item click ────────────────────────────────────────────────────────────────

  describe('item click', () => {
    it('calls the item onClick handler', () => {
      const onClick = vi.fn();
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'Action', onClick }] }],
      }));
      (container.querySelector('.occ-menu-item') as HTMLElement).click();
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('closes the menu after an item is clicked', () => {
      const onClick = vi.fn();
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'Action', onClick }] }],
      }));
      (container.querySelector('.occ-menu-item') as HTMLElement).click();
      expect(ctrl.isOpen()).toBe(false);
    });
  });

  // ── DOM: item rendering ───────────────────────────────────────────────────────

  describe('item rendering', () => {
    it('renders item label text', () => {
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'My label', onClick: vi.fn() }] }],
      }));
      expect(container.querySelector('.occ-menu-label')?.textContent).toBe('My label');
    });

    it('renders item description text', () => {
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'L', description: 'A description', onClick: vi.fn() }] }],
      }));
      expect(container.querySelector('.occ-menu-desc')?.textContent).toBe('A description');
    });

    it('skips description element when not provided', () => {
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'L', onClick: vi.fn() }] }],
      }));
      expect(container.querySelector('.occ-menu-desc')).toBeNull();
    });

    it('adds is-danger class for danger items', () => {
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'Delete', danger: true, onClick: vi.fn() }] }],
      }));
      expect(container.querySelector('.occ-menu-item')?.classList.contains('is-danger')).toBe(true);
    });

    it('adds is-active class for checked items', () => {
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'Active', checked: true, onClick: vi.fn() }] }],
      }));
      expect(container.querySelector('.occ-menu-item')?.classList.contains('is-active')).toBe(true);
    });

    it('renders trailing text', () => {
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'L', trailing: '/vault', onClick: vi.fn() }] }],
      }));
      expect(container.querySelector('.occ-menu-trailing')?.textContent).toBe('/vault');
    });

    it('renders a dot with the given background color', () => {
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'L', dotColor: 'green', onClick: vi.fn() }] }],
      }));
      const dot = container.querySelector('.occ-menu-dot') as HTMLElement;
      expect(dot).not.toBeNull();
      expect(dot.style.backgroundColor).toBe('green');
    });

    it('renders a chip span when chip:true', () => {
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'L', chip: true, onClick: vi.fn() }] }],
      }));
      expect(container.querySelector('.occ-menu-chip')).not.toBeNull();
    });

    it('chip takes precedence over dot (only chip rendered)', () => {
      ctrl.open('main', makeOpts({
        sections: [{
          items: [{ label: 'L', chip: true, dotColor: 'red', onClick: vi.fn() }],
        }],
      }));
      expect(container.querySelector('.occ-menu-chip')).not.toBeNull();
      expect(container.querySelector('.occ-menu-dot')).toBeNull();
    });
  });

  // ── DOM: section eyebrow ─────────────────────────────────────────────────────

  describe('section eyebrow', () => {
    it('renders eyebrow text above section items', () => {
      ctrl.open('main', makeOpts({
        sections: [{ eyebrow: 'Heading', items: [{ label: 'Item', onClick: vi.fn() }] }],
      }));
      expect(container.querySelector('.occ-menu-eyebrow')?.textContent).toBe('Heading');
    });

    it('skips eyebrow element when not provided', () => {
      ctrl.open('main', makeOpts({
        sections: [{ items: [{ label: 'Item', onClick: vi.fn() }] }],
      }));
      expect(container.querySelector('.occ-menu-eyebrow')).toBeNull();
    });
  });

  // ── destroy ──────────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('closes any open menu', () => {
      ctrl.open('main', makeOpts());
      ctrl.destroy();
      expect(ctrl.isOpen()).toBe(false);
    });

    it('removes backdrop and menu from container', () => {
      ctrl.open('main', makeOpts());
      ctrl.destroy();
      expect(container.querySelector('.occ-menu-backdrop')).toBeNull();
      expect(container.querySelector('.occ-menu')).toBeNull();
    });
  });
});
