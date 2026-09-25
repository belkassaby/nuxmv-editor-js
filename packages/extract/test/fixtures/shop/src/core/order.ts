export type OrderStatus = 'draft' | 'submitted' | 'paid' | 'shipped' | 'cancelled' | 'refunded';

export interface PaymentApi {
    charge(amount: number): Promise<void>;
}

export class Order {
    status: OrderStatus = 'draft';

    submit(): void {
        if (this.status !== 'draft') return;
        this.status = 'submitted';
    }

    async pay(api: PaymentApi): Promise<void> {
        if (this.status !== 'submitted') return;
        await api.charge(10);
        this.status = 'paid';
    }

    cancel(): void {
        if (this.status === 'shipped') throw new Error('already shipped');
        this.status = 'cancelled';
    }

    ship(): void {
        if (this.status === 'paid') this.status = 'shipped';
    }

    label(): string {
        switch (this.status) {
            case 'draft':
                return 'Draft';
            case 'submitted':
                return 'Waiting for payment';
            case 'paid':
                return 'Paid';
        }
        return '';
    }

    isRefunded(): boolean {
        return this.status === 'refunded';
    }
}
