/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createAutocomplete,
  type AutocompleteHandle,
  type AutocompleteCallbacks,
  type CommandInfo,
} from '../../src/chatView/autocomplete';

// Extend HTMLElement with Obsidian's methods
declare global {
  interface HTMLElement {
    createDiv(cls?: string): HTMLDivElement;
    empty(): void;
    addClass(cls: string): void;
    setText(text: string): void;
  }
}

HTMLElement.prototype.createDiv = function (cls?: string): HTMLDivElement {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  this.appendChild(div);
  return div;
};

HTMLElement.prototype.empty = function (): void {
  while (this.firstChild) {
    this.removeChild(this.firstChild);
  }
};

HTMLElement.prototype.addClass = function (cls: string): void {
  this.classList.add(cls);
};

HTMLElement.prototype.setText = function (text: string): void {
  this.textContent = text;
};

// Mock scrollIntoView for jsdom
HTMLElement.prototype.scrollIntoView = function (): void {
  // No-op in jsdom
};

// Mock toggleClass on Element
Element.prototype.toggleClass = function (cls: string, force?: boolean): void {
  if (force === undefined) {
    this.classList.toggle(cls);
  } else if (force) {
    this.classList.add(cls);
  } else {
    this.classList.remove(cls);
  }
};

describe('Autocomplete', () => {
  let anchor: HTMLElement;
  let callbacks: AutocompleteCallbacks;
  let handle: AutocompleteHandle;
  let commands: CommandInfo[];

  beforeEach(() => {
    anchor = document.createElement('div');
    document.body.appendChild(anchor);

    commands = [
      { name: '/help', description: 'Show help' },
      { name: '/history', description: 'Show history' },
      { name: '/new', description: 'New conversation' },
      { name: '/export [clipboard|json]', description: 'Export conversation' },
      { name: '/clear', description: 'Clear messages' },
    ];

    callbacks = {
      getCommands: vi.fn(() => commands),
      onSelect: vi.fn(),
    };
  });

  afterEach(() => {
    handle?.destroy();
    anchor.remove();
  });

  describe('creation', () => {
    it('should not show autocomplete by default', () => {
      handle = createAutocomplete(anchor, callbacks);
      expect(handle.isVisible()).toBe(false);
    });

    it('should not create DOM elements until needed', () => {
      handle = createAutocomplete(anchor, callbacks);
      expect(anchor.querySelector('.command-autocomplete')).toBeNull();
    });
  });

  describe('update', () => {
    it('should show autocomplete for slash command prefix', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/');
      expect(handle.isVisible()).toBe(true);
      expect(anchor.querySelector('.command-autocomplete')).not.toBeNull();
    });

    it('should filter commands based on query', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h');
      const items = anchor.querySelectorAll('.command-autocomplete-item');
      expect(items.length).toBe(2); // /help and /history
    });

    it('should hide for non-slash input', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h');
      expect(handle.isVisible()).toBe(true);
      handle.update('hello');
      expect(handle.isVisible()).toBe(false);
    });

    it('should hide when query contains space', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/export');
      expect(handle.isVisible()).toBe(true);
      handle.update('/export clipboard');
      expect(handle.isVisible()).toBe(false);
    });

    it('should hide when no commands match', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/xyz');
      expect(handle.isVisible()).toBe(false);
    });

    it('should select first item by default', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/');
      const selected = anchor.querySelector('.command-autocomplete-item.is-selected');
      expect(selected).not.toBeNull();
    });
  });

  describe('navigation', () => {
    it('should navigate down through items', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/');
      handle.navigate('down');
      const items = anchor.querySelectorAll('.command-autocomplete-item');
      expect(items[1].classList.contains('is-selected')).toBe(true);
    });

    it('should navigate up through items', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/');
      handle.navigate('down');
      handle.navigate('down');
      handle.navigate('up');
      const items = anchor.querySelectorAll('.command-autocomplete-item');
      expect(items[1].classList.contains('is-selected')).toBe(true);
    });

    it('should not navigate past the last item', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h'); // Only 2 items
      handle.navigate('down');
      handle.navigate('down');
      handle.navigate('down');
      const items = anchor.querySelectorAll('.command-autocomplete-item');
      expect(items[1].classList.contains('is-selected')).toBe(true);
    });

    it('should not navigate before the first item', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/');
      handle.navigate('up');
      const items = anchor.querySelectorAll('.command-autocomplete-item');
      expect(items[0].classList.contains('is-selected')).toBe(true);
    });

    it('should do nothing when not visible', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.navigate('down'); // Should not throw
      expect(handle.isVisible()).toBe(false);
    });
  });

  describe('selection', () => {
    it('should call onSelect with command name and space', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h');
      handle.select();
      expect(callbacks.onSelect).toHaveBeenCalledWith('/help ');
    });

    it('should extract base command from complex name', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/e');
      handle.select();
      expect(callbacks.onSelect).toHaveBeenCalledWith('/export ');
    });

    it('should hide after selection', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h');
      handle.select();
      expect(handle.isVisible()).toBe(false);
    });

    it('should return false when nothing selected', () => {
      handle = createAutocomplete(anchor, callbacks);
      const result = handle.select();
      expect(result).toBe(false);
    });

    it('should return true when command selected', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h');
      const result = handle.select();
      expect(result).toBe(true);
    });

    it('should select navigated item', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h');
      handle.navigate('down');
      handle.select();
      expect(callbacks.onSelect).toHaveBeenCalledWith('/history ');
    });
  });

  describe('mouse interaction', () => {
    it('should update selection on mouseenter', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h');
      const items = anchor.querySelectorAll('.command-autocomplete-item');
      const event = new MouseEvent('mouseenter', { bubbles: true });
      items[1].dispatchEvent(event);
      expect(items[1].classList.contains('is-selected')).toBe(true);
    });

    it('should select item on click', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h');
      const items = anchor.querySelectorAll('.command-autocomplete-item');
      const event = new MouseEvent('click', { bubbles: true });
      items[1].dispatchEvent(event);
      expect(callbacks.onSelect).toHaveBeenCalledWith('/history ');
    });
  });

  describe('hide', () => {
    it('should remove DOM element', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/');
      handle.hide();
      expect(anchor.querySelector('.command-autocomplete')).toBeNull();
    });

    it('should reset visibility state', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/');
      handle.hide();
      expect(handle.isVisible()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should clean up DOM on destroy', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/');
      handle.destroy();
      expect(anchor.querySelector('.command-autocomplete')).toBeNull();
    });
  });

  describe('command display', () => {
    it('should display command name', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h');
      const nameEl = anchor.querySelector('.command-autocomplete-name');
      expect(nameEl?.textContent).toBe('/help');
    });

    it('should display command description', () => {
      handle = createAutocomplete(anchor, callbacks);
      handle.update('/h');
      const descEl = anchor.querySelector('.command-autocomplete-desc');
      expect(descEl?.textContent).toBe('Show help');
    });
  });
});
