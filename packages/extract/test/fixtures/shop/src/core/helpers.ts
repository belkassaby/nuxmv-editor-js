import { shout } from './util';

export function helper(text: string): string {
    return text.trim();
}

export function loud(text: string): string {
    return shout(text);
}
