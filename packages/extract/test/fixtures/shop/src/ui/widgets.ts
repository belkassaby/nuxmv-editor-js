import { Session } from '../core/registry';

export class Poller {
    private timer?: ReturnType<typeof setInterval>;

    start(): void {
        this.timer = setInterval(() => console.log('tick'), 1000);
    }

    stop(): void {
        clearInterval(this.timer);
    }
}

export class Resizer {
    private width = 0;

    constructor() {
        window.addEventListener('resize', () => {
            this.width = window.innerWidth;
        });
    }

    dispose(): void {
        this.width = 0;
    }
}

export function login(name: string): Session {
    const session = new Session();
    session.user = name;
    return session;
}
