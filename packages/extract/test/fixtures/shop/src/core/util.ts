import { helper } from './helpers';

let counter = 0;

export function nextId(): number {
    counter++;
    return counter;
}

export function addItem(list: string[], item: string): string[] {
    list.push(item);
    return list;
}

export function shout(text: string): string {
    return helper(text).toUpperCase();
}
