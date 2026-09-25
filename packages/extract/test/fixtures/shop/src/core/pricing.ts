import { money } from '../ui/format';

export interface Pricing {
    price(quantity: number): number;
}

export class Standard implements Pricing {
    price(quantity: number): number {
        return quantity * 10;
    }
}

export class Discount implements Pricing {
    price(_quantity: number): number {
        throw new Error('not implemented');
    }
}

export function total(pricing: Pricing, quantity: number): string {
    return money(pricing.price(quantity));
}
