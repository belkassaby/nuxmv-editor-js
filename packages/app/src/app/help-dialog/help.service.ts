import { Injectable } from '@angular/core';
import type { HelpDialog, HelpSection } from './help-dialog';

/** Lets any component open the Help window at a given section. */
@Injectable({ providedIn: 'root' })
export class HelpService {
    dialog?: HelpDialog;

    open(section: HelpSection = 'guide'): void {
        this.dialog?.open(section);
    }
}
