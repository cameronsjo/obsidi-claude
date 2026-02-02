/**
 * Command autocomplete module for ChatView.
 * Handles slash command suggestions and selection.
 */
import type { ModuleHandle } from './types';

/**
 * Command information for autocomplete display.
 */
export interface CommandInfo {
  name: string;
  description: string;
}

/**
 * Callbacks for autocomplete to communicate with parent.
 */
export interface AutocompleteCallbacks {
  /** Get list of available commands */
  getCommands: () => CommandInfo[];
  /** Called when a command is selected */
  onSelect: (command: string) => void;
}

/**
 * Handle for controlling the autocomplete.
 */
export interface AutocompleteHandle extends ModuleHandle {
  /** Update autocomplete based on current input query */
  update(query: string): void;
  /** Hide the autocomplete dropdown */
  hide(): void;
  /** Check if autocomplete is currently visible */
  isVisible(): boolean;
  /** Navigate up/down in the list */
  navigate(direction: 'up' | 'down'): void;
  /** Select the current item; returns true if selected */
  select(): boolean;
}

/**
 * Create an autocomplete dropdown for slash commands.
 * @param anchor - Element to position autocomplete relative to (input wrapper)
 * @param callbacks - Callbacks for parent communication
 */
export function createAutocomplete(
  anchor: HTMLElement,
  callbacks: AutocompleteCallbacks
): AutocompleteHandle {
  // Internal state
  let autocompleteEl: HTMLElement | null = null;
  let autocompleteIndex = -1;
  let autocompleteCommands: CommandInfo[] = [];

  /**
   * Update autocomplete based on input query.
   * Shows/hides autocomplete and filters commands.
   */
  function update(query: string): void {
    // Only show autocomplete for slash commands at the start
    if (!query.startsWith('/') || query.includes(' ')) {
      hide();
      return;
    }

    const searchQuery = query.slice(1).toLowerCase();
    const allCommands = callbacks.getCommands();

    // Filter commands that match the query
    autocompleteCommands = allCommands.filter(cmd => {
      const cmdName = cmd.name.split(' ')[0].slice(1); // Remove / and get base command
      return cmdName.startsWith(searchQuery);
    });

    if (autocompleteCommands.length === 0) {
      hide();
      return;
    }

    show();
  }

  /**
   * Show the autocomplete dropdown.
   */
  function show(): void {
    if (!autocompleteEl) {
      autocompleteEl = anchor.createDiv('command-autocomplete');
    }

    autocompleteEl.empty();
    autocompleteIndex = 0;

    for (let i = 0; i < autocompleteCommands.length; i++) {
      const cmd = autocompleteCommands[i];
      const item = autocompleteEl.createDiv('command-autocomplete-item');
      if (i === 0) item.addClass('is-selected');

      const nameEl = item.createDiv('command-autocomplete-name');
      nameEl.setText(cmd.name);

      const descEl = item.createDiv('command-autocomplete-desc');
      descEl.setText(cmd.description);

      item.addEventListener('click', () => {
        autocompleteIndex = i;
        selectCommand();
      });

      item.addEventListener('mouseenter', () => {
        autocompleteIndex = i;
        updateSelection();
      });
    }
  }

  /**
   * Hide the autocomplete dropdown.
   */
  function hide(): void {
    if (autocompleteEl) {
      autocompleteEl.remove();
      autocompleteEl = null;
    }
    autocompleteCommands = [];
    autocompleteIndex = -1;
  }

  /**
   * Check if autocomplete is visible.
   */
  function isVisible(): boolean {
    return autocompleteEl !== null && autocompleteCommands.length > 0;
  }

  /**
   * Navigate up or down in the autocomplete list.
   */
  function navigate(direction: 'up' | 'down'): void {
    if (!isVisible()) return;

    if (direction === 'down') {
      autocompleteIndex = Math.min(autocompleteIndex + 1, autocompleteCommands.length - 1);
    } else {
      autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
    }

    updateSelection();
  }

  /**
   * Update visual selection state.
   */
  function updateSelection(): void {
    if (!autocompleteEl) return;

    const items = autocompleteEl.querySelectorAll('.command-autocomplete-item');
    items.forEach((item, i) => {
      item.toggleClass('is-selected', i === autocompleteIndex);
    });

    // Scroll selected item into view
    const selected = items[autocompleteIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * Select the currently highlighted command.
   * Returns true if a command was selected.
   */
  function select(): boolean {
    if (autocompleteIndex < 0 || autocompleteIndex >= autocompleteCommands.length) {
      hide();
      return false;
    }

    selectCommand();
    return true;
  }

  /**
   * Internal: select the command at current index.
   */
  function selectCommand(): void {
    const cmd = autocompleteCommands[autocompleteIndex];
    // Extract just the command name (e.g., "/export" from "/export [clipboard|json]")
    const cmdName = cmd.name.split(' ')[0];

    callbacks.onSelect(cmdName + ' ');
    hide();
  }

  /**
   * Clean up DOM elements.
   */
  function destroy(): void {
    hide();
  }

  return {
    update,
    hide,
    isVisible,
    navigate,
    select,
    destroy,
  };
}
