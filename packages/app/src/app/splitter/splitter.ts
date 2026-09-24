import { Component, input, output } from '@angular/core';

/**
 * Draggable divider between two panes. It reports movement in pixels; the
 * parent decides which size changes. Arrow keys move it by 20px (60px with
 * Shift) and a double-click asks for the default size.
 */
@Component({
    selector: 'app-splitter',
    template: '',
    host: {
        role: 'separator',
        tabindex: '0',
        '[attr.aria-orientation]': "direction() === 'vertical' ? 'vertical' : 'horizontal'",
        '[attr.aria-label]': 'label()',
        '[class.vertical]': "direction() === 'vertical'",
        '[class.horizontal]': "direction() === 'horizontal'",
        '(pointerdown)': 'start($event)',
        '(dblclick)': 'reset.emit()',
        '(keydown)': 'key($event)'
    },
    styles: `
        :host { display: block; background: var(--border); position: relative; z-index: 5; touch-action: none; }
        :host(.vertical) { cursor: col-resize; }
        :host(.horizontal) { cursor: row-resize; }
        /* A wider invisible grab area than the visible 1px line. */
        :host::after { content: ''; position: absolute; inset: 0; }
        :host(.vertical)::after { inset: 0 -4px; }
        :host(.horizontal)::after { inset: -4px 0; }
        :host(:hover), :host(:focus-visible), :host(.dragging) { background: var(--accent); outline: none; }
    `
})
export class Splitter {
    /** `vertical`: a vertical bar moved left/right; `horizontal`: moved up/down. */
    readonly direction = input.required<'vertical' | 'horizontal'>();
    readonly label = input('Resize');
    /** Movement since the previous event, in pixels (positive = right / down). */
    readonly moved = output<number>();
    readonly reset = output<void>();
    readonly done = output<void>();

    start(event: PointerEvent): void {
        if (event.button !== 0) return;
        event.preventDefault();
        const el = event.currentTarget as HTMLElement;
        el.setPointerCapture(event.pointerId);
        el.classList.add('dragging');
        let last = this.direction() === 'vertical' ? event.clientX : event.clientY;
        const move = (e: PointerEvent) => {
            const now = this.direction() === 'vertical' ? e.clientX : e.clientY;
            if (now !== last) this.moved.emit(now - last);
            last = now;
        };
        const up = () => {
            el.classList.remove('dragging');
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', up);
            this.done.emit();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
    }

    key(event: KeyboardEvent): void {
        const step = event.shiftKey ? 60 : 20;
        const forward = this.direction() === 'vertical' ? 'ArrowRight' : 'ArrowDown';
        const back = this.direction() === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
        if (event.key === forward || event.key === back) {
            event.preventDefault();
            this.moved.emit(event.key === forward ? step : -step);
            this.done.emit();
        }
    }
}
