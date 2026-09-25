import { Injectable } from '@angular/core';
import type { HelpDialog, HelpSection } from './help-dialog';

/** Lets any component open the Help window at a given section. */
@Injectable({ providedIn: 'root' })
export class HelpService {
    dialog?: HelpDialog;

    open(section: HelpSection = 'guide', focus: string | null = null): void {
        this.dialog?.open(section, focus);
    }

    walkthrough(id: string): void {
        this.open('walkthroughs', id);
    }
}
