import { Component, ElementRef, viewChild } from '@angular/core';

/** Help window, after the two help dialogs of JungToNusmv (Appendix A). */
@Component({
    selector: 'app-help-dialog',
    templateUrl: './help-dialog.html'
})
export class HelpDialog {
    private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

    open(): void {
        this.dialog().nativeElement.showModal();
    }

    close(): void {
        this.dialog().nativeElement.close();
    }
}
